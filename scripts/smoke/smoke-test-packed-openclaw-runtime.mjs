import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  NATIVE_SOURCE_MANIFEST_FILE,
  NATIVE_SOURCE_SIGNATURE_FILE,
  createNativeSourceManifest,
  serializeNativeSourceManifest,
  validateNativeSourceManifest,
  verifyNativeSourceBundle
} from "../../packages/forge-memory/lib/native-source-manifest.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const pluginRoot = path.join(repoRoot, "plugins/openclaw");
const tempRoot = realpathSync(
  mkdtempSync(path.join(os.tmpdir(), "forge-packed-runtime-"))
);
const installRoot = path.join(tempRoot, "install");
const dataRoot = path.join(tempRoot, "data");
const peerSourceTarget = path.join(tempRoot, "forge-peer-target");
const peerSocketPath = path.join(
  realpathSync("/tmp"),
  `forge-peer-packed-${process.pid}.sock`
);
const peerStateRoot = path.join(tempRoot, "forge-peer-state");
const port = 43170 + Math.floor(Math.random() * 1000);
const ownerUserId = "user_operator";
const releaseMode = (process.env.FORGE_RELEASE_MODE ?? "").trim();
const smokeMode = (
  process.env.FORGE_PACKED_RUNTIME_SMOKE_MODE ?? "full"
).trim();
if (!["full", "runtime"].includes(smokeMode)) {
  throw new Error(`Unsupported FORGE_PACKED_RUNTIME_SMOKE_MODE=${smokeMode}`);
}
const runtimeOnly = smokeMode === "runtime";
const requireSignedSource =
  process.env.FORGE_REQUIRE_SIGNED_NATIVE_SOURCE === "1" ||
  ["full", "prepare", "publish-from-tag"].includes(releaseMode);
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
  const deadline = Date.now() + 60_000;
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
  throw new Error(
    `packed runtime did not become healthy: ${lastError?.message ?? "timed out"}`
  );
}

async function verifyPackedForgePeerSource(
  installedPluginRoot,
  { buildBinary = true } = {}
) {
  const sourceRoot = path.join(installedPluginRoot, "dist", "forge-peer-src");
  const cargoManifest = path.join(sourceRoot, "Cargo.toml");
  const cargoLock = path.join(sourceRoot, "Cargo.lock");
  const manifestPath = path.join(sourceRoot, NATIVE_SOURCE_MANIFEST_FILE);
  const signaturePath = path.join(sourceRoot, NATIVE_SOURCE_SIGNATURE_FILE);
  for (const requiredPath of [
    sourceRoot,
    cargoManifest,
    cargoLock,
    manifestPath
  ]) {
    if (!existsSync(requiredPath)) {
      throw new Error(
        `packed runtime omitted ${path.relative(installedPluginRoot, requiredPath)}`
      );
    }
  }

  const runtimePackage = JSON.parse(
    readFileSync(path.join(installedPluginRoot, "package.json"), "utf8")
  );
  const manifest = validateNativeSourceManifest(
    JSON.parse(readFileSync(manifestPath, "utf8"))
  );
  if (manifest.runtimePackageVersion !== runtimePackage.version) {
    throw new Error(
      `forge-peer source targets runtime ${manifest.runtimePackageVersion}, expected ${runtimePackage.version}`
    );
  }
  const recomputed = await createNativeSourceManifest({
    sourceRoot,
    packageVersion: manifest.packageVersion,
    runtimePackageVersion: manifest.runtimePackageVersion,
    commitSha: manifest.commitSha,
    generatedAt: new Date(manifest.generatedAt),
    signingKeyId: manifest.signingKeyId
  });
  if (
    serializeNativeSourceManifest(recomputed) !==
    serializeNativeSourceManifest(manifest)
  ) {
    throw new Error(
      "packed forge-peer source does not match its manifest file set"
    );
  }

  if (existsSync(signaturePath)) {
    await verifyNativeSourceBundle({
      sourceRoot,
      expectedRuntimePackageVersion: runtimePackage.version
    });
  } else if (requireSignedSource) {
    throw new Error(
      `FORGE_RELEASE_MODE=${releaseMode} requires a signed forge-peer source bundle`
    );
  }

  if (!buildBinary) {
    return { binaryPath: null, sourceRoot };
  }

  run(
    "cargo",
    [
      "build",
      "--locked",
      "--release",
      "--manifest-path",
      cargoManifest,
      "--bin",
      "forge-peer"
    ],
    {
      cwd: sourceRoot,
      timeout: 600_000,
      env: { ...process.env, CARGO_TARGET_DIR: peerSourceTarget }
    }
  );

  const binaryName =
    process.platform === "win32" ? "forge-peer.exe" : "forge-peer";
  const binaryPath = path.join(peerSourceTarget, "release", binaryName);
  if (!existsSync(binaryPath)) {
    throw new Error(
      "locked packed forge-peer build did not produce its daemon binary"
    );
  }
  return { binaryPath, sourceRoot };
}

