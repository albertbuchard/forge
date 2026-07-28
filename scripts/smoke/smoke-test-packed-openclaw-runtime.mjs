import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
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
import {
  prepareForgeOwnerBrokerRuntime,
  prepareForgePeerRuntime
} from "../../packages/forge-memory/lib/peer-runtime-install.mjs";
import { runPackedOwnerApproval } from "./packed-owner-approval.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const pluginRoot = path.join(repoRoot, "plugins/openclaw");
const previousProcessUmask = process.umask(0o077);
const smokeRoot = path.join(os.homedir(), ".forge-packed-runtime-smoke");
mkdirSync(smokeRoot, { recursive: true, mode: 0o700 });
let smokeRootMetadata = lstatSync(smokeRoot);
if (
  !smokeRootMetadata.isDirectory() ||
  smokeRootMetadata.isSymbolicLink() ||
  (typeof process.getuid === "function" &&
    smokeRootMetadata.uid !== process.getuid())
) {
  throw new Error(
    `packed runtime smoke root is not an owner-only directory: ${smokeRoot}`
  );
}
chmodSync(smokeRoot, 0o700);
smokeRootMetadata = lstatSync(smokeRoot);
if ((smokeRootMetadata.mode & 0o077) !== 0) {
  throw new Error(
    `packed runtime smoke root permissions are not owner-only: ${smokeRoot}`
  );
}
const tempRoot = realpathSync(
  mkdtempSync(path.join(smokeRoot, "forge-packed-runtime-"))
);
const installRoot = path.join(tempRoot, "install");
const dataRoot = path.join(tempRoot, "data");
const peerNativeRoot = path.join(tempRoot, "native");
const unsignedPeerTarget = path.join(tempRoot, "unsigned-forge-peer-target");
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
let smokeSucceeded = false;
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

  if (!existsSync(signaturePath)) {
    const cargoArgs = buildBinary
      ? [
          "build",
          "--locked",
          "--release",
          "--manifest-path",
          cargoManifest,
          "--bin",
          "forge-peer",
          "--bin",
          "forge-owner-broker"
        ]
      : [
          "build",
          "--locked",
          "--release",
          "--no-default-features",
          "--features",
          "owner-broker",
          "--manifest-path",
          cargoManifest,
          "--bin",
          "forge-owner-broker"
        ];
    run("cargo", cargoArgs, {
      cwd: sourceRoot,
      timeout: 600_000,
      env: { ...process.env, CARGO_TARGET_DIR: unsignedPeerTarget }
    });
    const installDirectory = path.join(peerNativeRoot, "unsigned-bin");
    mkdirSync(installDirectory, { recursive: true, mode: 0o700 });
    chmodSync(installDirectory, 0o700);
    const installBinary = (name) => {
      const sourcePath = path.join(unsignedPeerTarget, "release", name);
      const installedPath = path.join(installDirectory, name);
      copyFileSync(sourcePath, installedPath);
      chmodSync(installedPath, 0o700);
      const metadata = lstatSync(installedPath);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.nlink !== 1 ||
        (typeof process.getuid === "function" &&
          metadata.uid !== process.getuid()) ||
        (metadata.mode & 0o077) !== 0
      ) {
        throw new Error(
          `unsigned local smoke could not privately install ${name}`
        );
      }
      return {
        path: installedPath,
        sha256: createHash("sha256")
          .update(readFileSync(installedPath))
          .digest("hex")
      };
    };
    const ownerBroker = installBinary(
      process.platform === "win32"
        ? "forge-owner-broker.exe"
        : "forge-owner-broker"
    );
    return {
      binaryPath: buildBinary
        ? installBinary(
            process.platform === "win32" ? "forge-peer.exe" : "forge-peer"
          ).path
        : null,
      ownerBrokerBinaryPath: ownerBroker.path,
      ownerBrokerSha256: ownerBroker.sha256,
      sourceRoot
    };
  }

  const prepareRuntime = buildBinary
    ? prepareForgePeerRuntime
    : prepareForgeOwnerBrokerRuntime;
  const prepared = await prepareRuntime({
    mode: "packaged",
    pluginRoot: installedPluginRoot,
    repoRoot: null,
    nativeRoot: peerNativeRoot,
    runtimePackageVersion: runtimePackage.version,
    environment: process.env,
    runCargo: async ({ args, cwd, env }) => {
      run("cargo", args, {
        cwd,
        timeout: 600_000,
        env
      });
      return { ok: true };
    }
  });
  return {
    binaryPath: prepared.binaryPath,
    ownerBrokerBinaryPath: prepared.ownerBrokerBinaryPath,
    ownerBrokerSha256: prepared.ownerBrokerBinarySha256,
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

async function verifyPackedOwnerBroker(installedPluginRoot, peerRuntime) {
  if (process.platform === "win32") {
    return;
  }
  const modulePath = path.join(
    installedPluginRoot,
    "dist",
    "server",
    "apps",
    "api",
    "src",
    "security",
    "owner-channel.js"
  );
  const { NATIVE_OWNER_BROKER_PROTOCOL, NativeOwnerBroker } = await import(
    pathToFileURL(modulePath).href
  );
  const owner = process.getuid?.();
  if (!Number.isSafeInteger(owner) || owner < 0) {
    throw new Error("packed owner-broker preflight requires a valid owner uid");
  }
  const socketRoot = realpathSync(
    mkdtempSync(path.join("/tmp", `fg-${owner}-packed-owner-`))
  );
  chmodSync(socketRoot, 0o700);
  const socketPath = path.join(socketRoot, "owner.sock");
  const request = {
    protocol: NATIVE_OWNER_BROKER_PROTOCOL,
    requestId: `owner_${randomUUID()}`,
    transactionId: `transaction_${randomUUID()}`,
    installId: "packed-openclaw-smoke",
    browserOrigin: `http://127.0.0.1:${port}`,
    browserNonce: randomBytes(32).toString("base64url")
  };
  const broker = new NativeOwnerBroker(
    peerRuntime.ownerBrokerBinaryPath,
    socketPath,
    { now: () => new Date() },
    15_000,
    undefined,
    peerRuntime.ownerBrokerSha256
  );
  try {
    const receipt = await broker.authenticate(
      request,
      ({ binaryPath, socketPath: approvedSocketPath, request: approval }) =>
        runPackedOwnerApproval(binaryPath, approvedSocketPath, approval, 15_000)
    );
    broker.consume(receipt, request.requestId, owner);
  } catch (error) {
    throw new Error(
      `packed owner-broker preflight failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    broker.close();
    rmSync(socketRoot, { recursive: true, force: true });
  }
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

async function verifyPackedLocalOwnerPairing(requestForge) {
  const anonymousResponse = await fetch(
    `http://127.0.0.1:${port}/api/v1/health/pairing-sessions`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({ userId: null, transportMode: "iroh" })
    }
  );
  const anonymousBody = await anonymousResponse.json().catch(() => null);
  if (
    anonymousResponse.status !== 401 ||
    anonymousBody?.code !== "gateway_authentication_required"
  ) {
    throw new Error(
      `packed runtime pairing did not reject an anonymous caller: HTTP ${anonymousResponse.status}: ${JSON.stringify(anonymousBody)}`
    );
  }

  const response = await requestForge({
    method: "POST",
    path: "/api/v1/health/pairing-sessions",
    body: { userId: "user_untrusted", transportMode: "iroh" }
  });
  const body = response.body;
  if (
    response.status !== 201 ||
    body?.session?.userId !== ownerUserId ||
    body?.qrPayload?.transportMode !== "iroh" ||
    body?.qrPayload?.kind !== "forge-companion-pairing"
  ) {
    throw new Error(
      `packed runtime did not admit the verified local owner pairing flow: HTTP ${response.status}: ${JSON.stringify(body)}`
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
  await verifyPackedOwnerBroker(installedPluginRoot, peerRuntime);
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
    await verifyPackedLocalOwnerPairing(requestForge);
    await verifyPackedPeopleApi(requestForge);
  }
  smokeSucceeded = true;
  console.log("packed openclaw runtime smoke passed");
} finally {
  process.umask(previousProcessUmask);
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
  if (smokeSucceeded) {
    rmSync(tempRoot, { recursive: true, force: true });
    console.log("packed runtime smoke evidence cleaned after success");
  } else {
    console.log(`packed runtime evidence preserved at ${tempRoot}`);
  }
}
