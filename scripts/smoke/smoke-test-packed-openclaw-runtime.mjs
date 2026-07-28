import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const companionIrohTarget = path.join(tempRoot, "companion-iroh-target");
const companionIrohBinaryPath = path.join(
  companionIrohTarget,
  "release",
  process.platform === "win32"
    ? "forge-companion-iroh.exe"
    : "forge-companion-iroh"
);
const peerSocketPath = path.join(
  realpathSync("/tmp"),
  `forge-peer-packed-${process.pid}.sock`
);
const peerStateRoot = path.join(tempRoot, "forge-peer-state");
const port = 43170 + Math.floor(Math.random() * 1000);
const ownerUserId = "user_operator";
const referenceCourse = {
  id: "course.polynomials-etale-triple-covers",
  slug: "from-polynomials-to-etale-triple-covers",
  version: "2.9.0",
  fileName: "from-polynomials-to-etale-triple-covers.forge-course.json"
};
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
  ["full", "publish-from-tag"].includes(releaseMode);
let child = null;
const previousOwnerBrokerBinary = process.env.FORGE_OWNER_BROKER_BIN;
const previousOwnerBrokerSha256 = process.env.FORGE_OWNER_BROKER_SHA256;
let ownerBrokerEnvironmentChanged = false;

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
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        const body = await response.json();
        if (
          body?.ok === true &&
          body?.app === "forge" &&
          body?.security === "credential-required"
        ) {
          return body;
        }
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

  run(
    "cargo",
    [
      "build",
      "--locked",
      "--release",
      "--manifest-path",
      cargoManifest,
      "--no-default-features",
      "--features",
      "owner-broker",
      "--bin",
      "forge-owner-broker"
    ],
    {
      cwd: sourceRoot,
      timeout: 600_000,
      env: { ...process.env, CARGO_TARGET_DIR: peerSourceTarget }
    }
  );

  const ownerBrokerBinaryName =
    process.platform === "win32"
      ? "forge-owner-broker.exe"
      : "forge-owner-broker";
  const ownerBrokerBinaryPath = path.join(
    peerSourceTarget,
    "release",
    ownerBrokerBinaryName
  );
  if (!existsSync(ownerBrokerBinaryPath)) {
    throw new Error(
      "locked packed forge-peer build did not produce its owner-broker binary"
    );
  }
  const ownerBrokerSha256 = createHash("sha256")
    .update(readFileSync(ownerBrokerBinaryPath))
    .digest("hex");

  if (!buildBinary) {
    return {
      binaryPath: null,
      ownerBrokerBinaryPath,
      ownerBrokerSha256,
      sourceRoot
    };
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
  return {
    binaryPath,
    ownerBrokerBinaryPath,
    ownerBrokerSha256,
    sourceRoot
  };
}

function packedPeerEnvironment(binaryPath) {
  return {
    ...process.env,
    FORGE_PEER_BIN: binaryPath,
    FORGE_PEER_ENABLED: "1",
    FORGE_PEER_REQUIRED: "1",
    FORGE_PEER_ENABLE_IROH: "1",
    FORGE_PEER_SOCKET_PATH: peerSocketPath,
    FORGE_PEER_STATE_DIR: peerStateRoot
  };
}

