import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  NATIVE_SOURCE_MANIFEST_FILE,
  TRUSTED_NATIVE_SOURCE_KEYS,
  verifyNativeSourceBundle
} from "./native-source-manifest.mjs";

const RECEIPT_SCHEMA_VERSION = 2;
const RECEIPT_FILE = "build-receipt.json";
const OWNER_RECEIPT_SCHEMA_VERSION = 1;
const OWNER_RECEIPT_FILE = "owner-broker-build-receipt.json";
const MAX_RECEIPT_BYTES = 16 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class PeerRuntimeInstallError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "PeerRuntimeInstallError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new PeerRuntimeInstallError(code, message, { cause });
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    fail(
      "unsupported_platform",
      "Forge peer sharing currently requires a Unix host."
    );
  }
  return process.getuid();
}

function binaryName() {
  return process.platform === "win32" ? "forge-peer.exe" : "forge-peer";
}

function ownerBrokerBinaryName() {
  return process.platform === "win32"
    ? "forge-owner-broker.exe"
    : "forge-owner-broker";
}

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

async function ensurePrivateDirectory(directoryPath) {
  const absolute = path.resolve(directoryPath);
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const metadata = await lstat(absolute);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.uid !== currentUid()
  ) {
    fail(
      "filesystem",
      "The Forge peer build directory is not owner-controlled."
    );
  }
  await chmod(absolute, 0o700);
  return await realpath(absolute);
}

function assertSafePathSegment(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    fail("configuration", "The Forge peer build path is invalid.");
  }
  return value;
}

async function ensurePrivateChildDirectory(parentDirectory, segment) {
  const safeSegment = assertSafePathSegment(segment);
  const target = path.join(parentDirectory, safeSegment);
  try {
    await mkdir(target, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") {
      fail(
        "filesystem",
        "Forge could not create its peer build directory.",
        error
      );
    }
  }
  const metadata = await lstat(target).catch((error) => {
    fail("filesystem", "The Forge peer build directory is unavailable.", error);
  });
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.uid !== currentUid()
  ) {
    fail(
      "filesystem",
      "The Forge peer build directory is not owner-controlled."
    );
  }
  const resolved = await realpath(target).catch((error) => {
    fail(
      "filesystem",
      "The Forge peer build directory cannot be resolved.",
      error
    );
  });
  if (resolved !== target || path.dirname(resolved) !== parentDirectory) {
    fail(
      "filesystem",
      "The Forge peer build directory escaped its private root."
    );
  }
  await chmod(resolved, 0o700);
  return resolved;
}

async function inspectPrivateDirectory(directoryPath) {
  const absolute = path.resolve(directoryPath);
  let metadata;
  try {
    metadata = await lstat(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail("filesystem", "The Forge peer build directory is unavailable.", error);
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.uid !== currentUid() ||
    (metadata.mode & 0o077) !== 0
  ) {
    fail("filesystem", "The Forge peer build directory is not private.");
  }
  const resolved = await realpath(absolute).catch((error) => {
    fail(
      "filesystem",
      "The Forge peer build directory cannot be resolved.",
      error
    );
  });
  return resolved;
}

async function inspectPrivateChildDirectory(parentDirectory, segment) {
  const target = path.join(parentDirectory, assertSafePathSegment(segment));
  const resolved = await inspectPrivateDirectory(target);
  if (
    resolved !== null &&
    (resolved !== target || path.dirname(resolved) !== parentDirectory)
  ) {
    fail(
      "filesystem",
      "The Forge peer build directory escaped its private root."
    );
  }
  return resolved;
}

function assertExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index])
  );
}

