import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const bin = path.join(packageRoot, "bin", "forge-memory.mjs");
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "forge-memory-home-"));
const dataRoot = path.join(tempHome, "data");
const env = {
  ...process.env,
  HOME: tempHome,
  USERPROFILE: tempHome
};

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: packageRoot,
    env,
    encoding: "utf8",
    timeout: 20_000,
    ...options
  });
  if (result.status !== 0) {
    throw new Error(
      `forge-memory ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return result;
}

function runFailure(args, options = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: packageRoot,
    env,
    encoding: "utf8",
    timeout: 20_000,
    ...options
  });
  if (result.status === 0) {
    throw new Error(
      `forge-memory ${args.join(" ")} unexpectedly succeeded\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return result;
}

function runAsync(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: packageRoot,
      env,
      ...options
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`forge-memory ${args.join(" ")} timed out`));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      if (status !== 0) {
        reject(
          new Error(
            `forge-memory ${args.join(" ")} failed\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        );
        return;
      }
      resolve({ stdout, stderr, status });
    });
  });
}

function runAsyncFailure(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: packageRoot,
      env,
      ...options
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`forge-memory ${args.join(" ")} timed out`));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      if (status === 0) {
        reject(
          new Error(
            `forge-memory ${args.join(" ")} unexpectedly succeeded\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        );
        return;
      }
      resolve({ stdout, stderr, status });
    });
  });
}

