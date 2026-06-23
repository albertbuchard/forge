import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const forgeRoot = path.resolve(pluginRoot, "..", "..");
const runtimeRoot = path.join(pluginRoot, "forge_hermes", "runtime");
const runtimeDistDir = path.join(runtimeRoot, "dist");
const runtimePackageJsonPath = path.join(runtimeRoot, "package.json");
const runtimeApiDir = path.join(runtimeRoot, "apps", "api");
const runtimeMigrationsDir = path.join(runtimeApiDir, "migrations");
const legacyRuntimeServerDir = path.join(runtimeRoot, "server");
const openclawPluginRoot = path.join(forgeRoot, "plugins/openclaw");
const openclawDistDir = path.join(openclawPluginRoot, "dist");
const openclawPackageJsonPath = path.join(openclawPluginRoot, "package.json");
const forgeMigrationsDir = path.join(forgeRoot, "apps", "api", "migrations");
const hermesVersionPath = path.join(pluginRoot, "forge_hermes", "version.py");

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

async function readHermesPluginVersion() {
  const source = await readFile(hermesVersionPath, "utf8");
  const match = source.match(/^__version__ = "([^"]+)"$/m);
  if (!match) {
    throw new Error(`Could not read Hermes plugin version from ${hermesVersionPath}`);
  }
  return match[1];
}

async function writeRuntimePackageJson() {
  const [hermesVersion, openclawPackageJsonSource] = await Promise.all([
    readHermesPluginVersion(),
    readFile(openclawPackageJsonPath, "utf8")
  ]);
  const openclawPackageJson = JSON.parse(openclawPackageJsonSource);
  const runtimePackageJson = {
    name: "forge-hermes-runtime",
    version: hermesVersion,
    private: true,
    type: "module",
    dependencies: openclawPackageJson.dependencies ?? {}
  };
  await writeFile(`${runtimePackageJsonPath}`, `${JSON.stringify(runtimePackageJson, null, 2)}\n`, "utf8");
}

await run("npm", ["run", "build:openclaw-plugin"], forgeRoot);

await rm(runtimeDistDir, { recursive: true, force: true });
await rm(runtimeMigrationsDir, { recursive: true, force: true });
await rm(legacyRuntimeServerDir, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
await mkdir(runtimeApiDir, { recursive: true });
await writeRuntimePackageJson();

await cp(openclawDistDir, runtimeDistDir, { recursive: true, force: true });
await cp(forgeMigrationsDir, runtimeMigrationsDir, { recursive: true, force: true });
