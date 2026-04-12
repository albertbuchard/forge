import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..");
const builtRuntimeEntry = path.join(packageRoot, "dist", "server", "server", "src", "index.js");
const devRuntimeEntry = path.join(repoRoot, "server", "src", "index.ts");
const devDataRootWrapper = path.join(repoRoot, "scripts", "with-openclaw-plugin-data-root.mjs");
const tsxCliEntry = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const devModeFlag = (process.env.FORGE_OPENCLAW_DEV ?? "").trim().toLowerCase();
const useDevRuntime = devModeFlag === "1" || devModeFlag === "true" || devModeFlag === "yes";

if (!useDevRuntime) {
  await import(pathToFileURL(builtRuntimeEntry).href);
} else {
  if (!existsSync(devRuntimeEntry) || !existsSync(devDataRootWrapper) || !existsSync(tsxCliEntry)) {
    throw new Error(
      "FORGE_OPENCLAW_DEV is enabled, but the Forge repo dev runtime was not found. " +
        "Run this from the Forge repository checkout or disable FORGE_OPENCLAW_DEV."
    );
  }

  console.log("[forge-openclaw-plugin] starting source-backed dev runtime on port", process.env.PORT ?? "4317");

  const child = spawn(
    process.execPath,
    [devDataRootWrapper, process.execPath, tsxCliEntry, "watch", devRuntimeEntry],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        FORGE_DEV_WEB_ORIGIN:
          process.env.FORGE_DEV_WEB_ORIGIN ?? "http://127.0.0.1:3027/forge/",
        HOST: process.env.HOST ?? "0.0.0.0",
        PORT: process.env.PORT ?? "4317"
      }
    }
  );

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        process.exitCode = signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1;
        resolve();
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Forge OpenClaw dev runtime exited with code ${code ?? "unknown"}.`));
    });
  });
}

