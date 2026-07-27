import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const forgeRepoRoot = path.resolve(packageRoot, "../..");
const bin = path.join(packageRoot, "bin", "forge-memory.mjs");
const packageVersion = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")
).version;
const runtimePackageName = "forge-openclaw-plugin";
const cliSource = fs.readFileSync(bin, "utf8");
if (
  !cliSource.includes('path.join(repoRoot, "apps", "api", "src", "index.ts")')
) {
  throw new Error(
    "Forge Memory dev runtime must prefer the current apps/api entry"
  );
}
if (!cliSource.includes("isForgeDevWebServer(config.webPort, config.repo)")) {
  throw new Error(
    "Forge Memory dev runtime must validate reusable Vite servers"
  );
}
if (
  !cliSource.includes("FORGE_API_ORIGIN: `http://127.0.0.1:${config.port}`")
) {
  throw new Error(
    "Forge Memory dev Vite must proxy to the configured API port"
  );
}
if (
  !cliSource.includes(
    "environment.FORGE_CANONICAL_EXTERNAL_ORIGIN ="
  )
) {
  throw new Error(
    "Forge Memory must pass its persisted canonical HTTPS origin only to the managed runtime"
  );
}
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "forge-memory-home-"));
const dataRoot = path.join(tempHome, "data");
const fakeBinDir = path.join(tempHome, "bin");
const fakeIrohBin = path.join(
  fakeBinDir,
  process.platform === "win32"
    ? "forge-companion-iroh.exe"
    : "forge-companion-iroh"
);
fs.mkdirSync(fakeBinDir, { recursive: true });
fs.writeFileSync(
  fakeIrohBin,
  process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n"
);
if (process.platform !== "win32") fs.chmodSync(fakeIrohBin, 0o755);
const fakeTailscaleBin = path.join(
  fakeBinDir,
  process.platform === "win32" ? "tailscale.cmd" : "tailscale"
);
fs.writeFileSync(
  fakeTailscaleBin,
  process.platform === "win32"
    ? [
        "@echo off",
        'if "%1"=="status" if "%2"=="--json" (echo {"BackendState":"Running","Self":{"DNSName":"mac.tailnet.ts.net."}}& exit /b 0)',
        'if "%1"=="serve" (echo %*>>"%FORGE_MEMORY_FAKE_TAILSCALE_LOG%"& exit /b 0)',
        "exit /b 1",
        ""
      ].join("\r\n")
    : [
        "#!/bin/sh",
        'if [ "$1" = "status" ] && [ "$2" = "--json" ]; then',
        '  printf \'%s\\n\' \'{"BackendState":"Running","Self":{"DNSName":"mac.tailnet.ts.net."}}\'',
        "  exit 0",
        "fi",
        'if [ "$1" = "serve" ]; then',
        '  printf \'%s\\n\' "$*" >> "$FORGE_MEMORY_FAKE_TAILSCALE_LOG"',
        "  exit 0",
        "fi",
        "exit 1",
        ""
      ].join("\n")
);
if (process.platform !== "win32") fs.chmodSync(fakeTailscaleBin, 0o755);
const env = {
  ...process.env,
  NODE_ENV: "test",
  HOME: tempHome,
  USERPROFILE: tempHome,
  PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
  FORGE_COMPANION_IROH_BIN: fakeIrohBin,
  FORGE_API_TOKEN: "forge-memory-cli-smoke-token",
  FORGE_MEMORY_TEST_DISABLE_MACOS_BROWSER_HANDLER: "1",
  FORGE_MEMORY_SKIP_TAILSCALE_AUTODETECT: "1"
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

function runFailure(args, options = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: packageRoot,
    env,
    encoding: "utf8",
    timeout: 20_000,
    ...options
  });
  if (result.status === 0) {
    throw new Error(
      `forge-memory ${args.join(" ")} unexpectedly succeeded\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return result;
}

function runAsync(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: packageRoot,
      env,
      ...options
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`forge-memory ${args.join(" ")} timed out`));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      if (status !== 0) {
        reject(
          new Error(
            `forge-memory ${args.join(" ")} failed\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        );
        return;
      }
      resolve({ stdout, stderr, status });
    });
  });
}

function runAsyncFailure(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: packageRoot,
      env,
      ...options
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`forge-memory ${args.join(" ")} timed out`));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      if (status === 0) {
        reject(
          new Error(
            `forge-memory ${args.join(" ")} unexpectedly succeeded\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        );
        return;
      }
      resolve({ stdout, stderr, status });
    });
  });
}

function writeSmokeConfig(overrides = {}) {
  const configPath = path.join(tempHome, ".forge", "config.json");
  const current = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : {};
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({ ...current, ...overrides }, null, 2)}\n`
  );
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function writePairingSmokeConfig(port) {
  return writeSmokeConfig({
    mode: "dev",
    repo: forgeRepoRoot,
    port,
    dataRoot,
    adapters: [],
    canonicalExternalOrigin: null
  });
}

function countText(source, pattern) {
  return source.match(new RegExp(pattern, "gm"))?.length ?? 0;
}

async function withFakeForgeServer(handler, callback, options = {}) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", async () => {
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body
      });
      const result =
        request.url === "/api/health" && options.forgeLiveness !== false
          ? {
              body: {
                ok: true,
                app: "forge",
                security: "credential-required"
              }
            }
          : await handler(request, body);
      response.statusCode = result.statusCode ?? 200;
      for (const [key, value] of Object.entries(result.headers ?? {})) {
        response.setHeader(key, value);
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(result.body ?? {}));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    return await callback({ port: address.port, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withPlainServer(callback) {
  const server = http.createServer((request, response) => {
    response.statusCode = 204;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    return await callback({ port: address.port });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function forgeHealthResponse({
  packageName = runtimePackageName,
  runtimeVersion = packageVersion,
  pid = null
} = {}) {
  return {
    app: "forge",
    apiVersion: "v1",
    backend: "forge-node-runtime",
    runtime: {
      basePath: "/forge/",
      storageRoot: dataRoot,
      packageName,
      packageVersion: runtimeVersion,
      ...(Number.isInteger(pid) && pid > 0 ? { pid } : {})
    }
  };
}

async function startLiveForgeHealthChild() {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
const http = require("node:http");
const server = http.createServer((request, response) => {
  if (request.url === "/api/v1/health") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      ok: true,
      app: "forge",
      apiVersion: "v1",
      backend: "forge-node-runtime",
      runtime: {
        pid: process.pid,
        basePath: "/forge/",
        storageRoot: process.env.FORGE_DATA_ROOT,
        packageName: process.env.FORGE_RUNTIME_PACKAGE_NAME,
        packageVersion: process.env.FORGE_RUNTIME_PACKAGE_VERSION
      }
    }));
    return;
  }
  response.statusCode = 404;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ error: "not found" }));
});
server.listen(0, "127.0.0.1", () => {
  console.log(server.address().port);
});
      `
    ],
    {
      env: {
        ...env,
        FORGE_DATA_ROOT: dataRoot,
        FORGE_RUNTIME_PACKAGE_NAME: runtimePackageName,
        FORGE_RUNTIME_PACKAGE_VERSION: packageVersion
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const port = await new Promise((resolve, reject) => {
    const failBeforeListen = (code) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Live Forge health child exited before listening: ${code}\n${stderr}`
        )
      );
    };
    const timeout = setTimeout(() => {
      child.off("exit", failBeforeListen);
      child.kill("SIGKILL");
      reject(
        new Error(`Timed out waiting for live Forge health child\n${stderr}`)
      );
    }, 5_000);
    child.stdout.once("data", (chunk) => {
      clearTimeout(timeout);
      child.off("exit", failBeforeListen);
      const parsed = Number(String(chunk).trim());
      if (!Number.isInteger(parsed) || parsed <= 0) {
        child.kill("SIGKILL");
        reject(new Error(`Invalid child health port: ${chunk}`));
        return;
      }
      resolve(parsed);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", failBeforeListen);
  });
  return { child, port, pid: child.pid };
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processIdentity(pid) {
  const result = spawnSync(
    "ps",
    ["-p", String(pid), "-o", "lstart=", "-o", "comm="],
    { encoding: "utf8" }
  );
  const text = result.status === 0 ? result.stdout.trim() : "";
  if (!text) {
    throw new Error(`Could not read process identity for ${pid}`);
  }
  return createHash("sha256")
    .update(`${process.platform}\0${pid}\0${text}`)
    .digest("hex");
}