async function verifyPackedPeerDaemon(installedPluginRoot, binaryPath) {
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
  const runtimeModulePath = path.join(
    installedPluginRoot,
    "dist",
    "server",
    "apps",
    "api",
    "src",
    "services",
    "peer-runtime.js"
  );
  const { UnixSocketPeerCoreGateway } = await import(
    pathToFileURL(gatewayModulePath).href
  );
  const { resolvePeerRuntimeConfiguration } = await import(
    pathToFileURL(runtimeModulePath).href
  );
  const configuration = await resolvePeerRuntimeConfiguration({
    ownerUserId,
    dataDir: dataRoot,
    environment: packedPeerEnvironment(binaryPath)
  });
  if (!configuration.enabled || !configuration.supervisor.enabled) {
    throw new Error("packed forge-peer runtime configuration was disabled");
  }
  const gateway = new UnixSocketPeerCoreGateway({
    socketPath: configuration.supervisor.socketPath,
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

async function verifyPackedCourseApi(requestForge) {
  const response = await requestForge({
    method: "GET",
    path: `/api/v1/courses?userId=${ownerUserId}`
  });
  const body = response.body;
  const course = body?.courses?.find(
    (entry) => entry.id === referenceCourse.id
  );
  if (
    response.status !== 200 ||
    course?.slug !== referenceCourse.slug ||
    course?.version !== referenceCourse.version
  ) {
    throw new Error(
      `packed runtime omitted the reference course: HTTP ${response.status}: ${JSON.stringify(body)}`
    );
  }
}

async function verifyPackedPairingRequiresOperator(requestForge) {
  const response = await requestForge({
    method: "POST",
    path: "/api/v1/health/pairing-sessions",
    body: { userId: null, transportMode: "iroh" }
  });
  const body = response.body;
  if (
    response.status !== 401 ||
    body?.code !== "auth_required" ||
    !String(body?.error ?? "").includes("operator session")
  ) {
    throw new Error(
      `packed runtime allowed a local service to create a pairing session: HTTP ${response.status}: ${JSON.stringify(body)}`
    );
  }
}

async function verifyPackedPeopleApi(requestForge) {
  const createdResponse = await requestForge({
    method: "POST",
    path: "/api/v1/entities/create",
    body: {
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
    }
  });
  const created = createdResponse.body;
  if (createdResponse.status !== 200 || created?.results?.[0]?.ok !== true) {
    throw new Error(
      `packed runtime Person create failed with HTTP ${createdResponse.status}: ${JSON.stringify(created)}`
    );
  }

  const listResponse = await requestForge({
    method: "GET",
    path: "/api/v1/people?limit=20&source=both&sort=display_name&direction=asc"
  });
  const listed = listResponse.body;
  if (
    listResponse.status !== 200 ||
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
  for (const route of ["/forge/", "/forge/vitals", "/forge/courses"]) {
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
  const packedCoursePath = path.join(
    installedPluginRoot,
    "dist",
    "server",
    "apps",
    "api",
    "src",
    "course-catalog",
    referenceCourse.fileName
  );
  if (!existsSync(packedCoursePath)) {
    throw new Error(
      `packed runtime omitted ${path.relative(installedPluginRoot, packedCoursePath)}`
    );
  }
  const packedCourse = JSON.parse(readFileSync(packedCoursePath, "utf8"));
  if (
    packedCourse?.course?.id !== referenceCourse.id ||
    packedCourse?.course?.slug !== referenceCourse.slug ||
    packedCourse?.course?.version !== referenceCourse.version ||
    packedCourse?.lessons?.length !== 330
  ) {
    throw new Error(
      `packed reference course is invalid: ${JSON.stringify({
        id: packedCourse?.course?.id,
        slug: packedCourse?.course?.slug,
        version: packedCourse?.course?.version,
        lessons: packedCourse?.lessons?.length
      })}`
    );
  }
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
          CARGO_TARGET_DIR: companionIrohTarget
        }
      }
    );
    if (!existsSync(companionIrohBinaryPath)) {
      throw new Error(
        "locked packed companion-Iroh build did not produce its host binary"
      );
    }
  }
  const peerRuntime = await verifyPackedForgePeerSource(installedPluginRoot, {
    buildBinary: !runtimeOnly
  });
  process.env.FORGE_OWNER_BROKER_BIN = peerRuntime.ownerBrokerBinaryPath;
  process.env.FORGE_OWNER_BROKER_SHA256 = peerRuntime.ownerBrokerSha256;
  ownerBrokerEnvironmentChanged = true;
  const localOwnerClientModulePath = path.join(
    installedPluginRoot,
    "dist",
    "openclaw",
    "local-owner-client.js"
  );
  const { createLocalOwnerSession } = await import(
    pathToFileURL(localOwnerClientModulePath).href
  );
  const forgeBaseUrl = `http://127.0.0.1:${port}`;
  const requestForge = async (args) => {
    const session = await createLocalOwnerSession(
      forgeBaseUrl,
      15_000,
      dataRoot
    );
    const response = await fetch(new URL(args.path, `${forgeBaseUrl}/`), {
      method: args.method,
      headers: {
        accept: "application/json",
        cookie: session.cookie,
        "x-forge-csrf": session.csrfToken,
        ...(args.body === undefined
          ? {}
          : { "content-type": "application/json" })
      },
      body: args.body === undefined ? undefined : JSON.stringify(args.body)
    });
    return {
      status: response.status,
      body: await response.json().catch(() => null)
    };
  };

  mkdirSync(installRoot, { recursive: true });
  child = spawn(
    process.execPath,
    [path.join(installedPluginRoot, "server", "index.js")],
    {
      cwd: installRoot,
      env: {
        ...process.env,
        FORGE_DATA_ROOT: dataRoot,
        FORGE_OWNER_BROKER_BIN: peerRuntime.ownerBrokerBinaryPath,
        FORGE_OWNER_BROKER_SHA256: peerRuntime.ownerBrokerSha256,
        ...(runtimeOnly
          ? {
              FORGE_PEER_ENABLED: "0",
              FORGE_PEER_REQUIRED: "0",
              FORGE_PEER_ENABLE_IROH: "0"
            }
          : packedPeerEnvironment(peerRuntime.binaryPath)),
        ...(!runtimeOnly
          ? { FORGE_COMPANION_IROH_BIN: companionIrohBinaryPath }
          : {}),
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

  await waitForHealth();
  await verifyPackedWebRoutes();
  const protectedHealth = await requestForge({
    method: "GET",
    path: "/api/v1/health"
  });
  if (
    protectedHealth.status !== 200 ||
    protectedHealth.body?.backend !== "forge-node-runtime"
  ) {
    throw new Error(
      `packed runtime protected health returned unexpected response ${JSON.stringify(protectedHealth)}`
    );
  }
  await verifyPackedCourseApi(requestForge);
  if (!runtimeOnly) {
    await verifyPackedPeerDaemon(installedPluginRoot, peerRuntime.binaryPath);
    await verifyPackedPairingRequiresOperator(requestForge);
    await verifyPackedPeopleApi(requestForge);
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
  if (ownerBrokerEnvironmentChanged) {
    if (previousOwnerBrokerBinary === undefined) {
      delete process.env.FORGE_OWNER_BROKER_BIN;
    } else {
      process.env.FORGE_OWNER_BROKER_BIN = previousOwnerBrokerBinary;
    }
    if (previousOwnerBrokerSha256 === undefined) {
      delete process.env.FORGE_OWNER_BROKER_SHA256;
    } else {
      process.env.FORGE_OWNER_BROKER_SHA256 = previousOwnerBrokerSha256;
    }
  }
  console.log(`packed runtime evidence preserved at ${tempRoot}`);
}
