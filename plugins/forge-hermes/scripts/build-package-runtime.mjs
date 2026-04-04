import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const forgeRoot = path.resolve(pluginRoot, "..", "..");
const runtimeRoot = path.join(pluginRoot, "forge_hermes", "runtime");
const runtimeDistDir = path.join(runtimeRoot, "dist");
const runtimeServerDir = path.join(runtimeRoot, "server");
const runtimeMigrationsDir = path.join(runtimeServerDir, "migrations");
const openclawPluginRoot = path.join(forgeRoot, "openclaw-plugin");
const openclawDistDir = path.join(openclawPluginRoot, "dist");
const forgeMigrationsDir = path.join(forgeRoot, "server", "migrations");

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
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

await run("npm", ["run", "build:openclaw-plugin"], forgeRoot);

await rm(runtimeDistDir, { recursive: true, force: true });
await rm(runtimeMigrationsDir, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
await mkdir(runtimeServerDir, { recursive: true });

await cp(openclawDistDir, runtimeDistDir, { recursive: true, force: true });
await cp(forgeMigrationsDir, runtimeMigrationsDir, { recursive: true, force: true });