function validReceipt(value, expected) {
  return (
    assertExactKeys(value, [
      "schemaVersion",
      "packageVersion",
      "runtimePackageVersion",
      "commitSha",
      "sourceManifestSha256",
      "binarySha256",
      "ownerBrokerBinarySha256",
      "platform",
      "builtAt"
    ]) &&
    value.schemaVersion === RECEIPT_SCHEMA_VERSION &&
    value.packageVersion === expected.packageVersion &&
    value.runtimePackageVersion === expected.runtimePackageVersion &&
    value.commitSha === expected.commitSha &&
    value.sourceManifestSha256 === expected.sourceManifestSha256 &&
    typeof value.binarySha256 === "string" &&
    SHA256_PATTERN.test(value.binarySha256) &&
    typeof value.ownerBrokerBinarySha256 === "string" &&
    SHA256_PATTERN.test(value.ownerBrokerBinarySha256) &&
    value.platform === platformKey() &&
    isCanonicalIsoTimestamp(value.builtAt)
  );
}

function validOwnerReceipt(value, expected) {
  return (
    assertExactKeys(value, [
      "schemaVersion",
      "packageVersion",
      "runtimePackageVersion",
      "commitSha",
      "sourceManifestSha256",
      "ownerBrokerBinarySha256",
      "platform",
      "builtAt"
    ]) &&
    value.schemaVersion === OWNER_RECEIPT_SCHEMA_VERSION &&
    value.packageVersion === expected.packageVersion &&
    value.runtimePackageVersion === expected.runtimePackageVersion &&
    value.commitSha === expected.commitSha &&
    value.sourceManifestSha256 === expected.sourceManifestSha256 &&
    typeof value.ownerBrokerBinarySha256 === "string" &&
    SHA256_PATTERN.test(value.ownerBrokerBinarySha256) &&
    value.platform === platformKey() &&
    isCanonicalIsoTimestamp(value.builtAt)
  );
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== "string" || value.length > 64) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

async function readReceipt(receiptPath) {
  try {
    const metadata = await lstat(receiptPath);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > MAX_RECEIPT_BYTES ||
      metadata.uid !== currentUid() ||
      (metadata.mode & 0o077) !== 0
    ) {
      return null;
    }
    return JSON.parse(await readFile(receiptPath, "utf8"));
  } catch {
    return null;
  }
}

async function inspectCachedBinary(binaryPath, expectedSha256) {
  try {
    const metadata = await lstat(binaryPath);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.uid !== currentUid() ||
      (metadata.mode & 0o111) === 0
    ) {
      return false;
    }
    return (await hashFile(binaryPath)) === expectedSha256;
  } catch {
    return false;
  }
}

function packagedSourceRoot(pluginRoot) {
  if (
    typeof pluginRoot !== "string" ||
    !path.isAbsolute(pluginRoot) ||
    path.normalize(pluginRoot) !== pluginRoot
  ) {
    fail("configuration", "The packaged Forge runtime root is invalid.");
  }
  return path.join(pluginRoot, "dist", "forge-peer-src");
}

function devSourceRoot(repoRoot) {
  if (
    typeof repoRoot !== "string" ||
    !path.isAbsolute(repoRoot) ||
    path.normalize(repoRoot) !== repoRoot
  ) {
    fail("configuration", "The Forge development repository root is invalid.");
  }
  return path.join(repoRoot, "packages", "forge-peer");
}