async function verifyPackedPeerDaemon(installedPluginRoot) {
  const gatewayModulePath = path.join(
    installedPluginRoot,
    "dist",
    "server",
    "apps",
    "api",
    "src",
    "services",
    "peer-core-ipc-gateway.js"
  );
  const { UnixSocketPeerCoreGateway } = await import(
    pathToFileURL(gatewayModulePath).href
  );
  const gateway = new UnixSocketPeerCoreGateway({
    socketPath: peerSocketPath,
    ownerUserId
  });
  const deadline = Date.now() + 60_000;
  let health = null;
  while (Date.now() < deadline) {
    health = await gateway.health();
    if (
      health.enabled &&
      health.healthy &&
      health.protocolVersion === "forge-peer/1"
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (
    !health?.enabled ||
    !health.healthy ||
    health.protocolVersion !== "forge-peer/1"
  ) {
    throw new Error(
      `packed forge-peer daemon health failed: ${JSON.stringify(health)}\nstdout:\n${child?.stdoutLog ?? ""}\nstderr:\n${child?.stderrLog ?? ""}`
    );
  }
  const identity = await gateway.localIdentity({ ownerUserId });
  if (
    !identity?.principal?.id ||
    !identity?.principal?.rootPublicKey ||
    identity?.principal?.trustState !== "verified" ||
    !identity?.device?.id ||
    identity?.device?.principalId !== identity?.principal?.id
  ) {
    throw new Error(
      `packed forge-peer daemon identity failed: ${JSON.stringify(identity)}`
    );
  }
  return { health, identity };
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
  const sessionResponse = await fetch(
    `http://127.0.0.1:${port}/api/v1/auth/operator-session`,
    {
      headers: {
        accept: "application/json",
        host: `127.0.0.1:${port}`
      }
    }
  );
  if (!sessionResponse.ok) {
    throw new Error(
      `operator session bootstrap failed with HTTP ${sessionResponse.status}`
    );
  }
  const cookie = cookiePairFromSetCookie(
    readSetCookie(sessionResponse.headers)
  );
  if (!cookie) {
    throw new Error("operator session bootstrap did not return a cookie");
  }

  const response = await fetch(
    `http://127.0.0.1:${port}/api/v1/health/pairing-sessions`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie,
        host: `127.0.0.1:${port}`
      },
      body: JSON.stringify({ userId: null, transportMode: "iroh" })
    }
  );
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
    throw new Error(
      `packed runtime did not create an Iroh pairing: ${JSON.stringify(body)}`
    );
  }
  return { body, cookie };
}

