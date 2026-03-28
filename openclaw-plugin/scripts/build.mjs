import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "..");
const pluginDistDir = path.join(packageRoot, "dist");
const pluginServerDir = path.join(packageRoot, "server");
const codexRuntimeRoot = path.join(repoRoot, "plugins", "forge-codex", "runtime");
const codexRuntimeDistDir = path.join(codexRuntimeRoot, "dist");
const codexRuntimeMigrationsDir = path.join(codexRuntimeRoot, "server", "migrations");
const repoWebDistDir = path.join(repoRoot, "dist");
const repoMigrationsDir = path.join(repoRoot, "server", "migrations");

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

async function removeCompiledTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await removeCompiledTests(fullPath);
      continue;
    }
    if (entry.isFile() && /\.test\.js$/.test(entry.name)) {
      await rm(fullPath, { force: true });
    }
  }
}

await rm(pluginDistDir, { recursive: true, force: true });
await rm(pluginServerDir, { recursive: true, force: true });
await mkdir(pluginDistDir, { recursive: true });

await run("npm", ["exec", "--", "tsc", "-p", "tsconfig.build.json"], packageRoot);
await run("npm", ["exec", "--", "tsc", "-p", "../server/tsconfig.json", "--outDir", "./dist/server", "--rootDir", "../server/src"], packageRoot);
await removeCompiledTests(path.join(pluginDistDir, "server"));
await run("npm", ["run", "build"], repoRoot);

await cp(repoWebDistDir, pluginDistDir, { recursive: true, force: true });
await mkdir(path.join(pluginServerDir), { recursive: true });
await cp(repoMigrationsDir, path.join(pluginServerDir, "migrations"), { recursive: true, force: true });

await rm(codexRuntimeDistDir, { recursive: true, force: true });
await rm(codexRuntimeMigrationsDir, { recursive: true, force: true });
await mkdir(codexRuntimeRoot, { recursive: true });
await cp(pluginDistDir, codexRuntimeDistDir, { recursive: true, force: true });
await mkdir(path.join(codexRuntimeRoot, "server"), { recursive: true });
await cp(repoMigrationsDir, codexRuntimeMigrationsDir, { recursive: true, force: true });