function writeSmokeConfig(overrides = {}) {
  const configPath = path.join(tempHome, ".forge", "config.json");
  const current = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : {};
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({ ...current, ...overrides }, null, 2)}\n`
  );
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function countText(source, pattern) {
  return source.match(new RegExp(pattern, "gm"))?.length ?? 0;
}

async function withFakeForgeServer(handler, callback) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", async () => {
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body
      });
      const result = await handler(request, body);
      response.statusCode = result.statusCode ?? 200;
      for (const [key, value] of Object.entries(result.headers ?? {})) {
        response.setHeader(key, value);
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(result.body ?? {}));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    return await callback({ port: address.port, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function forgeHealthResponse() {
  return {
    app: "forge",
    apiVersion: "v1",
    backend: "forge-node-runtime",
    runtime: { basePath: "/forge/", storageRoot: dataRoot }
  };
}

async function startLiveForgeHealthChild() {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
const http = require("node:http");
const server = http.createServer((request, response) => {
  if (request.url === "/api/v1/health") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      ok: true,
      app: "forge",
      apiVersion: "v1",
      backend: "forge-node-runtime",
      runtime: {
        pid: process.pid,
        basePath: "/forge/",
        storageRoot: process.env.FORGE_DATA_ROOT
      }
    }));
    return;
  }
  response.statusCode = 404;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ error: "not found" }));
});
server.listen(0, "127.0.0.1", () => {
  console.log(server.address().port);
});
      `
    ],
    {
      env: { ...env, FORGE_DATA_ROOT: dataRoot },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const port = await new Promise((resolve, reject) => {
    const failBeforeListen = (code) => {
      clearTimeout(timeout);
      reject(new Error(`Live Forge health child exited before listening: ${code}\n${stderr}`));
    };
    const timeout = setTimeout(() => {
      child.off("exit", failBeforeListen);
      child.kill("SIGKILL");
      reject(new Error(`Timed out waiting for live Forge health child\n${stderr}`));
    }, 5_000);
    child.stdout.once("data", (chunk) => {
      clearTimeout(timeout);
      child.off("exit", failBeforeListen);
      const parsed = Number(String(chunk).trim());
      if (!Number.isInteger(parsed) || parsed <= 0) {
        child.kill("SIGKILL");
        reject(new Error(`Invalid child health port: ${chunk}`));
        return;
      }
      resolve(parsed);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", failBeforeListen);
  });
  return { child, port, pid: child.pid };
}

async function waitForExit(child, label) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${label} did not exit after stop/uninstall`));
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function inspectMcp() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, "mcp"],
    cwd: packageRoot,
    env
  });
  const client = new Client({ name: "forge-memory-smoke", version: "0.0.0" });
  await client.connect(transport);
  try {
    return {
      tools: await client.listTools(),
      diagnostics: await client.callTool({
        name: "forge_memory_mcp_diagnostics",
        arguments: {}
      })
    };
  } finally {
    await client.close();
  }
}

run(["--help"]);
run(["--version"]);
const guidedDryRun = run(
  [
    "install",
    "--yes",
    "--dry-run",
    "--no-start",
    "--skip-pair-ios",
    "--adapters",
    "none",
    "--data-root",
    dataRoot
  ],
  {
    env: { ...env, NODE_OPTIONS: "--throw-deprecation" }
  }
);
for (const expected of [
  "Looking for host adapters",
  "Saving Forge settings",
  "Preparing Forge data folder",
  "Skipping host adapter configuration",
  "Runtime start skipped",
  "Running Forge doctor",
  "iOS pairing skipped",
  "Forge Memory configured and checked."
]) {
  if (!guidedDryRun.stdout.includes(expected)) {
    throw new Error(`Expected guided install output to include: ${expected}`);
  }
}
run([
  "install",
  "--yes",
  "--dry-run",
  "--no-start",
  "--skip-pair-ios",
  "--adapters",
  "none",
  "--data-root",
  dataRoot,
  "--port",
  "0",
  "--json"
]);
run([
  "install",
  "--yes",
  "--no-start",
  "--skip-pair-ios",
  "--adapters",
  "none",
  "--data-root",
  dataRoot,
  "--port",
  "0",
  "--json"
]);
run([
  "configure",
  "--yes",
  "--no-start",
  "--skip-pair-ios",
  "--adapters",
  "none",
  "--json"
]);
run(["status", "--json"]);
fs.rmSync(dataRoot, { recursive: true, force: true });
const repairedDoctor = run(["doctor", "--json", "--repair", "--no-start"]);
const repairedPayload = JSON.parse(repairedDoctor.stdout);
const dataRootCheck = repairedPayload.checks.find(
  (check) => check.id === "dataRoot"
);
if (!dataRootCheck?.ok || !dataRootCheck.repaired) {
  throw new Error("Expected doctor --repair --no-start to recreate dataRoot");
}
run(["doctor", "--json"]);
const pairingFailure = runFailure(["pair-ios", "--json", "--no-start"]);
if (!pairingFailure.stderr.includes("iOS pairing was not started")) {
  throw new Error("Expected unreachable pairing to stop before creating a pairing");
}
if (!pairingFailure.stderr.includes("doctor --repair")) {
  throw new Error("Expected unreachable pairing to point at doctor --repair");
}
const manualHttpFailure = runFailure(["pair-ios", "--json", "--manual-http", "--public-url", "http://127.0.0.1:4317/forge/"]);
if (!manualHttpFailure.stderr.includes("loopback-only")) {
  throw new Error("Expected manual HTTP pairing to reject loopback public URLs for physical iPhones");
}
const codexConfigPath = path.join(tempHome, ".codex", "config.toml");
fs.mkdirSync(path.dirname(codexConfigPath), { recursive: true });
fs.writeFileSync(
  codexConfigPath,
  [
    'BROWSER_USE_CODEX_APP_BUILD_FLAVOR = "prod"',
    'command = "npx"',
    'args = ["forge-memory", "mcp"]',
    "",
    "[mcp_servers.forge.env]",
    'FORGE_ORIGIN = "http://127.0.0.1"',
    'FORGE_PORT = "4317"',
    'FORGE_ACTOR_LABEL = "codex"',
    "",
    "[mcp_servers.forge]",
    'command = "npx"',
    'args = ["forge-memory", "mcp"]',
    "",
    "[mcp_servers.forge.env]",
    'FORGE_ORIGIN = "http://127.0.0.1"',
    'FORGE_PORT = "4317"',
    'FORGE_ACTOR_LABEL = "codex"',
    'FORGE_TIMEOUT_MS = "15000"',
    `FORGE_DATA_ROOT = "${dataRoot}"`,
    "",
    "[mcp_servers.other]",
    'command = "npx"',
    'args = ["some-other-mcp"]',
    "",
    "[desktop]",
    'appearanceTheme = "dark"',
    ""
  ].join("\n")
);
run([
  "configure",
  "--yes",
  "--no-start",
  "--skip-pair-ios",
  "--adapters",
  "codex",
  "--json"
]);
run([
  "configure",
  "--yes",
  "--no-start",
  "--skip-pair-ios",
  "--adapters",
  "codex",
  "--json"
]);
const codexConfig = fs.readFileSync(codexConfigPath, "utf8");
if (countText(codexConfig, "^\\[mcp_servers\\.forge\\]$") !== 1) {
  throw new Error(`Expected one Codex Forge MCP table, got:\n${codexConfig}`);
}
if (countText(codexConfig, "^\\[mcp_servers\\.forge\\.env\\]$") !== 1) {
  throw new Error(`Expected one Codex Forge MCP env table, got:\n${codexConfig}`);
}
if (!codexConfig.includes("[desktop]") || !codexConfig.includes('appearanceTheme = "dark"')) {
  throw new Error(`Expected Codex desktop config to survive Forge MCP patching:\n${codexConfig}`);
}
if (!codexConfig.includes("[mcp_servers.other]") || !codexConfig.includes('args = ["some-other-mcp"]')) {
  throw new Error(`Expected unrelated Codex MCP server config to survive Forge MCP patching:\n${codexConfig}`);
}
await withFakeForgeServer(async (request, body) => {
  if (request.url === "/api/v1/health") {
    return { body: forgeHealthResponse() };
  }
  if (request.url === "/api/v1/auth/operator-session") {
    return {
      headers: { "set-cookie": "forge_operator_session=test-session; Path=/; HttpOnly" },
      body: { session: { id: "ses_test", actorLabel: "Test", expiresAt: new Date(Date.now() + 60_000).toISOString() } }
    };
  }
  if (request.url === "/api/v1/health/pairing-sessions") {
    if (request.headers.cookie !== "forge_operator_session=test-session") {
      return {
        statusCode: 401,
        body: { code: "auth_required", error: "An authenticated operator session is required." }
      };
    }
    const parsed = JSON.parse(body || "{}");
    return {
      statusCode: 201,
      body: {
        qrPayload: {
          kind: "forge_companion_pairing",
          apiBaseUrl: "forge-iroh://fake-node/api/v1",
          uiBaseUrl: "forge-iroh://fake-node/forge/",
          transportMode: parsed.transportMode,
          transport: { protocol: "iroh", provider: "forge-companion-iroh" },
          sessionId: "pair_test",
          pairingToken: "pairing-token",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          capabilities: ["health-sync"]
        }
      }
    };
  }
  return { statusCode: 404, body: { error: "not found" } };
}, async ({ port, requests }) => {
  writeSmokeConfig({ mode: "packaged", port, dataRoot, adapters: [] });
  const pairing = await runAsync(["pair-ios", "--json", "--no-start"]);
  const payload = JSON.parse(pairing.stdout);
  if (payload.qrPayload.sessionId !== "pair_test") {
    throw new Error("Expected pair-ios --json to return the fake pairing payload");
  }
  const authRequest = requests.find((entry) => entry.url === "/api/v1/auth/operator-session");
  if (!authRequest) {
    throw new Error("Expected pair-ios to bootstrap a local operator session before pairing");
  }
  const pairingRequest = requests.find((entry) => entry.url === "/api/v1/health/pairing-sessions");
  if (pairingRequest?.headers.cookie !== "forge_operator_session=test-session") {
    throw new Error("Expected pair-ios to send the local operator session cookie to the pairing route");
  }
  const humanPairing = await runAsync(["pair-ios", "--no-start"]);
  const payloadSizeMatch = humanPairing.stdout.match(
    /QR payload bytes: (?<qr>\d+); manual payload bytes: (?<manual>\d+)/
  );
  if (!payloadSizeMatch?.groups) {
    throw new Error("Expected pair-ios to report QR and manual payload byte counts");
  }
  if (Number(payloadSizeMatch.groups.qr) >= Number(payloadSizeMatch.groups.manual)) {
    throw new Error("Expected short QR payload to be smaller than the saved manual payload");
  }
  const savedPairingPath = path.join(
    tempHome,
    ".forge",
    "pairing",
    "forge-companion-pair_test.json"
  );
  const savedPairing = JSON.parse(fs.readFileSync(savedPairingPath, "utf8"));
  if (savedPairing.sessionId !== "pair_test" || savedPairing.pairingToken !== "pairing-token") {
    throw new Error("Expected pair-ios to save the full manual pairing payload");
  }
});
await withFakeForgeServer(async (request) => {
  if (request.url === "/api/v1/health") return { body: forgeHealthResponse() };
  if (request.url === "/api/v1/auth/operator-session") {
    return { body: { session: { id: "ses_missing_cookie" } } };
  }
  return { statusCode: 404, body: { error: "not found" } };
}, async ({ port }) => {
  writeSmokeConfig({ mode: "packaged", port, dataRoot, adapters: [] });
  const failure = await runAsyncFailure(["pair-ios", "--json", "--no-start"]);
  const payload = JSON.parse(failure.stderr);
  if (payload.code !== "pairing_auth_failed") {
    throw new Error(`Expected pairing_auth_failed, got ${payload.code}`);
  }
  if (payload.error.includes("doctor --repair")) {
    throw new Error("Expected auth bootstrap failure not to point primarily at doctor --repair");
  }
});
await withFakeForgeServer(async (request) => {
  if (request.url === "/api/v1/health") return { body: forgeHealthResponse() };
  if (request.url === "/api/v1/auth/operator-session") {
    return {
      headers: { "set-cookie": "forge_operator_session=test-session; Path=/" },
      body: { session: { id: "ses_test" } }
    };
  }
  if (request.url === "/api/v1/health/pairing-sessions") {
    return {
      statusCode: 401,
      body: { code: "auth_required", error: "An authenticated operator session is required." }
    };
  }
  return { statusCode: 404, body: { error: "not found" } };
}, async ({ port }) => {
  writeSmokeConfig({ mode: "packaged", port, dataRoot, adapters: [] });
  const failure = await runAsyncFailure(["pair-ios", "--json", "--no-start"]);
  const payload = JSON.parse(failure.stderr);
  if (payload.code !== "pairing_request_failed") {
    throw new Error(`Expected pairing_request_failed, got ${payload.code}`);
  }
  if (payload.guidance.some((entry) => entry.includes("doctor --repair"))) {
    throw new Error("Expected authenticated pairing 401 to avoid generic doctor --repair guidance");
  }
});
await withFakeForgeServer(async (request) => {
  if (request.url === "/api/v1/health") return { body: forgeHealthResponse() };
  return { statusCode: 404, body: { error: "not found" } };
}, async ({ port }) => {
  writeSmokeConfig({ mode: "packaged", port, dataRoot, adapters: [] });
  fs.rmSync(path.join(tempHome, ".forge", "run", "forge-memory-runtime.json"), { force: true });
  const start = await runAsync(["start"]);
  const payload = JSON.parse(start.stdout);
  if (!payload.ok || payload.started !== false || payload.adopted !== true) {
    throw new Error(`Expected healthy runtime adoption without spawning, got ${start.stdout}`);
  }
});
await withFakeForgeServer(async () => ({
  statusCode: 404,
  body: { error: "not Forge" }
}), async ({ port }) => {
  writeSmokeConfig({ mode: "packaged", port, dataRoot, adapters: [] });
  const start = await runAsync(["start"]);
  const payload = JSON.parse(start.stdout);
  if (payload.ok || !payload.portConflict) {
    throw new Error(`Expected occupied non-Forge port to be reported as a port conflict, got ${start.stdout}`);
  }
});
run(["stop"]);

fs.mkdirSync(dataRoot, { recursive: true });
fs.writeFileSync(path.join(dataRoot, "forge.sqlite"), "");

const exportPath = path.join(tempHome, "forge-export.tar.gz");
run(["export", "--output", exportPath, "--json"]);
if (!fs.existsSync(exportPath)) {
  throw new Error("Expected forge-memory export to create an archive");
}

const configPath = path.join(tempHome, ".forge", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (config.dataRoot !== dataRoot) {
  throw new Error(`Expected dataRoot ${dataRoot}, got ${config.dataRoot}`);
}
if (!Array.isArray(config.adapters) || config.adapters.length !== 0) {
  throw new Error("Expected no adapters in smoke config");
}

fs.writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      ...config,
      mode: "dev",
      repo: path.resolve(packageRoot, "../..")
    },
    null,
    2
  )}\n`
);
const mcp = await inspectMcp();
const mcpTools = mcp.tools;
const mcpToolNames = mcpTools.tools.map((tool) => tool.name);
if (!mcpToolNames.includes("forge_memory_mcp_diagnostics")) {
  throw new Error("Expected forge-memory mcp to expose diagnostics.");
}
if (!mcpToolNames.includes("forge_search_wiki")) {
  const diagnostics = JSON.parse(mcp.diagnostics.content[0].text);
  if (diagnostics.runtimeLoaded) {
    throw new Error(
      `Forge runtime loaded but wiki tools were absent; got ${mcpToolNames.join(", ")}`
    );
  }
}

const liveRuntime = await startLiveForgeHealthChild();
try {
  const openClawConfigPath = path.join(tempHome, ".openclaw", "openclaw.json");
  fs.mkdirSync(path.dirname(openClawConfigPath), { recursive: true });
  fs.writeFileSync(
    openClawConfigPath,
    `${JSON.stringify(
      {
        plugins: {
          allow: ["forge-openclaw-plugin", "other-plugin"],
          entries: {
            "forge-openclaw-plugin": {
              enabled: true,
              config: { dataRoot, port: 4317 }
            },
            "other-plugin": {
              enabled: true,
              config: { keep: true }
            }
          }
        }
      },
      null,
      2
    )}\n`
  );
  const hermesConfigPath = path.join(tempHome, ".hermes", "config.yaml");
  const hermesForgeConfigPath = path.join(
    tempHome,
    ".hermes",
    "forge",
    "config.json"
  );
  fs.mkdirSync(path.dirname(hermesForgeConfigPath), { recursive: true });
  fs.writeFileSync(
    hermesConfigPath,
    "plugins:\n  enabled:\n    - forge\n    - other-plugin\n"
  );
  fs.writeFileSync(hermesForgeConfigPath, `${JSON.stringify({ dataRoot })}\n`);
  writeSmokeConfig({
    ...config,
    mode: "packaged",
    port: liveRuntime.port,
    dataRoot,
    adapters: ["openclaw", "hermes", "codex"]
  });
  fs.rmSync(path.join(tempHome, ".forge", "run", "forge-memory-runtime.json"), { force: true });
  const uninstall = run(["uninstall", "--yes", "--remove-adapters", "--json"]);
  const uninstallPayload = JSON.parse(uninstall.stdout);
  if (!uninstallPayload.stop?.stopped) {
    throw new Error(
      `Expected uninstall to stop a live adopted Forge runtime, got ${uninstall.stdout}`
    );
  }
  if (!uninstallPayload.stop.pids?.includes(liveRuntime.pid)) {
    throw new Error(
      `Expected uninstall to stop pid ${liveRuntime.pid}, got ${uninstall.stdout}`
    );
  }
  await waitForExit(liveRuntime.child, "live Forge runtime child");
  const openClawConfig = JSON.parse(fs.readFileSync(openClawConfigPath, "utf8"));
  if (openClawConfig.plugins.entries["forge-openclaw-plugin"]) {
    throw new Error("Expected uninstall --remove-adapters to remove only the Forge OpenClaw entry");
  }
  if (!openClawConfig.plugins.entries["other-plugin"]) {
    throw new Error("Expected uninstall --remove-adapters to preserve unrelated OpenClaw plugin entries");
  }
  if (openClawConfig.plugins.allow.includes("forge-openclaw-plugin")) {
    throw new Error("Expected uninstall --remove-adapters to remove Forge from OpenClaw allow list");
  }
  if (!openClawConfig.plugins.allow.includes("other-plugin")) {
    throw new Error("Expected uninstall --remove-adapters to preserve unrelated OpenClaw allow entries");
  }
  const hermesConfig = fs.readFileSync(hermesConfigPath, "utf8");
  if (hermesConfig.includes("forge")) {
    throw new Error(`Expected uninstall --remove-adapters to remove Forge from Hermes config:\n${hermesConfig}`);
  }
  if (!hermesConfig.includes("other-plugin")) {
    throw new Error(`Expected uninstall --remove-adapters to preserve unrelated Hermes plugins:\n${hermesConfig}`);
  }
  if (fs.existsSync(hermesForgeConfigPath)) {
    throw new Error("Expected uninstall --remove-adapters to remove Hermes Forge config file");
  }
  const codexAfterUninstall = fs.readFileSync(codexConfigPath, "utf8");
  if (codexAfterUninstall.includes("[mcp_servers.forge]")) {
    throw new Error(`Expected uninstall --remove-adapters to remove Forge Codex MCP config:\n${codexAfterUninstall}`);
  }
  if (!codexAfterUninstall.includes("[mcp_servers.other]")) {
    throw new Error(`Expected uninstall --remove-adapters to preserve unrelated Codex MCP config:\n${codexAfterUninstall}`);
  }
} finally {
  if (liveRuntime.child.exitCode === null && liveRuntime.child.signalCode === null) {
    liveRuntime.child.kill("SIGKILL");
  }
}
if (fs.existsSync(configPath)) {
  throw new Error(
    "Expected forge-memory uninstall to remove the manager config"
  );
}
if (!fs.existsSync(dataRoot)) {
  throw new Error(
    "Expected forge-memory uninstall to keep the data folder by default"
  );
}

console.log("forge-memory smoke tests passed");
