import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const monorepoDataRoot = path.resolve(projectRoot, "..", "..", "data", "forge");
const runtimePreferencePath = path.resolve(projectRoot, "..", "..", "data", "forge-runtime.json");

function resolvePreferredDataRoot() {
  if (existsSync(runtimePreferencePath)) {
    try {
      const parsed = JSON.parse(readFileSync(runtimePreferencePath, "utf8"));
      if (typeof parsed?.dataRoot === "string" && parsed.dataRoot.trim().length > 0) {
        return path.resolve(parsed.dataRoot.trim());
      }
    } catch {
      // Ignore invalid local runtime preference files and fall back to monorepo data root.
    }
  }
  return monorepoDataRoot;
}

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error("Usage: node ./scripts/with-monorepo-data-root.mjs <command> [...args]");
  process.exit(1);
}

const child = spawn(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    FORGE_DATA_ROOT: resolvePreferredDataRoot()
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
