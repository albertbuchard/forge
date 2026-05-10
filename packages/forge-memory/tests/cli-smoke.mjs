import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    throw new Error(`forge-memory ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
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
run(["configure", "--yes", "--no-start", "--skip-pair-ios", "--adapters", "none", "--json"]);
run(["status", "--json"]);
run(["doctor", "--json"]);

const configPath = path.join(tempHome, ".forge", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (config.dataRoot !== dataRoot) {
  throw new Error(`Expected dataRoot ${dataRoot}, got ${config.dataRoot}`);
}
if (!Array.isArray(config.adapters) || config.adapters.length !== 0) {
  throw new Error("Expected no adapters in smoke config");
}

console.log("forge-memory smoke tests passed");
