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

async function listMcpTools() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, "mcp"],
    cwd: packageRoot,
    env
  });
  const client = new Client({ name: "forge-memory-smoke", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await client.listTools();
  } finally {
    await client.close();
  }
}

run(["--help"]);
run(["--version"]);
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
run(["doctor", "--json"]);
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
const mcpTools = await listMcpTools();
const mcpToolNames = mcpTools.tools.map((tool) => tool.name);
if (!mcpToolNames.includes("forge_search_wiki")) {
  throw new Error(
    `Expected forge-memory mcp to expose wiki tools; got ${mcpToolNames.join(", ")}`
  );
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
