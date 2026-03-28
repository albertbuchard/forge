import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONFIG_PATH = path.join(os.homedir(), ".openclaw", "openclaw.json");
const PLUGIN_ID = "forge-openclaw-plugin";
const FALLBACK_DATA_ROOT = path.join(os.homedir(), ".openclaw", "extensions", PLUGIN_ID);

async function resolveDataRoot() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const configured = parsed?.plugins?.entries?.[PLUGIN_ID]?.config?.dataRoot;
    if (typeof configured === "string" && configured.trim().length > 0) {
      return configured.trim();
    }
    const installPath = parsed?.plugins?.installs?.[PLUGIN_ID]?.installPath;
    if (typeof installPath === "string" && installPath.trim().length > 0) {
      return installPath.trim();
    }
  } catch {
    // Fall back to the conventional install path when OpenClaw config is unavailable.
  }
  return FALLBACK_DATA_ROOT;
}

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error("Usage: node ./scripts/with-openclaw-plugin-data-root.mjs <command> [...args]");
  process.exit(1);
}

const dataRoot = await resolveDataRoot();

const child = spawn(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    FORGE_DATA_ROOT: dataRoot
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
