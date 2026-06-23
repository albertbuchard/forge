import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const pluginRoot = path.join(repoRoot, "openclaw-plugin");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "forge-packed-runtime-"));
const installRoot = path.join(tempRoot, "install");
const dataRoot = path.join(tempRoot, "data");
const port = 43170 + Math.floor(Math.random() * 1000);
let child = null;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    ...options
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return result;
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      throw new Error(
        `packed runtime exited before health became ready\nstdout:\n${child.stdoutLog}\nstderr:\n${child.stderrLog}`
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      if (response.ok) {
        const body = await response.json();
        if (body?.ok === true) return body;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`packed runtime did not become healthy: ${lastError?.message ?? "timed out"}`);
}

function readSetCookie(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const header = headers.get("set-cookie");
  return header ? [header] : [];
}

function cookiePairFromSetCookie(headers) {
  for (const header of headers) {
    const first = String(header).split(";")[0]?.trim();
    if (first) return first;
  }
  return null;
}

async function verifyPackedIrohPairing() {
  const sessionResponse = await fetch(`http://127.0.0.1:${port}/api/v1/auth/operator-session`, {
    headers: {
      accept: "application/json",
      host: `127.0.0.1:${port}`
    }
  });
  if (!sessionResponse.ok) {
    throw new Error(`operator session bootstrap failed with HTTP ${sessionResponse.status}`);
  }
  const cookie = cookiePairFromSetCookie(readSetCookie(sessionResponse.headers));
  if (!cookie) {
    throw new Error("operator session bootstrap did not return a cookie");
  }

  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health/pairing-sessions`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie,
      host: `127.0.0.1:${port}`
    },
    body: JSON.stringify({ userId: null, transportMode: "iroh" })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `packed runtime pairing failed with HTTP ${response.status}: ${JSON.stringify(body)}`
    );
  }
  if (
    body?.qrPayload?.transportMode !== "iroh" ||
    body?.qrPayload?.transport?.provider !== "forge-companion-iroh" ||
    !String(body?.qrPayload?.apiBaseUrl ?? "").startsWith("forge-iroh://") ||
    !String(body?.qrPayload?.uiBaseUrl ?? "").startsWith("forge-iroh://") ||
    body?.qrPayload?.transport?.publicBaseUrl !== undefined ||
    body?.qrPayload?.transport?.fallbackMode !== "none" ||
    body?.qrPayload?.transport?.localBaseUrl !== `http://127.0.0.1:${port}` ||
    !body?.qrPayload?.transport?.pairPayload?.node_id
  ) {
    throw new Error(`packed runtime did not create an Iroh pairing: ${JSON.stringify(body)}`);
  }
  return body;
}

try {
  const pack = run("npm", ["pack", "--pack-destination", tempRoot, "--json"], {
    cwd: pluginRoot
  });
  const packed = JSON.parse(pack.stdout);
  const tarball = path.join(tempRoot, packed[0].filename);

  writeFileSync(
    path.join(tempRoot, "package.json"),
    `${JSON.stringify({ name: "forge-packed-runtime-smoke", private: true, type: "module" }, null, 2)}\n`
  );
  run("npm", ["install", "--silent", "--ignore-scripts", "--legacy-peer-deps", tarball], {
    cwd: tempRoot
  });

  const installedPluginRoot = path.join(tempRoot, "node_modules", "forge-openclaw-plugin");
  const sourceManifest = path.join(installedPluginRoot, "dist", "companion-iroh-src", "Cargo.toml");
  if (!existsSync(sourceManifest)) {
    throw new Error("packed runtime did not include companion-iroh-src/Cargo.toml");
  }
  run("cargo", [
    "build",
    "--release",
    "--manifest-path",
    sourceManifest,
    "--bin",
    "forge-companion-iroh"
  ], {
    cwd: path.dirname(sourceManifest),
    timeout: 180_000
  });

  mkdirSync(installRoot, { recursive: true });
  child = spawn(
    process.execPath,
    [path.join(installedPluginRoot, "server", "index.js")],
    {
      cwd: installRoot,
      env: {
        ...process.env,
        FORGE_DATA_ROOT: dataRoot,
        HOST: "127.0.0.1",
        PORT: String(port)
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  child.stdoutLog = "";
  child.stderrLog = "";
  child.stdout.on("data", (chunk) => {
    child.stdoutLog += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    child.stderrLog += chunk.toString();
  });

  const health = await waitForHealth();
  if (health.backend !== "forge-node-runtime") {
    throw new Error(`packed runtime health returned unexpected backend ${health.backend}`);
  }
  await verifyPackedIrohPairing();
  console.log("packed openclaw runtime smoke passed");
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