async function writeReceipt(receiptPath, receipt) {
  const temporaryPath = `${receiptPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(receipt)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporaryPath, receiptPath);
    await chmod(receiptPath, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    fail("filesystem", "Forge could not record the peer build receipt.", error);
  }
}

async function inspectBuiltBinary(binaryPath, label) {
  const metadata = await lstat(binaryPath).catch((error) => {
    fail("build", `Cargo did not produce the ${label} binary.`, error);
  });
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size <= 0 ||
    metadata.uid !== currentUid()
  ) {
    fail("build", `Cargo produced an unsafe ${label} binary.`);
  }
  await chmod(binaryPath, 0o700);
  return await hashFile(binaryPath);
}

async function resolveSource(input) {
  if (input.mode !== "packaged" && input.mode !== "dev") {
    fail("configuration", "The Forge peer runtime mode is invalid.");
  }
  const sourceRoot =
    input.mode === "packaged"
      ? packagedSourceRoot(input.pluginRoot)
      : devSourceRoot(input.repoRoot);
  if (input.mode === "packaged") {
    const verified = await verifyNativeSourceBundle({
      sourceRoot,
      expectedRuntimePackageVersion: input.runtimePackageVersion,
      trustedKeys: input.trustedKeys ?? TRUSTED_NATIVE_SOURCE_KEYS,
      now: input.now ?? new Date()
    });
    return {
      sourceRoot,
      sourceIdentity: {
        packageVersion: verified.manifest.packageVersion,
        runtimePackageVersion: verified.manifest.runtimePackageVersion,
        commitSha: verified.manifest.commitSha,
        sourceManifestSha256: await hashFile(
          path.join(sourceRoot, NATIVE_SOURCE_MANIFEST_FILE)
        )
      }
    };
  }
  const metadata = await lstat(sourceRoot).catch((error) => {
    fail(
      "filesystem",
      "The Forge peer development source is unavailable.",
      error
    );
  });
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail("filesystem", "The Forge peer development source is unsafe.");
  }
  for (const requiredFile of ["Cargo.toml", "Cargo.lock"]) {
    const requiredPath = path.join(sourceRoot, requiredFile);
    const requiredMetadata = await lstat(requiredPath).catch((error) => {
      fail(
        "filesystem",
        `The Forge peer ${requiredFile} is unavailable.`,
        error
      );
    });
    if (requiredMetadata.isSymbolicLink() || !requiredMetadata.isFile()) {
      fail("filesystem", `The Forge peer ${requiredFile} is unsafe.`);
    }
  }
  return {
    sourceRoot,
    sourceIdentity: {
      packageVersion: "development",
      runtimePackageVersion: input.runtimePackageVersion,
      commitSha: "development",
      sourceManifestSha256: "development"
    }
  };
}

async function ownerBrokerSourceIdentity(sourceRoot, sourceIdentity, mode) {
  if (mode === "packaged") return sourceIdentity;
  const sourceFiles = [
    "Cargo.toml",
    "Cargo.lock",
    "src/bin/forge-owner-broker.rs",
    "src/codec.rs",
    "src/error.rs",
    "src/lib.rs",
    "src/owner_broker.rs",
    "src/secure_fs.rs"
  ];
  const digest = createHash("sha256");
  for (const relativePath of sourceFiles) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const metadata = await lstat(sourcePath).catch((error) => {
      fail(
        "filesystem",
        `The Forge owner-broker source ${relativePath} is unavailable.`,
        error
      );
    });
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      fail(
        "filesystem",
        `The Forge owner-broker source ${relativePath} is unsafe.`
      );
    }
    digest.update(relativePath);
    digest.update("\0");
    digest.update(await readFile(sourcePath));
    digest.update("\0");
  }
  return {
    ...sourceIdentity,
    sourceManifestSha256: digest.digest("hex")
  };
}

async function ensureBuildDirectories(nativeRoot, sourceIdentity) {
  const privateNativeRoot = await ensurePrivateDirectory(nativeRoot);
  const peerRoot = await ensurePrivateChildDirectory(
    privateNativeRoot,
    "forge-peer"
  );
  const versionRoot = await ensurePrivateChildDirectory(
    peerRoot,
    sourceIdentity.packageVersion
  );
  const buildRoot = await ensurePrivateChildDirectory(
    versionRoot,
    platformKey()
  );
  const targetDirectory = await ensurePrivateChildDirectory(
    buildRoot,
    "target"
  );
  return { buildRoot, targetDirectory };
}

async function inspectBuildDirectories(nativeRoot, sourceIdentity) {
  const privateNativeRoot = await inspectPrivateDirectory(nativeRoot);
  if (privateNativeRoot === null) return null;
  const peerRoot = await inspectPrivateChildDirectory(
    privateNativeRoot,
    "forge-peer"
  );
  if (peerRoot === null) return null;
  const versionRoot = await inspectPrivateChildDirectory(
    peerRoot,
    sourceIdentity.packageVersion
  );
  if (versionRoot === null) return null;
  const buildRoot = await inspectPrivateChildDirectory(
    versionRoot,
    platformKey()
  );
  if (buildRoot === null) return null;
  const targetDirectory = await inspectPrivateChildDirectory(
    buildRoot,
    "target"
  );
  if (targetDirectory === null) return null;
  return { buildRoot, targetDirectory };
}

export async function inspectForgePeerRuntime(input) {
  const { sourceRoot, sourceIdentity } = await resolveSource(input);
  const directories = await inspectBuildDirectories(
    input.nativeRoot,
    sourceIdentity
  );
  if (directories === null) {
    return {
      ok: false,
      sourceVerified: true,
      binaryVerified: false,
      binaryPath: null,
      ownerBrokerBinaryPath: null,
      receiptPath: null,
      sourceRoot,
      sourceIdentity,
      reason: "The verified forge-peer runtime has not been built yet."
    };
  }
  const binaryPath = path.join(
    directories.targetDirectory,
    "release",
    binaryName()
  );
  const ownerBrokerBinaryPath = path.join(
    directories.targetDirectory,
    "release",
    ownerBrokerBinaryName()
  );
  const receiptPath = path.join(directories.buildRoot, RECEIPT_FILE);
  const receipt = await readReceipt(receiptPath);
  const binaryVerified =
    input.mode === "packaged"
      ? validReceipt(receipt, sourceIdentity) &&
        (await inspectCachedBinary(binaryPath, receipt.binarySha256)) &&
        (await inspectCachedBinary(
          ownerBrokerBinaryPath,
          receipt.ownerBrokerBinarySha256
        ))
      : (await inspectCachedBinary(
          binaryPath,
          typeof receipt?.binarySha256 === "string" ? receipt.binarySha256 : ""
        )) &&
        (await inspectCachedBinary(
          ownerBrokerBinaryPath,
          typeof receipt?.ownerBrokerBinarySha256 === "string"
            ? receipt.ownerBrokerBinarySha256
            : ""
        ));
  return {
    ok: binaryVerified,
    sourceVerified: true,
    binaryVerified,
    binaryPath: binaryVerified ? binaryPath : null,
    ownerBrokerBinaryPath: binaryVerified ? ownerBrokerBinaryPath : null,
    binarySha256: binaryVerified ? receipt.binarySha256 : null,
    ownerBrokerBinarySha256: binaryVerified
      ? receipt.ownerBrokerBinarySha256
      : null,
    receiptPath,
    sourceRoot,
    sourceIdentity,
    reason: binaryVerified
      ? null
      : "The Forge native build receipt or either executable does not match its verified source."
  };
}

export async function prepareForgePeerRuntime(input) {
  const { sourceRoot, sourceIdentity } = await resolveSource(input);
  const { buildRoot, targetDirectory } = await ensureBuildDirectories(
    input.nativeRoot,
    sourceIdentity
  );
  const binaryPath = path.join(targetDirectory, "release", binaryName());
  const ownerBrokerBinaryPath = path.join(
    targetDirectory,
    "release",
    ownerBrokerBinaryName()
  );
  const receiptPath = path.join(buildRoot, RECEIPT_FILE);
  const receipt = await readReceipt(receiptPath);
  if (
    input.mode === "packaged" &&
    validReceipt(receipt, sourceIdentity) &&
    (await inspectCachedBinary(binaryPath, receipt.binarySha256)) &&
    (await inspectCachedBinary(
      ownerBrokerBinaryPath,
      receipt.ownerBrokerBinarySha256
    ))
  ) {
    return {
      ok: true,
      built: false,
      binaryPath,
      ownerBrokerBinaryPath,
      binarySha256: receipt.binarySha256,
      ownerBrokerBinarySha256: receipt.ownerBrokerBinarySha256,
      sourceRoot,
      receiptPath,
      sourceIdentity
    };
  }

  const cargoResult = await input.runCargo({
    args: [
      "build",
      "--locked",
      "--release",
      "--manifest-path",
      path.join(sourceRoot, "Cargo.toml"),
      "--bin",
      "forge-peer",
      "--bin",
      "forge-owner-broker"
    ],
    cwd: sourceRoot,
    env: { ...input.environment, CARGO_TARGET_DIR: targetDirectory }
  });
  if (!cargoResult?.ok) {
    fail("build", "Forge could not build the verified forge-peer source.");
  }

  if (input.mode === "packaged") {
    await verifyNativeSourceBundle({
      sourceRoot,
      expectedRuntimePackageVersion: input.runtimePackageVersion,
      trustedKeys: input.trustedKeys ?? TRUSTED_NATIVE_SOURCE_KEYS,
      now: input.now ?? new Date()
    });
  }
  const binarySha256 = await inspectBuiltBinary(binaryPath, "forge-peer");
  const ownerBrokerBinarySha256 = await inspectBuiltBinary(
    ownerBrokerBinaryPath,
    "forge-owner-broker"
  );
  const nextReceipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    ...sourceIdentity,
    binarySha256,
    ownerBrokerBinarySha256,
    platform: platformKey(),
    builtAt: (input.now ?? new Date()).toISOString()
  };
  await writeReceipt(receiptPath, nextReceipt);
  return {
    ok: true,
    built: true,
    binaryPath,
    ownerBrokerBinaryPath,
    binarySha256,
    ownerBrokerBinarySha256,
    sourceRoot,
    receiptPath,
    sourceIdentity
  };
}

export async function prepareForgeOwnerBrokerRuntime(input) {
  const resolved = await resolveSource(input);
  const sourceIdentity = await ownerBrokerSourceIdentity(
    resolved.sourceRoot,
    resolved.sourceIdentity,
    input.mode
  );
  const { buildRoot, targetDirectory } = await ensureBuildDirectories(
    input.nativeRoot,
    sourceIdentity
  );
  const ownerBrokerBinaryPath = path.join(
    targetDirectory,
    "release",
    ownerBrokerBinaryName()
  );
  const receiptPath = path.join(buildRoot, OWNER_RECEIPT_FILE);
  const receipt = await readReceipt(receiptPath);
  if (
    validOwnerReceipt(receipt, sourceIdentity) &&
    (await inspectCachedBinary(
      ownerBrokerBinaryPath,
      receipt.ownerBrokerBinarySha256
    ))
  ) {
    return {
      ok: true,
      built: false,
      binaryPath: null,
      ownerBrokerBinaryPath,
      binarySha256: null,
      ownerBrokerBinarySha256: receipt.ownerBrokerBinarySha256,
      sourceRoot: resolved.sourceRoot,
      receiptPath,
      sourceIdentity
    };
  }

  const cargoResult = await input.runCargo({
    args: [
      "build",
      "--locked",
      "--release",
      "--no-default-features",
      "--features",
      "owner-broker",
      "--manifest-path",
      path.join(resolved.sourceRoot, "Cargo.toml"),
      "--bin",
      "forge-owner-broker"
    ],
    cwd: resolved.sourceRoot,
    env: { ...input.environment, CARGO_TARGET_DIR: targetDirectory }
  });
  if (!cargoResult?.ok) {
    fail(
      "build",
      "Forge could not build the verified local-owner broker source."
    );
  }

  if (input.mode === "packaged") {
    await verifyNativeSourceBundle({
      sourceRoot: resolved.sourceRoot,
      expectedRuntimePackageVersion: input.runtimePackageVersion,
      trustedKeys: input.trustedKeys ?? TRUSTED_NATIVE_SOURCE_KEYS,
      now: input.now ?? new Date()
    });
  }
  const ownerBrokerBinarySha256 = await inspectBuiltBinary(
    ownerBrokerBinaryPath,
    "forge-owner-broker"
  );
  const nextReceipt = {
    schemaVersion: OWNER_RECEIPT_SCHEMA_VERSION,
    ...sourceIdentity,
    ownerBrokerBinarySha256,
    platform: platformKey(),
    builtAt: (input.now ?? new Date()).toISOString()
  };
  await writeReceipt(receiptPath, nextReceipt);
  return {
    ok: true,
    built: true,
    binaryPath: null,
    ownerBrokerBinaryPath,
    binarySha256: null,
    ownerBrokerBinarySha256,
    sourceRoot: resolved.sourceRoot,
    receiptPath,
    sourceIdentity
  };
}
