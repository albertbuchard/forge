import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const projectRoot = path.resolve(pluginRoot, "..", "..");
const runtimeDist = path.join(pluginRoot, "runtime", "dist");
const openClawPackageRoot = path.join(projectRoot, "openclaw-plugin");

const requiredRuntimeFiles = [
  path.join(runtimeDist, "index.html"),
  path.join(runtimeDist, "openclaw", "api-client.js"),
  path.join(runtimeDist, "openclaw", "local-runtime.js"),
  path.join(runtimeDist, "openclaw", "plugin-entry-shared.js"),
  path.join(runtimeDist, "openclaw", "tools.js"),
  path.join(runtimeDist, "server", "server", "src", "index.js")
];

function runtimeBundleExists() {
  return requiredRuntimeFiles.every((filePath) => existsSync(filePath));
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
    child.once("error", reject);
  });
}

if (!runtimeBundleExists()) {
  console.error("[forge-codex] runtime bundle missing; building it from local source...");
  await run("npm", ["--prefix", openClawPackageRoot, "run", "build"], projectRoot);
}