async function verifyPackedPeopleApi(cookie) {
  const createdResponse = await fetch(
    `http://127.0.0.1:${port}/api/v1/entities/create`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie,
        host: `127.0.0.1:${port}`
      },
      body: JSON.stringify({
        atomic: true,
        operations: [
          {
            entityType: "person",
            clientRef: "packed-runtime-person",
            idempotencyKey: "packed-runtime-person-v1",
            data: {
              userId: ownerUserId,
              displayName: "Packed runtime Person",
              relationshipCategory: "colleague",
              shortDescription: "Isolated packed-runtime verification record."
            }
          }
        ]
      })
    }
  );
  const created = await createdResponse.json().catch(() => null);
  if (!createdResponse.ok || created?.results?.[0]?.ok !== true) {
    throw new Error(
      `packed runtime Person create failed with HTTP ${createdResponse.status}: ${JSON.stringify(created)}`
    );
  }

  const listResponse = await fetch(
    `http://127.0.0.1:${port}/api/v1/people?limit=20&source=both&sort=display_name&direction=asc`,
    {
      headers: { accept: "application/json", cookie, host: `127.0.0.1:${port}` }
    }
  );
  const listed = await listResponse.json().catch(() => null);
  if (
    !listResponse.ok ||
    !Array.isArray(listed?.people) ||
    !listed.people.some(
      (person) => person.displayName === "Packed runtime Person"
    )
  ) {
    throw new Error(
      `packed runtime People list failed with HTTP ${listResponse.status}: ${JSON.stringify(listed)}`
    );
  }
}

async function verifyPackedWebRoutes() {
  for (const route of ["/forge/", "/forge/vitals"]) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    if (!response.ok) {
      throw new Error(
        `packed runtime route ${route} failed with HTTP ${response.status}`
      );
    }
  }
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
  run(
    "npm",
    ["install", "--silent", "--ignore-scripts", "--legacy-peer-deps", tarball],
    {
      cwd: tempRoot
    }
  );

  const installedPluginRoot = path.join(
    tempRoot,
    "node_modules",
    "forge-openclaw-plugin"
  );
  const sourceManifest = path.join(
    installedPluginRoot,
    "dist",
    "companion-iroh-src",
    "Cargo.toml"
  );
  if (!existsSync(sourceManifest)) {
    throw new Error(
      "packed runtime did not include companion-iroh-src/Cargo.toml"
    );
  }
  if (!runtimeOnly) {
    run(
      "cargo",
      [
        "build",
        "--locked",
        "--release",
        "--manifest-path",
        sourceManifest,
        "--bin",
        "forge-companion-iroh"
      ],
      {
        cwd: path.dirname(sourceManifest),
        timeout: 180_000,
        env: {
          ...process.env,
          CARGO_TARGET_DIR: path.join(tempRoot, "companion-iroh-target")
        }
      }
    );
  }
  const peerRuntime = await verifyPackedForgePeerSource(installedPluginRoot, {
    buildBinary: !runtimeOnly
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
        ...(runtimeOnly
          ? {
              FORGE_PEER_ENABLED: "0",
              FORGE_PEER_REQUIRED: "0",
              FORGE_PEER_ENABLE_IROH: "0"
            }
          : {
              FORGE_PEER_BIN: peerRuntime.binaryPath,
              FORGE_PEER_ENABLED: "1",
              FORGE_PEER_REQUIRED: "1",
              FORGE_PEER_ENABLE_IROH: "1"
            }),
        FORGE_PEER_SOCKET_PATH: peerSocketPath,
        FORGE_PEER_STATE_DIR: peerStateRoot,
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
    throw new Error(
      `packed runtime health returned unexpected backend ${health.backend}`
    );
  }
  await verifyPackedWebRoutes();
  if (!runtimeOnly) {
    await verifyPackedPeerDaemon(installedPluginRoot);
    const pairing = await verifyPackedIrohPairing();
    await verifyPackedPeopleApi(pairing.cookie);
    if (!pairing.body?.qrPayload?.transport?.pairPayload?.node_id) {
      throw new Error(
        "packed companion pairing did not expose its verified Iroh node id"
      );
    }
  }
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
  console.log(`packed runtime evidence preserved at ${tempRoot}`);
}
