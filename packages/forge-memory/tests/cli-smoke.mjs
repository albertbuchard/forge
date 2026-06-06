import { spawnSync } from "node:child_process";
import fs from "node:fs";
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

run(["uninstall", "--yes", "--json"]);
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