async function waitForPidExit(pid, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!pidExists(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} (${pid}) did not exit`);
}

async function startDetachedRecordedRuntimeGroup() {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore"
});
console.log(JSON.stringify({ parentPid: process.pid, childPid: child.pid }));
setInterval(() => {}, 1000);
      `
    ],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  child.unref();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const payload = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else {
        child.kill("SIGKILL");
      }
      reject(
        new Error(`Timed out waiting for detached runtime group\n${stderr}`)
      );
    }, 5_000);
    child.stdout.once("data", (chunk) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(String(chunk)));
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  return {
    child,
    parentPid: payload.parentPid,
    childPid: payload.childPid
  };
}

async function inspectMcp() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, "mcp"],
    cwd: packageRoot,
    env
  });
  const client = new Client({ name: "forge-memory-smoke", version: "0.0.0" });
  await client.connect(transport);
  try {
    return {
      tools: await client.listTools(),
      diagnostics: await client.callTool({
        name: "forge_memory_mcp_diagnostics",
        arguments: {}
      })
    };
  } finally {
    await client.close();
  }
}

run(["--help"]);
run(["--version"]);
for (const peerOption of [
  "--enable-peer",
  "--disable-peer",
  "--enable-peer-iroh",
  "--disable-peer-iroh",
  "--peer-endpoint <ip:port>",
  "--allow-loopback-peer"
]) {
  if (!run(["--help"]).stdout.includes(peerOption)) {
    throw new Error(`Expected Forge Memory help to include ${peerOption}`);
  }
}
const conflictingPeerFlags = runFailure([
  "configure",
  "--enable-peer",
  "--disable-peer"
]);
if (!conflictingPeerFlags.stderr.includes("cannot be used together")) {
  throw new Error("Expected conflicting peer enable/disable flags to fail");
}
const conflictingPeerIrohFlags = runFailure([
  "configure",
  "--enable-peer-iroh",
  "--disable-peer-iroh"
]);
if (!conflictingPeerIrohFlags.stderr.includes("cannot be used together")) {
  throw new Error("Expected conflicting peer Iroh flags to fail");
}
const missingAdapter = runFailure(
  [
    "configure",
    "--dev",
    "--yes",
    "--dry-run",
    "--no-start",
    "--no-doctor",
    "--skip-pair-ios",
    "--adapters",
    "openclaw",
    "--json"
  ],
  {
    env: { ...env, PATH: fakeBinDir }
  }
);
const missingAdapterPayload = JSON.parse(missingAdapter.stdout);
if (
  missingAdapterPayload.ok !== false ||
  missingAdapterPayload.adapterResults?.[0]?.adapter !== "openclaw" ||
  missingAdapterPayload.adapterResults?.[0]?.ok !== false
) {
  throw new Error(
    `Expected a required adapter failure to fail the one-command install, got ${missingAdapter.stdout}`
  );
}
const guidedDryRun = run(
  [
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
    "0"
  ],
  {
    env: { ...env, NODE_OPTIONS: "--throw-deprecation" }
  }
);
for (const expected of [
  "Looking for host adapters",
  "Saving Forge settings",
  "Preparing Forge data folder",
  "Skipping host adapter configuration",
  "Runtime start skipped",
  "Running Forge doctor",
  "iOS pairing skipped",
  "Forge Memory configured and checked."
]) {
  if (!guidedDryRun.stdout.includes(expected)) {
    throw new Error(`Expected guided install output to include: ${expected}`);
  }
}
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
const devRepoPreview = JSON.parse(
  run([
    "configure",
    "--dev",
    "--yes",
    "--dry-run",
    "--no-start",
    "--no-doctor",
    "--skip-pair-ios",
    "--adapters",
    "none",
    "--json"
  ]).stdout
);
if (devRepoPreview.config.repo !== forgeRepoRoot) {
  throw new Error(
    `Expected --dev to discover the current Forge source tree, got ${devRepoPreview.config.repo}`
  );
}
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
const initialConfigPath = path.join(tempHome, ".forge", "config.json");
const initialConfigBytes = fs.readFileSync(initialConfigPath);
const initialConfig = JSON.parse(initialConfigBytes.toString("utf8"));
if (
  initialConfig.peer?.enabled !== false ||
  initialConfig.peer?.irohEnabled !== false ||
  initialConfig.peer?.allowLoopbackDirect !== false ||
  initialConfig.peer?.directEndpoints?.length !== 0
) {
  throw new Error(
    `Expected a non-interactive install to keep peer sharing disabled by default, got ${JSON.stringify(initialConfig.peer)}`
  );
}
const inheritedPeerStatus = JSON.parse(
  run(["status", "--json"], {
    env: {
      ...env,
      FORGE_PEER_ENABLED: "1",
      FORGE_PEER_BIN: "/tmp/untrusted-forge-peer",
      FORGE_PEER_ENABLE_IROH: "1",
      FORGE_PEER_DIRECT_ENDPOINTS: "127.0.0.1:1"
    }
  }).stdout
);
if (
  inheritedPeerStatus.peer?.enabled !== false ||
  inheritedPeerStatus.peer?.runtime?.enabled !== false
) {
  throw new Error(
    "Expected persisted Forge Memory settings to ignore inherited peer environment variables"
  );
}
const loopbackPeerFailure = runFailure([
  "configure",
  "--yes",
  "--dry-run",
  "--no-start",
  "--no-doctor",
  "--skip-pair-ios",
  "--enable-peer",
  "--peer-endpoint",
  "127.0.0.1:4318",
  "--json"
]);
if (!loopbackPeerFailure.stderr.includes("requires --allow-loopback-peer")) {
  throw new Error(
    "Expected loopback peer endpoints to require explicit opt-in"
  );
}
const peerPreview = JSON.parse(
  run([
    "configure",
    "--yes",
    "--dry-run",
    "--no-start",
    "--no-doctor",
    "--skip-pair-ios",
    "--enable-peer",
    "--allow-loopback-peer",
    "--peer-endpoint",
    "127.0.0.1:4318",
    "--json"
  ]).stdout
);
if (
  peerPreview.config.peerEnabled !== true ||
  peerPreview.config.peerIrohEnabled !== true ||
  peerPreview.config.peerAllowLoopbackDirect !== true ||
  peerPreview.config.peerDirectEndpoints?.join(",") !== "127.0.0.1:4318"
) {
  throw new Error(
    `Expected an explicit loopback test configuration in dry-run output, got ${JSON.stringify(peerPreview.config)}`
  );
}
const irohOnlyPeerPreview = JSON.parse(
  run([
    "configure",
    "--yes",
    "--dry-run",
    "--no-start",
    "--no-doctor",
    "--skip-pair-ios",
    "--enable-peer",
    "--enable-peer-iroh",
    "--json"
  ]).stdout
);
if (
  irohOnlyPeerPreview.config.peerIrohEnabled !== true ||
  irohOnlyPeerPreview.config.peerDirectEndpoints?.length !== 0
) {
  throw new Error(
    `Expected Iroh-only peer sharing to work without a direct endpoint, got ${JSON.stringify(irohOnlyPeerPreview.config)}`
  );
}
if (!fs.readFileSync(initialConfigPath).equals(initialConfigBytes)) {
  throw new Error("Expected peer configuration dry-runs not to change config");
}
const hostnamePeerFailure = runFailure([
  "configure",
  "--yes",
  "--dry-run",
  "--no-start",
  "--no-doctor",
  "--skip-pair-ios",
  "--enable-peer",
  "--peer-endpoint",
  "peer.example.test:4318",
  "--json"
]);
if (!hostnamePeerFailure.stderr.includes("must use an IPv4 address")) {
  throw new Error("Expected peer endpoints to reject unresolved hostnames");
}
fs.writeFileSync(
  path.join(dataRoot, "install-preserved.txt"),
  "preserve across reinstall\n"
);
await withFakeForgeServer(
  async (request) => {
    if (request.url === "/api/health") {
      return {
        body: {
          ok: true,
          app: "forge",
          security: "credential-required"
        }
      };
    }
    if (request.url === "/api/v1/health")
      return { body: forgeHealthResponse() };
    return { statusCode: 404, body: { error: "not found" } };
  },
  async ({ port }) => {
    await withPlainServer(async ({ port: webPort }) => {
      const adoptionInstall = await runAsync([
        "install",
        "--yes",
        "--no-start",
        "--skip-pair-ios",
        "--adapters",
        "none",
        "--data-root",
        dataRoot,
        "--port",
        String(port),
        "--web-port",
        String(webPort),
        "--json"
      ]);
      const payload = JSON.parse(adoptionInstall.stdout);
      if (payload.config.port !== port) {
        throw new Error(
          `Expected install to preserve healthy Forge runtime port ${port}, got ${payload.config.port}`
        );
      }
      if (payload.config.webPort !== webPort) {
        throw new Error(
          `Expected install to preserve requested dev web port ${webPort}, got ${payload.config.webPort}`
        );
      }
      if (!fs.existsSync(path.join(dataRoot, "install-preserved.txt"))) {
        throw new Error(
          "Expected a repeated install to preserve existing Forge data-root files"
        );
      }
    });
  }
);
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
fs.rmSync(dataRoot, { recursive: true, force: true });
const repairedDoctor = run(["doctor", "--json", "--repair", "--no-start"]);
const repairedPayload = JSON.parse(repairedDoctor.stdout);
const dataRootCheck = repairedPayload.checks.find(
  (check) => check.id === "dataRoot"
);
if (
  !dataRootCheck?.ok ||
  !dataRootCheck.repaired ||
  !dataRootCheck.directory ||
  !dataRootCheck.readable ||
  !dataRootCheck.writable
) {
  throw new Error(
    `Expected doctor --repair --no-start to recreate a usable dataRoot, got ${JSON.stringify(dataRootCheck)}`
  );
}
const doctorPreservationMarker = path.join(dataRoot, "doctor-preserved.txt");
fs.writeFileSync(doctorPreservationMarker, "doctor must preserve this\n");
const readOnlyDoctor = JSON.parse(run(["doctor", "--json"]).stdout);
const readOnlyDataRootCheck = readOnlyDoctor.checks.find(
  (check) => check.id === "dataRoot"
);
if (!readOnlyDataRootCheck?.ok || readOnlyDataRootCheck.repaired) {
  throw new Error(
    `Expected ordinary doctor to inspect the existing dataRoot without repair, got ${JSON.stringify(readOnlyDataRootCheck)}`
  );
}
if (
  fs.readFileSync(doctorPreservationMarker, "utf8") !==
  "doctor must preserve this\n"
) {
  throw new Error(
    "Expected doctor to preserve existing data-root files exactly"
  );
}
const pairingFailure = runFailure(["pair-ios", "--json", "--no-start"]);
if (!pairingFailure.stderr.includes("iOS pairing was not started")) {
  throw new Error(
    "Expected unreachable pairing to stop before creating a pairing"
  );
}
if (!pairingFailure.stderr.includes("doctor --repair")) {
  throw new Error("Expected unreachable pairing to point at doctor --repair");
}
const manualHttpFailure = runFailure([
  "pair-ios",
  "--json",
  "--manual-http",
  "--public-url",
  "http://127.0.0.1:4317/forge/"
]);
if (!manualHttpFailure.stderr.includes("loopback-only")) {
  throw new Error(
    "Expected manual HTTP pairing to reject loopback public URLs for physical iPhones"
  );
}
const sourceOnlyRepo = path.join(tempHome, "source-only-iroh-repo");
fs.mkdirSync(path.join(sourceOnlyRepo, "companion-iroh", "src"), {
  recursive: true
});
fs.writeFileSync(
  path.join(sourceOnlyRepo, "companion-iroh", "Cargo.toml"),
  '[package]\nname = "forge-companion-iroh"\nversion = "0.0.0"\nedition = "2021"\n\n[[bin]]\nname = "forge-companion-iroh"\npath = "src/main.rs"\n'
);
fs.writeFileSync(
  path.join(sourceOnlyRepo, "companion-iroh", "src", "main.rs"),
  "fn main() {}\n"
);
writeSmokeConfig({
  mode: "dev",
  repo: sourceOnlyRepo,
  port: 0,
  dataRoot,
  adapters: []
});
const missingRustEnv = { ...env, PATH: "" };
delete missingRustEnv.FORGE_COMPANION_IROH_BIN;
const missingRustFailure = runFailure(["pair-ios", "--json", "--no-start"], {
  env: missingRustEnv
});
const missingRustPayload = JSON.parse(missingRustFailure.stderr);
if (!missingRustPayload.error.includes("Rust/Cargo is not installed")) {
  throw new Error(
    "Expected source-only Iroh pairing to explain missing Rust/Cargo"
  );
}
if (!missingRustPayload.error.includes("Install steps:")) {
  throw new Error(
    "Expected source-only Iroh pairing to include installer guidance"
  );
}
const codexConfigPath = path.join(tempHome, ".codex", "config.toml");
fs.mkdirSync(path.dirname(codexConfigPath), { recursive: true });
fs.writeFileSync(
  codexConfigPath,
  [
    'BROWSER_USE_CODEX_APP_BUILD_FLAVOR = "prod"',
    'command = "npx"',
    'args = ["forge-memory", "mcp"]',
    "",
    "[mcp_servers.forge.env]",
    'FORGE_ORIGIN = "http://127.0.0.1"',
    'FORGE_PORT = "4317"',
    'FORGE_ACTOR_LABEL = "codex"',
    "",
    "[mcp_servers.forge]",
    'command = "npx"',
    'args = ["forge-memory", "mcp"]',
    "",
    "[mcp_servers.forge.env]",
    'FORGE_ORIGIN = "http://127.0.0.1"',
    'FORGE_PORT = "4317"',
    'FORGE_ACTOR_LABEL = "codex"',
    'FORGE_TIMEOUT_MS = "15000"',
    `FORGE_DATA_ROOT = "${dataRoot}"`,
    "",
    "[mcp_servers.other]",
    'command = "npx"',
    'args = ["some-other-mcp"]',
    "",
    "[desktop]",
    'appearanceTheme = "dark"',
    ""
  ].join("\n")
);
run([
  "configure",
  "--yes",
  "--no-start",
  "--skip-pair-ios",
  "--adapters",
  "codex",
  "--json"
]);
run([
  "configure",
  "--yes",
  "--no-start",
  "--skip-pair-ios",
  "--adapters",
  "codex",
  "--json"
]);
const codexConfig = fs.readFileSync(codexConfigPath, "utf8");
if (countText(codexConfig, "^\\[mcp_servers\\.forge\\]$") !== 1) {
  throw new Error(`Expected one Codex Forge MCP table, got:\n${codexConfig}`);
}
if (countText(codexConfig, "^\\[mcp_servers\\.forge\\.env\\]$") !== 1) {
  throw new Error(
    `Expected one Codex Forge MCP env table, got:\n${codexConfig}`
  );
}
if (
  !codexConfig.includes("[desktop]") ||
  !codexConfig.includes('appearanceTheme = "dark"')
) {
  throw new Error(
    `Expected Codex desktop config to survive Forge MCP patching:\n${codexConfig}`
  );
}
if (
  !codexConfig.includes("[mcp_servers.other]") ||
  !codexConfig.includes('args = ["some-other-mcp"]')
) {
  throw new Error(
    `Expected unrelated Codex MCP server config to survive Forge MCP patching:\n${codexConfig}`
  );
}
const expectedDevMcpBin = path.join(
  forgeRepoRoot,
  "packages",
  "forge-memory",
  "bin",
  "forge-memory.mjs"
);
if (
  !codexConfig.includes(`command = ${JSON.stringify(process.execPath)}`) ||
  !codexConfig.includes(`args = [${JSON.stringify(expectedDevMcpBin)}, "mcp"]`)
) {
  throw new Error(
    `Expected a source-backed install to connect Codex through the current Forge Memory checkout:\n${codexConfig}`
  );
}
writeSmokeConfig({ mode: "packaged", repo: null, adapters: ["codex"] });
run([
  "configure",
  "--yes",
  "--no-start",
  "--no-doctor",
  "--skip-pair-ios",
  "--adapters",
  "codex",
  "--json"
]);
const packagedCodexConfig = fs.readFileSync(codexConfigPath, "utf8");
if (
  !packagedCodexConfig.includes('command = "npx"') ||
  !packagedCodexConfig.includes('args = ["forge-memory", "mcp"]')
) {
  throw new Error(
    `Expected a packaged install to preserve the public npx Forge Memory path:\n${packagedCodexConfig}`
  );
}
const claudeConfigPath = path.join(tempHome, ".claude.json");
const claudeRulesPath = path.join(
  tempHome,
  ".claude",
  "rules",
  "forge-memory.md"
);
fs.mkdirSync(path.dirname(claudeRulesPath), { recursive: true });
fs.writeFileSync(
  claudeRulesPath,
  "# Personal Claude Forge notes\n\nKeep this operator-specific note.\n"
);
fs.writeFileSync(
  claudeConfigPath,
  `${JSON.stringify(
    {
      theme: "dark",
      mcpServers: {
        other: {
          type: "stdio",
          command: "node",
          args: ["other-mcp.js"],
          env: { KEEP: "1" }
        }
      },
      projects: {
        "/tmp/forge-smoke": {
          mcpServers: {
            localOnly: {
              type: "stdio",
              command: "node",
              args: ["local-project-mcp.js"]
            }
          }
        }
      }
    },
    null,
    2
  )}\n`
);
run([
  "configure",
  "--yes",
  "--no-start",
  "--skip-pair-ios",
  "--adapters",
  "claude",
  "--json"
]);
run([
  "configure",
  "--yes",
  "--no-start",
  "--skip-pair-ios",
  "--adapters",
  "claude",
  "--json"
]);
const claudeConfig = JSON.parse(fs.readFileSync(claudeConfigPath, "utf8"));
const claudeForge = claudeConfig.mcpServers?.forge;
if (
  !claudeForge ||
  claudeForge.type !== "stdio" ||
  claudeForge.command !== "npx" ||
  claudeForge.args?.join(" ") !== "forge-memory mcp"
) {
  throw new Error(
    `Expected Claude Forge MCP server to use npx forge-memory mcp:\n${JSON.stringify(
      claudeConfig,
      null,
      2
    )}`
  );
}
if (
  claudeForge.env?.FORGE_ACTOR_LABEL !== "claude" ||
  claudeForge.env?.FORGE_AGENT_PROVIDER !== "claude" ||
  claudeForge.env?.FORGE_DATA_ROOT !== dataRoot
) {
  throw new Error(
    `Expected Claude Forge MCP env to preserve provider and data root:\n${JSON.stringify(
      claudeForge,
      null,
      2
    )}`
  );
}
if (
  claudeConfig.theme !== "dark" ||
  claudeConfig.mcpServers?.other?.env?.KEEP !== "1" ||
  !claudeConfig.projects?.["/tmp/forge-smoke"]?.mcpServers?.localOnly
) {
  throw new Error(
    `Expected unrelated Claude settings to survive Forge MCP patching:\n${JSON.stringify(
      claudeConfig,
      null,
      2
    )}`
  );
}
const claudeRules = fs.readFileSync(claudeRulesPath, "utf8");
if (!claudeRules.includes("Keep this operator-specific note.")) {
  throw new Error(
    `Expected existing Claude rule content to survive Forge rules patching:\n${claudeRules}`
  );
}
const forgeRulesBlockCount = (
  claudeRules.match(/forge-memory:rules:start/g) ?? []
).length;
if (forgeRulesBlockCount !== 1) {
  throw new Error(
    `Expected exactly one Forge-managed Claude rules block after repeated configure, got ${forgeRulesBlockCount}:\n${claudeRules}`
  );
}
for (const expected of [
  "Prefer Forge MCP tools over ad hoc files",
  "Start wiki work by checking the active wiki settings",
  "Create or update deliberate wiki pages",
  "Redact true secrets"
]) {
  if (!claudeRules.includes(expected)) {
    throw new Error(
      `Expected Claude Forge rules to include ${expected}:\n${claudeRules}`
    );
  }
}
await withFakeForgeServer(
  async (request, body) => {
    if (request.url === "/api/v1/health") {
      return { body: forgeHealthResponse() };
    }
    if (request.url === "/api/v1/auth/operator-session") {
      return {
        headers: {
          "set-cookie": "forge_operator_session=test-session; Path=/; HttpOnly"
        },
        body: {
          session: {
            id: "ses_test",
            actorLabel: "Test",
            expiresAt: new Date(Date.now() + 60_000).toISOString()
          }
        }
      };
    }
    if (request.url === "/api/v1/health/pairing-sessions") {
      if (
        request.headers.authorization !== "Bearer forge-memory-cli-smoke-token"
      ) {
        return {
          statusCode: 401,
          body: {
            code: "auth_required",
            error: "An authenticated operator session is required."
          }
        };
      }
      const parsed = JSON.parse(body || "{}");
      if (parsed.fallbackMode !== "none") {
        return {
          statusCode: 400,
          body: {
            error: `expected default Iroh fallbackMode none, got ${parsed.fallbackMode}`
          }
        };
      }
      if ("publicUrl" in parsed) {
        return {
          statusCode: 400,
          body: { error: "default Iroh pairing should not send publicUrl" }
        };
      }
      return {
        statusCode: 201,
        body: {
          qrPayload: {
            kind: "forge_companion_pairing",
            apiBaseUrl: "forge-iroh://fake-node/api/v1",
            uiBaseUrl: "forge-iroh://fake-node/forge/",
            transportMode: parsed.transportMode,
            transport: { protocol: "iroh", provider: "forge-companion-iroh" },
            sessionId: "pair_test",
            pairingToken: "pairing-token",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            capabilities: ["health-sync"]
          }
        }
      };
    }
    return { statusCode: 404, body: { error: "not found" } };
  },
  async ({ port, requests }) => {
    writePairingSmokeConfig(port);
    const pairing = await runAsync(["pair-ios", "--json", "--no-start"]);
    const payload = JSON.parse(pairing.stdout);
    if (payload.qrPayload.sessionId !== "pair_test") {
      throw new Error(
        "Expected pair-ios --json to return the fake pairing payload"
      );
    }
    const pairingRequest = requests.find(
      (entry) => entry.url === "/api/v1/health/pairing-sessions"
    );
    if (
      pairingRequest?.headers.authorization !==
      "Bearer forge-memory-cli-smoke-token"
    ) {
      throw new Error(
        "Expected pair-ios to send its configured scoped credential to the pairing route"
      );
    }
    const humanPairing = await runAsync(["pair-ios", "--no-start"]);
    const payloadSizeMatch = humanPairing.stdout.match(
      /QR payload bytes: (?<qr>\d+); manual payload bytes: (?<manual>\d+)/
    );
    if (!payloadSizeMatch?.groups) {
      throw new Error(
        "Expected pair-ios to report QR and manual payload byte counts"
      );
    }
    if (
      Number(payloadSizeMatch.groups.qr) >=
      Number(payloadSizeMatch.groups.manual)
    ) {
      throw new Error(
        "Expected short QR payload to be smaller than the saved manual payload"
      );
    }
    const savedPairingPath = path.join(
      tempHome,
      ".forge",
      "pairing",
      "forge-companion-pair_test.json"
    );
    const savedPairing = JSON.parse(fs.readFileSync(savedPairingPath, "utf8"));
    if (
      savedPairing.sessionId !== "pair_test" ||
      savedPairing.pairingToken !== "pairing-token"
    ) {
      throw new Error(
        "Expected pair-ios to save the full manual pairing payload"
      );
    }
  }
);
await withFakeForgeServer(
  async (request) => {
    if (request.url === "/api/v1/health") {
      return {
        body: forgeHealthResponse({ runtimeVersion: "0.0.0-stale" })
      };
    }
    return { statusCode: 404, body: { error: "not found" } };
  },
  async ({ port }) => {
    writeSmokeConfig({ mode: "packaged", port, dataRoot, adapters: [] });
    fs.rmSync(
      path.join(tempHome, ".forge", "run", "forge-memory-runtime.json"),
      { force: true }
    );
    const start = await runAsync(["start"]);
    const payload = JSON.parse(start.stdout);
    if (
      payload.ok ||
      payload.runtimeVersionMismatch !== true ||
      payload.adopted !== false ||
      payload.runningRuntimePackage?.version !== "0.0.0-stale"
    ) {
      throw new Error(
        `Expected an unowned stale Forge runtime not to be adopted, got ${start.stdout}`
      );
    }
  }
);
await withFakeForgeServer(
  async (request, body) => {
    if (request.url === "/api/v1/health")
      return { body: forgeHealthResponse() };
    if (request.url === "/api/v1/auth/operator-session") {
      return {
        headers: {
          "set-cookie": "forge_operator_session=test-session; Path=/"
        },
        body: { session: { id: "ses_test" } }
      };
    }
    if (request.url === "/api/v1/health/pairing-sessions") {
      const parsed = JSON.parse(body || "{}");
      if (parsed.transportMode !== "manual-http") {
        return {
          statusCode: 400,
          body: {
            error: `expected Tailscale primary manual-http, got ${parsed.transportMode}`
          }
        };
      }
      if (parsed.fallbackMode !== "tailscale") {
        return {
          statusCode: 400,
          body: {
            error: `expected Tailscale fallbackMode, got ${parsed.fallbackMode}`
          }
        };
      }
      if (parsed.publicUrl !== "https://mac.tailnet.ts.net/forge/") {
        return {
          statusCode: 400,
          body: {
            error: `expected Tailscale publicUrl, got ${parsed.publicUrl}`
          }
        };
      }
      return {
        statusCode: 201,
        body: {
          qrPayload: {
            kind: "forge_companion_pairing",
            apiBaseUrl: "https://mac.tailnet.ts.net/api/v1",
            uiBaseUrl: "https://mac.tailnet.ts.net/forge/",
            transportMode: "manual-http",
            transport: {
              protocol: "http",
              provider: "manual-http",
              status: "ready",
              publicBaseUrl: "https://mac.tailnet.ts.net/api/v1"
            },
            sessionId: "pair_tailscale",
            pairingToken: "pairing-token",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            capabilities: ["health-sync"]
          }
        }
      };
    }
    return { statusCode: 404, body: { error: "not found" } };
  },
  async ({ port, requests }) => {
    writePairingSmokeConfig(port);
    const pairing = await runAsync(["pair-ios", "--json", "--no-start"], {
      env: {
        ...env,
        FORGE_MEMORY_SKIP_TAILSCALE_AUTODETECT: "0",
        FORGE_MEMORY_SKIP_TAILSCALE_PUBLIC_PROBE: "1",
        FORGE_MEMORY_TAILSCALE_PUBLIC_URL: "https://mac.tailnet.ts.net/forge/"
      }
    });
    const payload = JSON.parse(pairing.stdout);
    if (payload.qrPayload.sessionId !== "pair_tailscale") {
      throw new Error(
        "Expected Tailscale autodetect to create a Tailscale pairing"
      );
    }
    const pairingRequest = requests.find(
      (entry) => entry.url === "/api/v1/health/pairing-sessions"
    );
    const parsedBody = JSON.parse(pairingRequest?.body || "{}");
    if (
      parsedBody.transportMode !== "manual-http" ||
      parsedBody.fallbackMode !== "tailscale"
    ) {
      throw new Error(
        `Expected Tailscale to be primary pairing transport, got ${pairingRequest?.body}`
      );
    }
    const persisted = JSON.parse(
      fs.readFileSync(
        path.join(tempHome, ".forge", "config.json"),
        "utf8"
      )
    );
    if (
      persisted.canonicalExternalOrigin !==
      "https://mac.tailnet.ts.net"
    ) {
      throw new Error(
        `Expected the verified Tailscale origin to persist for DPoP, got ${persisted.canonicalExternalOrigin}`
      );
    }
  }
);
await withFakeForgeServer(
  async (request, body) => {
    if (request.url === "/api/v1/health")
      return { body: forgeHealthResponse() };
    if (request.url === "/api/v1/auth/operator-session") {
      return {
        headers: {
          "set-cookie": "forge_operator_session=test-session; Path=/"
        },
        body: { session: { id: "ses_test" } }
      };
    }
    if (request.url === "/api/v1/health/pairing-sessions") {
      const parsed = JSON.parse(body || "{}");
      return {
        statusCode: 201,
        body: {
          qrPayload: {
            kind: "forge_companion_pairing",
            apiBaseUrl: parsed.publicUrl.replace("/forge/", "/api/v1"),
            uiBaseUrl: parsed.publicUrl,
            transportMode: parsed.transportMode,
            transport: {
              protocol: "http",
              provider: "manual-http",
              status: "ready",
              publicBaseUrl: parsed.publicUrl.replace("/forge/", "/api/v1")
            },
            sessionId: "pair_tailscale_serve",
            pairingToken: "pairing-token",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            capabilities: ["health-sync"]
          }
        }
      };
    }
    return { statusCode: 404, body: { error: "not found" } };
  },
  async ({ port }) => {
    writePairingSmokeConfig(port);
    const serveLog = path.join(tempHome, "tailscale-serve.log");
    const probeSequence = path.join(tempHome, "tailscale-probe-sequence.txt");
    fs.rmSync(serveLog, { force: true });
    fs.writeFileSync(probeSequence, "fail\nok\n");
    const pairing = await runAsync(["pair-ios", "--yes", "--no-start"], {
      env: {
        ...env,
        FORGE_MEMORY_SKIP_TAILSCALE_AUTODETECT: "0",
        FORGE_MEMORY_TAILSCALE_PUBLIC_URL: "https://mac.tailnet.ts.net/forge/",
        FORGE_MEMORY_FAKE_TAILSCALE_LOG: serveLog,
        FORGE_MEMORY_FAKE_TAILSCALE_PUBLIC_PROBE_SEQUENCE: probeSequence
      }
    });
    if (
      !pairing.stdout.includes("Manual HTTP") ||
      !pairing.stdout.includes("https://mac.tailnet.ts.net/api/v1")
    ) {
      throw new Error(
        `Expected human Tailscale Serve pairing output, got:\n${pairing.stdout}`
      );
    }
    const serveInvocation = fs.readFileSync(serveLog, "utf8");
    if (!serveInvocation.includes(`serve --bg http://127.0.0.1:${port}`)) {
      throw new Error(
        `Expected pair-ios --yes to configure tailscale serve for Forge port ${port}, got:\n${serveInvocation}`
      );
    }
  }
);
await withFakeForgeServer(
  async (request) => {
    if (request.url === "/api/v1/health")
      return { body: forgeHealthResponse() };
    if (request.url === "/api/v1/auth/operator-session") {
      return {
        headers: {
          "set-cookie": "forge_operator_session=test-session; Path=/"
        },
        body: { session: { id: "ses_test" } }
      };
    }
    if (request.url === "/api/v1/health/pairing-sessions") {
      return {
        statusCode: 201,
        body: {
          qrPayload: {
            kind: "forge-companion-pairing",
            apiBaseUrl: "http://127.0.0.1:4317/api/v1",
            uiBaseUrl: "http://127.0.0.1:4317/forge/",
            transportMode: "manual-http",
            transport: {
              protocol: "http",
              provider: "manual-http",
              status: "ready",
              localBaseUrl: "http://127.0.0.1:4317",
              notes: ["Forge companion Iroh host is unavailable."]
            },
            sessionId: "pair_loopback",
            pairingToken: "pairing-token",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            capabilities: ["health-sync"]
          }
        }
      };
    }
    return { statusCode: 404, body: { error: "not found" } };
  },
  async ({ port }) => {
    writePairingSmokeConfig(port);
    const failure = await runAsyncFailure(["pair-ios", "--json", "--no-start"]);
    const payload = JSON.parse(failure.stderr);
    if (payload.code !== "pairing_transport_unavailable") {
      throw new Error(
        `Expected pairing_transport_unavailable, got ${payload.code}`
      );
    }
    if (!payload.error.includes("127.0.0.1")) {
      throw new Error(
        "Expected downgraded loopback pairing failure to name 127.0.0.1"
      );
    }
  }
);
await withFakeForgeServer(
  async (request) => {
    if (request.url === "/api/v1/health")
      return { body: forgeHealthResponse() };
    if (request.url === "/api/v1/auth/operator-session") {
      return {
        headers: {
          "set-cookie": "forge_operator_session=test-session; Path=/"
        },
        body: { session: { id: "ses_test" } }
      };
    }
    if (request.url === "/api/v1/health/pairing-sessions") {
      return {
        statusCode: 201,
        body: {
          qrPayload: {
            kind: "forge-companion-pairing",
            apiBaseUrl: "http://127.0.0.1:4317/api/v1",
            uiBaseUrl: "http://127.0.0.1:4317/forge/",
            transportMode: "iroh",
            transport: {
              protocol: "iroh",
              provider: "forge-companion-iroh",
              status: "ready",
              publicBaseUrl: "http://127.0.0.1:4317/api/v1",
              localBaseUrl: "http://127.0.0.1:4317",
              nodeId: "fake-node",
              pairPayload: { v: 1, node_id: "fake-node", token: "host-token" }
            },
            sessionId: "pair_bad_iroh",
            pairingToken: "pairing-token",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            capabilities: ["health-sync"]
          }
        }
      };
    }
    return { statusCode: 404, body: { error: "not found" } };
  },
  async ({ port }) => {
    writePairingSmokeConfig(port);
    const failure = await runAsyncFailure(["pair-ios", "--json", "--no-start"]);
    const payload = JSON.parse(failure.stderr);
    if (payload.code !== "pairing_transport_unavailable") {
      throw new Error(
        `Expected bad Iroh loopback QR to fail pairing_transport_unavailable, got ${payload.code}`
      );
    }
    if (
      !payload.error.includes("Iroh pairing") ||
      !payload.error.includes("loopback")
    ) {
      throw new Error(
        "Expected bad Iroh loopback QR failure to name Iroh and loopback"
      );
    }
  }
);
await withFakeForgeServer(
  async (request) => {
    if (request.url === "/api/v1/health")
      return { body: forgeHealthResponse() };
    if (request.url === "/api/v1/health/pairing-sessions") {
      return {
        statusCode: 403,
        body: {
          code: "insufficient_scope",
          error: "The credential cannot create a companion pairing."
        }
      };
    }
    return { statusCode: 404, body: { error: "not found" } };
  },
  async ({ port, requests }) => {
    writePairingSmokeConfig(port);
    const failure = await runAsyncFailure(["pair-ios", "--json", "--no-start"]);
    const payload = JSON.parse(failure.stderr);
    if (payload.code !== "pairing_request_failed") {
      throw new Error(`Expected pairing_request_failed, got ${payload.code}`);
    }
    if (
      requests.some((entry) => entry.url === "/api/v1/auth/operator-session")
    ) {
      throw new Error(
        "Expected scoped-token pairing not to fall back to the removed network-trust operator bootstrap"
      );
    }
  }
);
await withFakeForgeServer(
  async (request) => {
    if (request.url === "/api/v1/health")
      return { body: forgeHealthResponse() };
    if (request.url === "/api/v1/auth/operator-session") {
      return {
        headers: {
          "set-cookie": "forge_operator_session=test-session; Path=/"
        },
        body: { session: { id: "ses_test" } }
      };
    }
    if (request.url === "/api/v1/health/pairing-sessions") {
      return {
        statusCode: 401,
        body: {
          code: "auth_required",
          error: "An authenticated operator session is required."
        }
      };
    }
    return { statusCode: 404, body: { error: "not found" } };
  },
  async ({ port }) => {
    writePairingSmokeConfig(port);
    const failure = await runAsyncFailure(["pair-ios", "--json", "--no-start"]);
    const payload = JSON.parse(failure.stderr);
    if (payload.code !== "pairing_request_failed") {
      throw new Error(`Expected pairing_request_failed, got ${payload.code}`);
    }
    if (payload.guidance.some((entry) => entry.includes("doctor --repair"))) {
      throw new Error(
        "Expected authenticated pairing 401 to avoid generic doctor --repair guidance"
      );
    }
  }
);
await withFakeForgeServer(
  async (request) => {
    if (request.url === "/api/v1/health")
      return { body: forgeHealthResponse() };
    return { statusCode: 404, body: { error: "not found" } };
  },
  async ({ port }) => {
    writeSmokeConfig({ mode: "packaged", port, dataRoot, adapters: [] });
    fs.rmSync(
      path.join(tempHome, ".forge", "run", "forge-memory-runtime.json"),
      { force: true }
    );
    const start = await runAsync(["start"]);
    const payload = JSON.parse(start.stdout);
    if (!payload.ok || payload.started !== false || payload.adopted !== true) {
      throw new Error(
        `Expected healthy runtime adoption without spawning, got ${start.stdout}`
      );
    }
    if (
      payload.state?.adopted !== true ||
      payload.state?.children?.length !== 0
    ) {
      throw new Error(
        `Expected adopted runtime state to own no processes, got ${start.stdout}`
      );
    }
    writeSmokeConfig({
      peer: {
        enabled: true,
        irohEnabled: true,
        directEndpoints: ["127.0.0.1:4318"],
        allowLoopbackDirect: true
      }
    });
    const mismatchedStart = await runAsync(["start"]);
    const mismatchedPayload = JSON.parse(mismatchedStart.stdout);
    if (
      mismatchedPayload.ok ||
      mismatchedPayload.configurationMismatch !== true ||
      mismatchedPayload.adopted !== false
    ) {
      throw new Error(
        `Expected a healthy runtime with unknown peer settings not to be adopted, got ${mismatchedStart.stdout}`
      );
    }
    writeSmokeConfig({
      peer: {
        enabled: false,
        irohEnabled: false,
        directEndpoints: [],
        allowLoopbackDirect: false
      }
    });
  }
);
if (process.platform !== "win32") {
  await withFakeForgeServer(
    async (request) => {
      if (request.url === "/api/v1/health") {
        return { body: forgeHealthResponse({ pid: process.pid }) };
      }
      return { statusCode: 404, body: { error: "not found" } };
    },
    async ({ port }) => {
      const unrelatedRuntime = await startDetachedRecordedRuntimeGroup();
      try {
        writeSmokeConfig({ mode: "dev", port, dataRoot, adapters: [] });
        const statePath = path.join(
          tempHome,
          ".forge",
          "run",
          "forge-memory-runtime.json"
        );
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(
          statePath,
          `${JSON.stringify(
            {
              mode: "dev",
              baseUrl: `http://127.0.0.1:${port}`,
              webUrl: `http://127.0.0.1:${port}/forge/`,
              dataRoot,
              peer: {
                enabled: false,
                irohEnabled: false,
                directEndpoints: [],
                allowLoopbackDirect: false
              },
              children: [
                {
                  role: "server",
                  pid: unrelatedRuntime.parentPid,
                  identity: processIdentity(unrelatedRuntime.parentPid)
                }
              ],
              startedAt: new Date().toISOString()
            },
            null,
            2
          )}\n`
        );
        const start = await runAsync(["start"]);
        const payload = JSON.parse(start.stdout);
        if (
          !payload.ok ||
          payload.state?.adopted !== true ||
          payload.state?.observedPid !== process.pid ||
          payload.state?.children?.length !== 0
        ) {
          throw new Error(
            `Expected stale state to become a non-owning adoption, got ${start.stdout}`
          );
        }
        const stop = run(["stop", "--json"]);
        const stopPayload = JSON.parse(stop.stdout);
        if (
          stopPayload.stopped ||
          !pidExists(unrelatedRuntime.parentPid) ||
          !stopPayload.message?.includes("no external process was stopped")
        ) {
          throw new Error(
            `Expected adopted runtime stop to preserve unowned processes, got ${stop.stdout}`
          );
        }
      } finally {
        if (pidExists(unrelatedRuntime.parentPid)) {
          try {
            process.kill(-unrelatedRuntime.parentPid, "SIGKILL");
          } catch {
            // Best-effort test cleanup.
          }
        }
      }
    }
  );
}
await withFakeForgeServer(
  async () => ({
    statusCode: 404,
    body: { error: "not Forge" }
  }),
  async ({ port }) => {
    writeSmokeConfig({ mode: "packaged", port, dataRoot, adapters: [] });
    const start = await runAsync(["start"]);
    const payload = JSON.parse(start.stdout);
    if (payload.ok || !payload.portConflict) {
      throw new Error(
        `Expected occupied non-Forge port to be reported as a port conflict, got ${start.stdout}`
      );
    }
  },
  { forgeLiveness: false }
);
if (process.platform !== "win32") {
  await withPlainServer(async ({ port }) => {
    const recordedRuntime = await startDetachedRecordedRuntimeGroup();
    try {
      writeSmokeConfig({ mode: "dev", port, dataRoot, adapters: [] });
      const runtimeStatePath = path.join(
        tempHome,
        ".forge",
        "run",
        "forge-memory-runtime.json"
      );
      fs.mkdirSync(path.dirname(runtimeStatePath), { recursive: true });
      fs.writeFileSync(
        runtimeStatePath,
        `${JSON.stringify(
          {
            mode: "dev",
            baseUrl: `http://127.0.0.1:${port}`,
            webUrl: `http://127.0.0.1:${port}/forge/`,
            dataRoot,
            children: [
              {
                role: "web",
                pid: recordedRuntime.parentPid,
                identity: "0".repeat(64)
              }
            ],
            startedAt: new Date().toISOString()
          },
          null,
          2
        )}\n`
      );
      const staleStop = run(["stop", "--json"]);
      const stalePayload = JSON.parse(staleStop.stdout);
      if (stalePayload.stopped || !pidExists(recordedRuntime.parentPid)) {
        throw new Error(
          `Expected stale process identity not to be signaled, got ${staleStop.stdout}`
        );
      }
      fs.writeFileSync(
        runtimeStatePath,
        `${JSON.stringify(
          {
            mode: "dev",
            baseUrl: `http://127.0.0.1:${port}`,
            webUrl: `http://127.0.0.1:${port}/forge/`,
            dataRoot,
            children: [
              {
                role: "web",
                pid: recordedRuntime.parentPid,
                identity: processIdentity(recordedRuntime.parentPid)
              }
            ],
            startedAt: new Date().toISOString()
          },
          null,
          2
        )}\n`
      );
      const stop = run(["stop", "--json"]);
      const payload = JSON.parse(stop.stdout);
      if (
        !payload.stopped ||
        !payload.pids?.includes(recordedRuntime.parentPid)
      ) {
        throw new Error(
          `Expected stop to report recorded detached runtime pid ${recordedRuntime.parentPid}, got ${stop.stdout}`
        );
      }
      await waitForPidExit(recordedRuntime.childPid, "recorded runtime child");
    } finally {
      if (pidExists(recordedRuntime.parentPid)) {
        try {
          process.kill(-recordedRuntime.parentPid, "SIGKILL");
        } catch {
          recordedRuntime.child.kill("SIGKILL");
        }
      }
    }
  });
}
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

fs.writeFileSync(path.join(dataRoot, "update-preserved.txt"), "preserve me\n");
const safeUpdate = run([
  "update",
  "--yes",
  "--no-start",
  "--no-doctor",
  "--skip-adapters",
  "--json"
]);
const safeUpdatePayload = JSON.parse(safeUpdate.stdout);
if (!safeUpdatePayload.dataPreserved) {
  throw new Error("Expected update to report preserved data");
}
if (safeUpdatePayload.backup.sourceDataRoot !== dataRoot) {
  throw new Error(
    `Expected update backup to use the configured data root ${dataRoot}, got ${safeUpdatePayload.backup.sourceDataRoot}`
  );
}
if (!fs.existsSync(safeUpdatePayload.backup.outputPath)) {
  throw new Error(
    `Expected update to create backup archive ${safeUpdatePayload.backup.outputPath}`
  );
}
if (!fs.existsSync(path.join(dataRoot, "update-preserved.txt"))) {
  throw new Error("Expected update to keep existing dataRoot files");
}
if (safeUpdatePayload.runtimeUpdateResult.mode !== "dev") {
  throw new Error(
    `Expected dev-mode update to skip packaged runtime refresh, got ${safeUpdate.stdout}`
  );
}

const largeUpdateFailure = runFailure(
  ["update", "--json", "--no-start", "--no-doctor", "--skip-adapters"],
  {
    env: { ...env, FORGE_MEMORY_UPDATE_BACKUP_PROMPT_BYTES: "1" }
  }
);
const largeUpdatePayload = JSON.parse(largeUpdateFailure.stderr);
if (largeUpdatePayload.code !== "update_backup_confirmation_required") {
  throw new Error(
    `Expected large update to require backup confirmation, got ${largeUpdateFailure.stderr}`
  );
}

const codexSkillPath = path.join(
  tempHome,
  ".codex",
  "skills",
  "forge-openclaw"
);
fs.mkdirSync(codexSkillPath, { recursive: true });
fs.writeFileSync(path.join(codexSkillPath, "SKILL.md"), "manual edit\n");
const skillGuardUpdate = run([
  "update",
  "--yes",
  "--no-start",
  "--no-doctor",
  "--adapters",
  "codex",
  "--json"
]);
const skillGuardPayload = JSON.parse(skillGuardUpdate.stdout);
if (skillGuardPayload.skillPlan.backups.length !== 1) {
  throw new Error(
    `Expected update to back up modified Codex skill folder, got ${skillGuardUpdate.stdout}`
  );
}
const skillBackupPath = skillGuardPayload.skillPlan.backups[0].backupPath;
if (!fs.existsSync(path.join(skillBackupPath, "SKILL.md"))) {
  throw new Error(
    `Expected skill backup to include SKILL.md at ${skillBackupPath}`
  );
}
const managedSkillsManifestPath = path.join(
  tempHome,
  ".forge",
  "managed-skills.json"
);
if (!fs.existsSync(managedSkillsManifestPath)) {
  throw new Error("Expected update to record managed skill hashes");
}
run(
  [
    "update",
    "--yes",
    "--dry-run",
    "--no-start",
    "--no-doctor",
    "--skip-adapters",
    "--json"
  ],
  {
    env: { ...env, FORGE_MEMORY_UPDATE_BACKUP_PROMPT_BYTES: "1" }
  }
);
const configAfterSkipUpdate = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (configAfterSkipUpdate.adapters.join(",") !== "codex") {
  throw new Error(
    `Expected update --skip-adapters to preserve configured adapters, got ${configAfterSkipUpdate.adapters}`
  );
}

let mcp;
await withFakeForgeServer(
  async (request) => {
    if (request.url === "/api/v1/health") {
      return { body: forgeHealthResponse() };
    }
    return { statusCode: 404, body: { error: "not found" } };
  },
  async ({ port }) => {
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          ...config,
          mode: "dev",
          port,
          repo: path.resolve(packageRoot, "../..")
        },
        null,
        2
      )}\n`
    );
    mcp = await inspectMcp();
  }
);
const mcpTools = mcp.tools;
const mcpToolNames = mcpTools.tools.map((tool) => tool.name);
if (!mcpToolNames.includes("forge_memory_mcp_diagnostics")) {
  throw new Error("Expected forge-memory mcp to expose diagnostics.");
}
if (!mcpToolNames.includes("forge_search_wiki")) {
  const diagnostics = JSON.parse(mcp.diagnostics.content[0].text);
  if (diagnostics.runtimeLoaded) {
    throw new Error(
      `Forge runtime loaded but wiki tools were absent; got ${mcpToolNames.join(", ")}`
    );
  }
}
const liveRuntime = await startLiveForgeHealthChild();
try {
  const openClawConfigPath = path.join(tempHome, ".openclaw", "openclaw.json");
  fs.mkdirSync(path.dirname(openClawConfigPath), { recursive: true });
  fs.writeFileSync(
    openClawConfigPath,
    `${JSON.stringify(
      {
        plugins: {
          allow: ["forge-openclaw-plugin", "other-plugin"],
          entries: {
            "forge-openclaw-plugin": {
              enabled: true,
              config: { dataRoot, port: 4317 }
            },
            "other-plugin": {
              enabled: true,
              config: { keep: true }
            }
          }
        }
      },
      null,
      2
    )}\n`
  );
  const hermesConfigPath = path.join(tempHome, ".hermes", "config.yaml");
  const hermesForgeConfigPath = path.join(
    tempHome,
    ".hermes",
    "forge",
    "config.json"
  );
  fs.mkdirSync(path.dirname(hermesForgeConfigPath), { recursive: true });
  fs.writeFileSync(
    hermesConfigPath,
    "plugins:\n  enabled:\n    - forge\n    - other-plugin\n"
  );
  fs.writeFileSync(hermesForgeConfigPath, `${JSON.stringify({ dataRoot })}\n`);
  writeSmokeConfig({
    ...config,
    mode: "packaged",
    port: liveRuntime.port,
    dataRoot,
    adapters: ["openclaw", "hermes", "codex", "claude"]
  });
  fs.rmSync(path.join(tempHome, ".forge", "run", "forge-memory-runtime.json"), {
    force: true
  });
  const uninstall = run(["uninstall", "--yes", "--remove-adapters", "--json"]);
  const uninstallPayload = JSON.parse(uninstall.stdout);
  if (uninstallPayload.stop?.stopped) {
    throw new Error(
      `Expected uninstall not to signal an attached runtime it did not launch, got ${uninstall.stdout}`
    );
  }
  if (
    liveRuntime.child.exitCode !== null ||
    liveRuntime.child.signalCode !== null
  ) {
    throw new Error(
      `Expected attached runtime pid ${liveRuntime.pid} to remain alive for its actual owner`
    );
  }
  const openClawConfig = JSON.parse(
    fs.readFileSync(openClawConfigPath, "utf8")
  );
  if (openClawConfig.plugins.entries["forge-openclaw-plugin"]) {
    throw new Error(
      "Expected uninstall --remove-adapters to remove only the Forge OpenClaw entry"
    );
  }
  if (!openClawConfig.plugins.entries["other-plugin"]) {
    throw new Error(
      "Expected uninstall --remove-adapters to preserve unrelated OpenClaw plugin entries"
    );
  }
  if (openClawConfig.plugins.allow.includes("forge-openclaw-plugin")) {
    throw new Error(
      "Expected uninstall --remove-adapters to remove Forge from OpenClaw allow list"
    );
  }
  if (!openClawConfig.plugins.allow.includes("other-plugin")) {
    throw new Error(
      "Expected uninstall --remove-adapters to preserve unrelated OpenClaw allow entries"
    );
  }
  const hermesConfig = fs.readFileSync(hermesConfigPath, "utf8");
  if (hermesConfig.includes("forge")) {
    throw new Error(
      `Expected uninstall --remove-adapters to remove Forge from Hermes config:\n${hermesConfig}`
    );
  }
  if (!hermesConfig.includes("other-plugin")) {
    throw new Error(
      `Expected uninstall --remove-adapters to preserve unrelated Hermes plugins:\n${hermesConfig}`
    );
  }
  if (fs.existsSync(hermesForgeConfigPath)) {
    throw new Error(
      "Expected uninstall --remove-adapters to remove Hermes Forge config file"
    );
  }
  const codexAfterUninstall = fs.readFileSync(codexConfigPath, "utf8");
  if (codexAfterUninstall.includes("[mcp_servers.forge]")) {
    throw new Error(
      `Expected uninstall --remove-adapters to remove Forge Codex MCP config:\n${codexAfterUninstall}`
    );
  }
  if (!codexAfterUninstall.includes("[mcp_servers.other]")) {
    throw new Error(
      `Expected uninstall --remove-adapters to preserve unrelated Codex MCP config:\n${codexAfterUninstall}`
    );
  }
  const claudeAfterUninstall = JSON.parse(
    fs.readFileSync(claudeConfigPath, "utf8")
  );
  if (claudeAfterUninstall.mcpServers?.forge) {
    throw new Error(
      `Expected uninstall --remove-adapters to remove only Forge's Claude MCP entry:\n${JSON.stringify(
        claudeAfterUninstall,
        null,
        2
      )}`
    );
  }
  if (
    claudeAfterUninstall.theme !== "dark" ||
    claudeAfterUninstall.mcpServers?.other?.env?.KEEP !== "1" ||
    !claudeAfterUninstall.projects?.["/tmp/forge-smoke"]?.mcpServers?.localOnly
  ) {
    throw new Error(
      `Expected uninstall --remove-adapters to preserve unrelated Claude config:\n${JSON.stringify(
        claudeAfterUninstall,
        null,
        2
      )}`
    );
  }
  const claudeRulesAfterUninstall = fs.readFileSync(claudeRulesPath, "utf8");
  if (claudeRulesAfterUninstall.includes("forge-memory:rules:start")) {
    throw new Error(
      `Expected uninstall --remove-adapters to remove Forge's Claude rules block:\n${claudeRulesAfterUninstall}`
    );
  }
  if (
    !claudeRulesAfterUninstall.includes("Keep this operator-specific note.")
  ) {
    throw new Error(
      `Expected uninstall --remove-adapters to preserve unrelated Claude rule content:\n${claudeRulesAfterUninstall}`
    );
  }
} finally {
  if (
    liveRuntime.child.exitCode === null &&
    liveRuntime.child.signalCode === null
  ) {
    liveRuntime.child.kill("SIGKILL");
  }
}
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
for (const marker of ["doctor-preserved.txt", "update-preserved.txt"]) {
  if (!fs.existsSync(path.join(dataRoot, marker))) {
    throw new Error(
      `Expected forge-memory uninstall to preserve data marker ${marker}`
    );
  }
}

console.log("forge-memory smoke tests passed");
