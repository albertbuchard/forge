#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from "node:fs";
import { cp, lstat, mkdir, readdir, realpath } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  TRUSTED_NATIVE_SOURCE_KEYS,
  verifyNativeSourceBundle
} from "../../packages/forge-memory/lib/native-source-manifest.mjs";

export const PEOPLE_PACKED_SURFACE_NAMES = Object.freeze([
  "openclaw",
  "hermes",
  "codex",
  "forgeMemory"
]);

export const PEOPLE_PACKED_MIGRATIONS = Object.freeze([
  "087_people_and_peer_sharing.sql",
  "088_people_peer_identity_hardening.sql",
  "094_people_peer_authorization_and_companion_v2.sql",
  "099_people_owner_partition_identity.sql",
  "100_people_read_model_revision.sql",
  "102_people_outbox_claim_order_indexes.sql"
]);

const SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARCHIVE_LIMITS = Object.freeze({
  entries: 100_000,
  fileBytes: 256 * 1024 * 1024,
  totalBytes: 2 * 1024 * 1024 * 1024
});
const DEFAULT_TIMEOUTS = Object.freeze({
  commandMs: 10 * 60_000,
  runtimeMs: 90_000,
  stopMs: 5_000
});

const SAFE_EXTRACT_PYTHON = String.raw`
import json
import os
import pathlib
import stat
import sys
import tarfile
import zipfile

archive = pathlib.Path(sys.argv[1]).resolve()
target = pathlib.Path(sys.argv[2]).resolve()
max_entries = int(sys.argv[3])
max_file = int(sys.argv[4])
max_total = int(sys.argv[5])
target.mkdir(parents=True, exist_ok=False)

def safe_name(raw):
    if not isinstance(raw, str) or not raw or "\x00" in raw or "\\" in raw:
        raise RuntimeError("archive contains an unsafe path")
    candidate = pathlib.PurePosixPath(raw)
    if candidate.is_absolute() or any(part in ("", ".", "..") for part in candidate.parts):
        raise RuntimeError("archive contains an unsafe path")
    normalized = candidate.as_posix()
    if len(normalized) > 1024:
        raise RuntimeError("archive path exceeds the limit")
    return normalized

entries = []
seen = set()
seen_folded = set()
total = 0

def register(name, size, mode, kind):
    global total
    normalized = safe_name(name.rstrip("/"))
    folded = normalized.casefold()
    if normalized in seen or folded in seen_folded:
        raise RuntimeError("archive contains duplicate or case-colliding paths")
    if size < 0 or size > max_file:
        raise RuntimeError("archive file exceeds the limit")
    total += size
    if total > max_total:
        raise RuntimeError("archive exceeds the total size limit")
    seen.add(normalized)
    seen_folded.add(folded)
    entries.append({"path": normalized, "size": size, "mode": mode, "kind": kind})
    if len(entries) > max_entries:
        raise RuntimeError("archive exceeds the entry limit")
    return normalized

def destination(name):
    output = (target / pathlib.PurePosixPath(name)).resolve()
    if output != target and target not in output.parents:
        raise RuntimeError("archive extraction escaped its root")
    return output

lower = archive.name.lower()
if lower.endswith((".whl", ".zip")):
    with zipfile.ZipFile(archive, "r") as bundle:
        for info in bundle.infolist():
            mode = (info.external_attr >> 16) & 0o7777
            file_type = (info.external_attr >> 16) & 0o170000
            if file_type == stat.S_IFLNK:
                raise RuntimeError("archive contains a symbolic link")
            is_dir = info.is_dir()
            name = register(info.filename, 0 if is_dir else info.file_size, mode, "directory" if is_dir else "file")
            output = destination(name)
            if is_dir:
                output.mkdir(parents=True, exist_ok=True)
                os.chmod(output, 0o755)
                continue
            output.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(info, "r") as source, output.open("xb") as sink:
                copied = 0
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    copied += len(chunk)
                    if copied > info.file_size:
                        raise RuntimeError("archive member expanded beyond its declared size")
                    sink.write(chunk)
            if copied != info.file_size:
                raise RuntimeError("archive member size mismatch")
            os.chmod(output, 0o755 if mode & 0o111 else 0o644)
elif lower.endswith((".tar.gz", ".tgz", ".tar")):
    with tarfile.open(archive, "r:*") as bundle:
        members = bundle.getmembers()
        for info in members:
            if not (info.isdir() or info.isfile()):
                raise RuntimeError("archive contains a link or special file")
            name = register(info.name, 0 if info.isdir() else info.size, info.mode, "directory" if info.isdir() else "file")
            output = destination(name)
            if info.isdir():
                output.mkdir(parents=True, exist_ok=True)
                os.chmod(output, 0o755)
                continue
            source = bundle.extractfile(info)
            if source is None:
                raise RuntimeError("archive member could not be read")
            output.parent.mkdir(parents=True, exist_ok=True)
            with source, output.open("xb") as sink:
                copied = 0
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    copied += len(chunk)
                    if copied > info.size:
                        raise RuntimeError("archive member expanded beyond its declared size")
                    sink.write(chunk)
            if copied != info.size:
                raise RuntimeError("archive member size mismatch")
            os.chmod(output, 0o755 if info.mode & 0o111 else 0o644)
else:
    raise RuntimeError("unsupported archive format")

print(json.dumps({"entries": entries, "entryCount": len(entries), "totalBytes": total}, separators=(",", ":")))
`;

export class PackedSurfaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PackedSurfaceError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new PackedSurfaceError(code, message, details);
}

function normalizeError(error) {
  return {
    code:
      error && typeof error === "object" && typeof error.code === "string"
        ? error.code
        : "unexpected_error",
    message: error instanceof Error ? error.message : String(error)
  };
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("configuration", `${label} must be an object.`);
  }
  return value;
}

function assertExactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(
      "configuration",
      `${label} contains unsupported keys: ${unknown.sort().join(", ")}.`
    );
  }
}

function assertSemver(value, label) {
  if (typeof value !== "string" || !SEMVER_PATTERN.test(value)) {
    fail("version", `${label} must be a semantic version.`);
  }
  return value;
}

function resolveAbsolute(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("configuration", `${label} must be an absolute path.`);
  }
  const resolved = path.resolve(value);
  if (!path.isAbsolute(value) || path.normalize(value) !== resolved) {
    fail("configuration", `${label} must already be normalized and absolute.`);
  }
  return resolved;
}

function isSameOrNested(candidate, root) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function canonicalizePotentialPath(absolute, label) {
  let existing = absolute;
  const missing = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      fail("filesystem", `${label} has no resolvable existing ancestor.`);
    }
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  let canonicalExisting;
  try {
    canonicalExisting = realpathSync(existing);
  } catch (error) {
    fail("filesystem", `${label} cannot be resolved safely.`, {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  return path.resolve(canonicalExisting, ...missing);
}

export function assertIsolatedRoot(
  candidate,
  protectedRoots,
  label = "Evidence root"
) {
  const absolute = resolveAbsolute(candidate, label);
  const canonicalCandidate = canonicalizePotentialPath(absolute, label);
  for (const protectedRoot of protectedRoots) {
    const protectedAbsolute = resolveAbsolute(
      protectedRoot,
      "A protected root"
    );
    const canonicalProtected = canonicalizePotentialPath(
      protectedAbsolute,
      "A protected root"
    );
    if (
      isSameOrNested(canonicalCandidate, canonicalProtected) ||
      isSameOrNested(canonicalProtected, canonicalCandidate)
    ) {
      fail(
        "protected_root",
        `${label} overlaps protected root ${canonicalProtected}.`,
        {
          candidate: canonicalCandidate,
          protectedRoot: canonicalProtected
        }
      );
    }
  }
  return canonicalCandidate;
}

function defaultProtectedRoots(configured) {
  const values = new Set();
  for (const candidate of [
    os.homedir(),
    process.env.HOME,
    process.env.USERPROFILE,
    process.env.FORGE_DATA_ROOT,
    ...(configured ?? [])
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      values.add(path.resolve(candidate));
    }
  }
  return [...values].sort();
}

function boundedTimeout(value, fallback, label) {
  const resolved = value ?? fallback;
  if (
    !Number.isInteger(resolved) ||
    resolved < 1_000 ||
    resolved > 30 * 60_000
  ) {
    fail("configuration", `${label} must be between 1000 and 1800000 ms.`);
  }
  return resolved;
}

export function validatePackedSurfaceConfig(input) {
  const config = assertPlainObject(input, "Matrix config");
  assertExactKeys(
    config,
    [
      "schemaVersion",
      "expectedVersion",
      "evidenceRoot",
      "protectedRoots",
      "migrationFiles",
      "artifacts",
      "pythonCommand",
      "timeouts"
    ],
    "Matrix config"
  );
  if (config.schemaVersion !== 1) {
    fail("configuration", "Matrix config schemaVersion must be 1.");
  }
  const expectedVersion = assertSemver(
    config.expectedVersion,
    "expectedVersion"
  );
  if (
    !Array.isArray(config.protectedRoots) ||
    config.protectedRoots.length === 0
  ) {
    fail(
      "configuration",
      "protectedRoots must name at least one canonical or protected data root."
    );
  }
  const protectedRoots = defaultProtectedRoots(config.protectedRoots);
  const migrationFiles = assertPlainObject(
    config.migrationFiles,
    "migrationFiles"
  );
  assertExactKeys(migrationFiles, PEOPLE_PACKED_MIGRATIONS, "migrationFiles");
  for (const migration of PEOPLE_PACKED_MIGRATIONS) {
    const filePath = resolveAbsolute(
      migrationFiles[migration],
      `migrationFiles.${migration}`
    );
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      fail("migration", `Canonical migration is missing: ${filePath}.`);
    }
    if (lstatSync(filePath).isSymbolicLink()) {
      fail(
        "migration",
        `Canonical migration cannot be a symlink: ${filePath}.`
      );
    }
    migrationFiles[migration] = realpathSync(filePath);
  }

  const artifacts = assertPlainObject(config.artifacts, "artifacts");
  assertExactKeys(artifacts, PEOPLE_PACKED_SURFACE_NAMES, "artifacts");
  for (const surface of PEOPLE_PACKED_SURFACE_NAMES) {
    const artifact = assertPlainObject(
      artifacts[surface],
      `artifacts.${surface}`
    );
    assertExactKeys(
      artifact,
      ["archive", "sourceRoot"],
      `artifacts.${surface}`
    );
    const selected = [artifact.archive, artifact.sourceRoot].filter(
      (value) => typeof value === "string" && value.trim()
    );
    if (selected.length !== 1) {
      fail(
        "configuration",
        `artifacts.${surface} must provide exactly one of archive or sourceRoot.`
      );
    }
    const key = artifact.archive ? "archive" : "sourceRoot";
    artifact[key] = resolveAbsolute(
      artifact[key],
      `artifacts.${surface}.${key}`
    );
    if (!existsSync(artifact[key])) {
      fail("artifact", `Artifact input does not exist: ${artifact[key]}.`);
    }
  }

  const timeouts = assertPlainObject(config.timeouts ?? {}, "timeouts");
  assertExactKeys(timeouts, ["commandMs", "runtimeMs", "stopMs"], "timeouts");
  return {
    schemaVersion: 1,
    expectedVersion,
    evidenceRoot:
      config.evidenceRoot === undefined
        ? null
        : assertIsolatedRoot(config.evidenceRoot, protectedRoots),
    protectedRoots,
    migrationFiles,
    artifacts,
    pythonCommand:
      typeof config.pythonCommand === "string" && config.pythonCommand.trim()
        ? config.pythonCommand.trim()
        : "python3",
    trustedKeys: TRUSTED_NATIVE_SOURCE_KEYS,
    timeouts: {
      commandMs: boundedTimeout(
        timeouts.commandMs,
        DEFAULT_TIMEOUTS.commandMs,
        "timeouts.commandMs"
      ),
      runtimeMs: boundedTimeout(
        timeouts.runtimeMs,
        DEFAULT_TIMEOUTS.runtimeMs,
        "timeouts.runtimeMs"
      ),
      stopMs: boundedTimeout(
        timeouts.stopMs,
        DEFAULT_TIMEOUTS.stopMs,
        "timeouts.stopMs"
      )
    }
  };
}

function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

function readJson(filePath, label = filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail("artifact", `${label} is not valid JSON.`, {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

function runCaptured(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUTS.commandMs,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024
  });
  if (options.logPath) {
    writeFileSync(
      options.logPath,
      `command: ${command} ${args.join(" ")}\nexit: ${String(result.status)}\n\nstdout:\n${result.stdout ?? ""}\n\nstderr:\n${result.stderr ?? ""}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
  }
  if (result.error || result.status !== 0) {
    fail(
      "command",
      `${command} ${args.join(" ")} failed with ${result.status ?? result.error?.message ?? "unknown status"}.`,
      {
        stdout: String(result.stdout ?? "").slice(-4_000),
        stderr: String(result.stderr ?? "").slice(-4_000),
        logPath: options.logPath ?? null
      }
    );
  }
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

let resolvedRustToolchainEnvironment;

function rustToolchainEnvironment() {
  if (resolvedRustToolchainEnvironment !== undefined) {
    return resolvedRustToolchainEnvironment;
  }
  const cargo = spawnSync("rustup", ["which", "cargo"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const rustc = spawnSync("rustup", ["which", "rustc"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const cargoPath = String(cargo.stdout ?? "").trim();
  const rustcPath = String(rustc.stdout ?? "").trim();
  resolvedRustToolchainEnvironment =
    cargo.status === 0 &&
    rustc.status === 0 &&
    path.isAbsolute(cargoPath) &&
    path.isAbsolute(rustcPath)
      ? {
          PATH: `${path.dirname(cargoPath)}${path.delimiter}${process.env.PATH ?? ""}`,
          RUSTC: rustcPath
        }
      : {};
  return resolvedRustToolchainEnvironment;
}

function isolatedToolEnvironment(homeRoot, cacheRoot, extra = {}) {
  const resolvedHome = path.resolve(homeRoot);
  const resolvedCache = path.resolve(cacheRoot);
  for (const directory of [resolvedHome, resolvedCache]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  return {
    ...process.env,
    HOME: resolvedHome,
    USERPROFILE: resolvedHome,
    XDG_CACHE_HOME: path.join(resolvedCache, "xdg"),
    npm_config_cache: path.join(resolvedCache, "npm"),
    npm_config_userconfig: path.join(resolvedHome, ".npmrc"),
    PIP_CACHE_DIR: path.join(resolvedCache, "pip"),
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    CARGO_HOME: path.join(resolvedCache, "cargo"),
    ...rustToolchainEnvironment(),
    ...extra
  };
}

async function assertReadableSourceTree(sourceRoot) {
  const suppliedMetadata = await lstat(sourceRoot);
  if (suppliedMetadata.isSymbolicLink() || !suppliedMetadata.isDirectory()) {
    fail("artifact", `Source root must be a real directory: ${sourceRoot}.`);
  }
  const root = await realpath(sourceRoot);
  const rootMetadata = await lstat(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    fail("artifact", `Source root must be a real directory: ${sourceRoot}.`);
  }
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if ([".git", "node_modules", "__pycache__"].includes(entry.name)) {
        continue;
      }
      const entryPath = path.join(directory, entry.name);
      const metadata = await lstat(entryPath);
      if (
        metadata.isSymbolicLink() ||
        (!metadata.isDirectory() && !metadata.isFile())
      ) {
        fail(
          "artifact",
          `Source root contains a link or special file: ${entryPath}.`
        );
      }
      if (metadata.isDirectory()) await walk(entryPath);
    }
  }
  await walk(root);
  return root;
}

async function copyHermesSource(sourceRoot, targetRoot) {
  await assertReadableSourceTree(sourceRoot);
  await cp(sourceRoot, targetRoot, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    filter(source) {
      const name = path.basename(source);
      return (
        ![
          ".git",
          "node_modules",
          "__pycache__",
          ".pytest_cache",
          ".mypy_cache",
          ".venv",
          "build"
        ].includes(name) && !name.endsWith(".egg-info")
      );
    }
  });
}

async function packageFromSource(
  surface,
  sourceRoot,
  artifactDirectory,
  config
) {
  await mkdir(artifactDirectory, { recursive: true });
  const packagingEnvironment = isolatedToolEnvironment(
    path.join(artifactDirectory, "packaging-home"),
    path.join(artifactDirectory, "packaging-cache")
  );
  if (
    surface === "openclaw" ||
    surface === "codex" ||
    surface === "forgeMemory"
  ) {
    const result = runCaptured(
      "npm",
      [
        "pack",
        "--ignore-scripts",
        "--pack-destination",
        artifactDirectory,
        "--json"
      ],
      {
        cwd: sourceRoot,
        env: packagingEnvironment,
        timeoutMs: config.timeouts.commandMs,
        logPath: path.join(artifactDirectory, `${surface}-pack.log`)
      }
    );
    let payload;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      fail("artifact", `npm pack did not return JSON for ${surface}.`);
    }
    const filename = payload?.[0]?.filename;
    if (typeof filename !== "string" || !filename.trim()) {
      fail("artifact", `npm pack did not identify the ${surface} archive.`);
    }
    return path.join(artifactDirectory, filename);
  }

  if (surface === "hermes") {
    const stagingRoot = path.join(artifactDirectory, "hermes-source");
    await copyHermesSource(sourceRoot, stagingRoot);
    runCaptured(
      config.pythonCommand,
      [
        "-m",
        "pip",
        "wheel",
        "--no-deps",
        "--no-build-isolation",
        "--wheel-dir",
        artifactDirectory,
        stagingRoot
      ],
      {
        env: {
          ...packagingEnvironment,
          PIP_NO_INDEX: "1"
        },
        timeoutMs: config.timeouts.commandMs,
        logPath: path.join(artifactDirectory, "hermes-pack.log")
      }
    );
    const wheels = (await readdir(artifactDirectory))
      .filter((entry) => entry.endsWith(".whl"))
      .sort();
    if (wheels.length !== 1) {
      fail(
        "artifact",
        "Hermes source packaging did not produce exactly one wheel."
      );
    }
    return path.join(artifactDirectory, wheels[0]);
  }

  fail("artifact", `No source packager is defined for ${surface}.`);
}

async function resolveArtifact(surface, spec, evidenceRoot, config) {
  if (spec.archive) {
    const suppliedMetadata = await lstat(spec.archive);
    if (suppliedMetadata.isSymbolicLink() || !suppliedMetadata.isFile()) {
      fail("artifact", `${surface} archive must be a real file.`);
    }
    const archivePath = await realpath(spec.archive);
    const metadata = await lstat(archivePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      fail("artifact", `${surface} archive must be a real file.`);
    }
    return { archivePath, provenance: "caller_archive", sourceRoot: null };
  }
  const sourceRoot = await assertReadableSourceTree(spec.sourceRoot);
  const archivePath = await packageFromSource(
    surface,
    sourceRoot,
    path.join(evidenceRoot, "artifacts", surface),
    config
  );
  return { archivePath, provenance: "caller_source_root", sourceRoot };
}

async function extractArchive(surface, archivePath, evidenceRoot, config) {
  const targetRoot = path.join(evidenceRoot, "extracted", surface);
  const result = runCaptured(
    config.pythonCommand,
    [
      "-c",
      SAFE_EXTRACT_PYTHON,
      archivePath,
      targetRoot,
      String(ARCHIVE_LIMITS.entries),
      String(ARCHIVE_LIMITS.fileBytes),
      String(ARCHIVE_LIMITS.totalBytes)
    ],
    {
      timeoutMs: config.timeouts.commandMs,
      logPath: path.join(evidenceRoot, "logs", `${surface}-extract.log`),
      maxBuffer: 128 * 1024 * 1024
    }
  );
  let inventory;
  try {
    inventory = JSON.parse(result.stdout);
  } catch {
    fail("artifact", `${surface} archive inventory is not valid JSON.`);
  }
  const inventoryPath = path.join(
    evidenceRoot,
    "inventories",
    `${surface}.json`
  );
  writeJson(inventoryPath, inventory);
  return {
    targetRoot,
    inventory,
    inventoryPath,
    archive: {
      path: archivePath,
      sha256: sha256File(archivePath),
      size: statSync(archivePath).size,
      entryCount: inventory.entryCount,
      unpackedBytes: inventory.totalBytes
    }
  };
}

async function findDirectories(root, predicate, maximumDepth = 4) {
  const found = [];
  async function walk(directory, depth) {
    if (predicate(directory)) found.push(directory);
    if (depth >= maximumDepth) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory())
        await walk(path.join(directory, entry.name), depth + 1);
    }
  }
  await walk(root, 0);
  return found;
}

async function findUniqueRoot(root, marker, label, maximumDepth = 4) {
  const matches = await findDirectories(
    root,
    (directory) => existsSync(path.join(directory, marker)),
    maximumDepth
  );
  if (matches.length !== 1) {
    fail(
      "artifact",
      `${label} expected exactly one ${marker} root; found ${matches.length}.`
    );
  }
  return matches[0];
}

function assertVersion(actual, expected, label) {
  if (actual !== expected) {
    fail("version", `${label} is ${String(actual)}, expected ${expected}.`);
  }
}

function parseHermesMetadataVersion(source) {
  const match = /^Version:\s*([^\s]+)\s*$/m.exec(source);
  return match?.[1] ?? null;
}

function parseHermesModuleVersion(source) {
  const match = /^__version__\s*=\s*["']([^"']+)["']\s*$/m.exec(source);
  return match?.[1] ?? null;
}

function parseHermesPluginVersion(source) {
  const match = /^version:\s*([^\s]+)\s*$/m.exec(source);
  return match?.[1] ?? null;
}

function assertFile(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    fail("artifact", `${label} is missing: ${filePath}.`);
  }
  return filePath;
}

function assertDirectory(directoryPath, label) {
  if (!existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) {
    fail("artifact", `${label} is missing: ${directoryPath}.`);
  }
  return directoryPath;
}

function assertOwnedRegularFile(filePath, label) {
  if (!existsSync(filePath)) fail("filesystem", `${label} is missing.`);
  const metadata = lstatSync(filePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail("filesystem", `${label} must be a regular non-symlink file.`);
  }
  if (
    typeof process.getuid === "function" &&
    typeof metadata.uid === "number" &&
    metadata.uid !== process.getuid()
  ) {
    fail("filesystem", `${label} is not owned by the current user.`);
  }
  return filePath;
}

function verifyMigrationRoots(surface, roots, config) {
  const canonical = Object.fromEntries(
    PEOPLE_PACKED_MIGRATIONS.map((name) => [
      name,
      {
        path: config.migrationFiles[name],
        bytes: readFileSync(config.migrationFiles[name]),
        sha256: sha256File(config.migrationFiles[name])
      }
    ])
  );
  return roots.map((root) => {
    assertDirectory(root, `${surface} migration root`);
    const files = PEOPLE_PACKED_MIGRATIONS.map((name) => {
      const filePath = assertFile(path.join(root, name), `${surface} ${name}`);
      const bytes = readFileSync(filePath);
      if (!bytes.equals(canonical[name].bytes)) {
        fail(
          "migration",
          `${surface} migration ${name} does not match canonical bytes.`,
          {
            expectedSha256: canonical[name].sha256,
            actualSha256: sha256Buffer(bytes),
            path: filePath
          }
        );
      }
      return { name, path: filePath, sha256: canonical[name].sha256 };
    });
    return { root, files };
  });
}

async function inspectOpenClaw(extracted, config) {
  const root = await findUniqueRoot(
    extracted.targetRoot,
    "package.json",
    "OpenClaw archive",
    2
  );
  const packageJson = readJson(path.join(root, "package.json"));
  if (packageJson.name !== "forge-openclaw-plugin") {
    fail("artifact", "OpenClaw archive has the wrong npm package name.");
  }
  const pluginManifest = readJson(
    assertFile(path.join(root, "openclaw.plugin.json"), "OpenClaw manifest")
  );
  assertVersion(
    packageJson.version,
    config.expectedVersion,
    "OpenClaw package"
  );
  assertVersion(
    pluginManifest.version,
    config.expectedVersion,
    "OpenClaw manifest"
  );
  if (!pluginManifest.contracts?.tools?.includes("forge_call_people_route")) {
    fail("contract", "OpenClaw manifest omits forge_call_people_route.");
  }
  assertFile(path.join(root, "server", "index.js"), "OpenClaw server entry");
  assertFile(
    path.join(root, "dist", "openclaw", "tools.js"),
    "OpenClaw tool runtime"
  );
  const migrationRoots = verifyMigrationRoots(
    "openclaw",
    [
      path.join(root, "server", "migrations"),
      path.join(root, "dist", "server", "apps", "api", "migrations")
    ],
    config
  );
  return {
    root,
    packageName: packageJson.name,
    version: packageJson.version,
    classification: "bundled_runtime_and_openclaw_adapter",
    migrationRoots,
    nativeRoot: assertDirectory(
      path.join(root, "dist", "forge-peer-src"),
      "OpenClaw signed forge-peer source"
    )
  };
}

async function inspectHermes(extracted, config) {
  const packageRoot = await findUniqueRoot(
    extracted.targetRoot,
    "forge_hermes",
    "Hermes wheel",
    2
  );
  const root = path.join(packageRoot, "forge_hermes");
  const distInfos = (await readdir(packageRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".dist-info"))
    .map((entry) => path.join(packageRoot, entry.name));
  if (distInfos.length !== 1) {
    fail(
      "artifact",
      "Hermes wheel must contain exactly one dist-info directory."
    );
  }
  const metadataVersion = parseHermesMetadataVersion(
    readFileSync(path.join(distInfos[0], "METADATA"), "utf8")
  );
  const moduleVersion = parseHermesModuleVersion(
    readFileSync(path.join(root, "version.py"), "utf8")
  );
  const pluginYamlPath = path.join(packageRoot, "plugin.yaml");
  const pluginVersion = existsSync(pluginYamlPath)
    ? parseHermesPluginVersion(readFileSync(pluginYamlPath, "utf8"))
    : config.expectedVersion;
  const runtimePackage = readJson(path.join(root, "runtime", "package.json"));
  for (const [label, version] of [
    ["Hermes wheel metadata", metadataVersion],
    ["Hermes module", moduleVersion],
    ["Hermes plugin manifest", pluginVersion],
    ["Hermes runtime", runtimePackage.version]
  ]) {
    assertVersion(version, config.expectedVersion, label);
  }
  const catalogSource = readFileSync(path.join(root, "catalog.py"), "utf8");
  if (!catalogSource.includes('"forge_call_people_route"')) {
    fail("contract", "Hermes wheel omits forge_call_people_route.");
  }
  const migrationRoots = verifyMigrationRoots(
    "hermes",
    [
      path.join(root, "runtime", "apps", "api", "migrations"),
      path.join(root, "runtime", "dist", "server", "apps", "api", "migrations")
    ],
    config
  );
  return {
    root,
    packageRoot,
    packageName: "forge-hermes-plugin",
    version: metadataVersion,
    classification: "python_adapter_with_bundled_node_runtime",
    migrationRoots,
    nativeRoot: assertDirectory(
      path.join(root, "runtime", "dist", "forge-peer-src"),
      "Hermes signed forge-peer source"
    )
  };
}

async function inspectCodex(extracted, config) {
  const root = await findUniqueRoot(
    extracted.targetRoot,
    "package.json",
    "Codex runtime archive",
    2
  );
  const packageJson = readJson(path.join(root, "package.json"));
  if (packageJson.name !== "forge-codex-runtime") {
    fail("artifact", "Codex archive has the wrong runtime package name.");
  }
  assertVersion(
    packageJson.version,
    config.expectedVersion,
    "Codex runtime archive"
  );
  assertFile(
    path.join(root, "dist", "openclaw", "local-runtime.js"),
    "Codex bundled local runtime adapter"
  );
  assertFile(
    path.join(root, "dist", "openclaw", "tools.js"),
    "Codex bundled Forge tool runtime"
  );
  const migrationRoots = verifyMigrationRoots(
    "codex",
    [
      path.join(root, "server", "migrations"),
      path.join(root, "dist", "server", "apps", "api", "migrations")
    ],
    config
  );
  return {
    root,
    packageName: packageJson.name,
    version: packageJson.version,
    classification:
      "repo_local_runtime_snapshot_with_installed_adapter_resolved_via_forge_memory_mcp",
    migrationRoots,
    nativeRoot: assertDirectory(
      path.join(root, "dist", "forge-peer-src"),
      "Codex signed forge-peer source"
    )
  };
}

async function inspectForgeMemory(extracted, config) {
  const root = await findUniqueRoot(
    extracted.targetRoot,
    "package.json",
    "Forge Memory archive",
    2
  );
  const packageJson = readJson(path.join(root, "package.json"));
  if (packageJson.name !== "forge-memory") {
    fail("artifact", "Forge Memory archive has the wrong npm package name.");
  }
  assertVersion(
    packageJson.version,
    config.expectedVersion,
    "Forge Memory package"
  );
  if (packageJson.bin?.["forge-memory"] !== "bin/forge-memory.mjs") {
    fail("contract", "Forge Memory archive has the wrong CLI entry.");
  }
  const cliSource = readFileSync(
    assertFile(path.join(root, "bin", "forge-memory.mjs"), "Forge Memory CLI"),
    "utf8"
  );
  for (const required of [
    'const RUNTIME_PACKAGE = "forge-openclaw-plugin"',
    "const RUNTIME_PACKAGE_VERSION = VERSION",
    'args = ["forge-memory", "mcp"]'
  ]) {
    if (!cliSource.includes(required)) {
      fail(
        "contract",
        `Forge Memory CLI does not preserve required runtime resolution: ${required}.`
      );
    }
  }
  assertFile(
    path.join(root, "lib", "peer-runtime-install.mjs"),
    "Forge Memory native admission module"
  );
  assertFile(
    path.join(root, "lib", "native-source-manifest.mjs"),
    "Forge Memory native signature verifier"
  );
  return {
    root,
    packageName: packageJson.name,
    version: packageJson.version,
    classification:
      "runtime_manager_and_mcp_adapter_resolving_openclaw_runtime",
    migrationRoots: [],
    nativeRoot: null
  };
}

async function inspectArtifact(surface, extracted, config) {
  if (surface === "openclaw") return inspectOpenClaw(extracted, config);
  if (surface === "hermes") return inspectHermes(extracted, config);
  if (surface === "codex") return inspectCodex(extracted, config);
  return inspectForgeMemory(extracted, config);
}

export async function prepareNativeRuntime(input) {
  const verified = await verifyNativeSourceBundle({
    sourceRoot: input.nativeRoot,
    expectedRuntimePackageVersion: input.expectedVersion,
    trustedKeys: input.trustedKeys,
    now: new Date()
  });
  const manifestPath = path.join(
    input.nativeRoot,
    "native-source.manifest.json"
  );
  const manifestSha256 = sha256File(manifestPath);
  const cacheRoot = path.join(
    input.evidenceRoot,
    "native-cache",
    manifestSha256
  );
  const targetRoot = path.join(cacheRoot, "target");
  const binaryName =
    process.platform === "win32" ? "forge-peer.exe" : "forge-peer";
  const binaryPath = path.join(targetRoot, "release", binaryName);
  const receiptPath = path.join(cacheRoot, "build-receipt.json");
  let built = false;
  let cached = false;
  const cacheHasBinary = existsSync(binaryPath);
  const cacheHasReceipt = existsSync(receiptPath);
  if (cacheHasBinary && cacheHasReceipt) {
    assertOwnedRegularFile(binaryPath, "Cached forge-peer binary");
    assertOwnedRegularFile(receiptPath, "Native build receipt");
    const receipt = readJson(receiptPath, "Native build receipt");
    cached =
      receipt.manifestSha256 === manifestSha256 &&
      typeof receipt.binarySha256 === "string" &&
      SHA256_PATTERN.test(receipt.binarySha256) &&
      receipt.binarySha256 === sha256File(binaryPath);
  }
  if ((cacheHasBinary || cacheHasReceipt) && !cached) {
    fail(
      "native_cache_integrity",
      "The preserved native build cache does not match its signed source receipt."
    );
  }
  if (!cached) {
    mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
    runCaptured(
      "cargo",
      [
        "build",
        "--locked",
        "--release",
        "--manifest-path",
        path.join(input.nativeRoot, "Cargo.toml"),
        "--bin",
        "forge-peer"
      ],
      {
        cwd: input.nativeRoot,
        env: isolatedToolEnvironment(
          path.join(input.evidenceRoot, "native-build-home"),
          path.join(input.evidenceRoot, "native-build-cache"),
          { CARGO_TARGET_DIR: targetRoot }
        ),
        timeoutMs: input.timeoutMs,
        logPath: path.join(cacheRoot, "cargo-build.log")
      }
    );
    built = true;
    assertOwnedRegularFile(binaryPath, "Verified forge-peer binary");
    writeJson(receiptPath, {
      manifestSha256,
      binarySha256: sha256File(binaryPath),
      runtimePackageVersion: verified.manifest.runtimePackageVersion,
      commitSha: verified.manifest.commitSha
    });
  }
  assertOwnedRegularFile(binaryPath, "Verified forge-peer binary");
  if (process.platform !== "win32") chmodSync(binaryPath, 0o700);
  return {
    sourceVerified: true,
    signatureVerified: true,
    runtimePackageVersion: verified.manifest.runtimePackageVersion,
    packageVersion: verified.manifest.packageVersion,
    commitSha: verified.manifest.commitSha,
    signingKeyId: verified.signature.keyId,
    manifestSha256,
    binaryPath,
    binarySha256: sha256File(binaryPath),
    built
  };
}

export async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error("Could not allocate a port."));
        else resolve(port);
      });
    });
  });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processExists(pid);
}

export async function stopTrackedChild(
  child,
  timeoutMs = DEFAULT_TIMEOUTS.stopMs
) {
  if (child?.spawnError || !child?.pid) {
    return { stopped: true, forced: false, pid: child?.pid ?? null };
  }
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return { stopped: true, forced: false, pid: child?.pid ?? null };
  }
  const pid = child.pid;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ]);
  if (exited) return { stopped: true, forced: false, pid };
  child.kill("SIGKILL");
  const forcedExit = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 1_000))
  ]);
  return { stopped: Boolean(forcedExit), forced: true, pid };
}

export async function stopIsolatedManagedRuntimes(
  homeRoot,
  surfaceRoot,
  timeoutMs
) {
  const candidates = [];
  const commandBelongsToSurface = (command) =>
    command.includes(`${surfaceRoot}${path.sep}`);
  const openClawStateRoot = path.join(
    homeRoot,
    ".openclaw",
    "run",
    "forge-openclaw-plugin"
  );
  if (existsSync(openClawStateRoot)) {
    for (const entry of await readdir(openClawStateRoot)) {
      if (!entry.endsWith(".json") || entry.endsWith("preferred-port.json"))
        continue;
      try {
        const value = readJson(path.join(openClawStateRoot, entry));
        if (Number.isInteger(value.pid) && value.pid > 0) {
          candidates.push(value.pid);
        }
      } catch {
        // A malformed isolated state file cannot authorize process termination.
      }
    }
  }
  const memoryState = path.join(
    homeRoot,
    ".forge",
    "run",
    "forge-memory-runtime.json"
  );
  if (existsSync(memoryState)) {
    try {
      const value = readJson(memoryState);
      for (const child of value.children ?? []) {
        if (Number.isInteger(child?.pid) && child.pid > 0) {
          candidates.push(child.pid);
        }
      }
      if (Number.isInteger(value.pid) && value.pid > 0) {
        candidates.push(value.pid);
      }
    } catch {
      // A malformed isolated state file cannot authorize process termination.
    }
  }
  if (process.platform !== "win32") {
    const processList = spawnSync("ps", ["-axo", "pid=,command="], {
      encoding: "utf8"
    });
    for (const line of String(processList.stdout ?? "").split(/\r?\n/)) {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line);
      if (
        match &&
        Number(match[1]) !== process.pid &&
        commandBelongsToSurface(match[2])
      ) {
        candidates.push(Number(match[1]));
      }
    }
  }
  const unique = [...new Set(candidates)];
  const results = [];
  for (const pid of unique) {
    if (!processExists(pid)) {
      results.push({ pid, stopped: true, forced: false });
      continue;
    }
    let command = "";
    if (process.platform !== "win32") {
      const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8"
      });
      command = String(result.stdout ?? "").trim();
    }
    if (!command || !commandBelongsToSurface(command)) {
      results.push({ pid, stopped: false, forced: false, refused: true });
      continue;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      const stopped = !processExists(pid);
      results.push({ pid, stopped, forced: false, refused: !stopped });
      continue;
    }
    let stopped = await waitForProcessExit(pid, timeoutMs);
    let forced = false;
    if (!stopped) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        stopped = !processExists(pid);
      }
      forced = true;
      if (!stopped) stopped = await waitForProcessExit(pid, 1_000);
    }
    results.push({ pid, stopped, forced });
  }
  return {
    processes: results,
    allStopped: results.every((entry) => entry.stopped === true)
  };
}

export async function waitForForgeHealth({
  baseUrl,
  dataRoot,
  timeoutMs,
  child
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "runtime did not answer";
  while (Date.now() < deadline) {
    if (child?.spawnError) {
      fail("runtime", `Runtime could not spawn: ${child.spawnError.message}.`);
    }
    if (child && child.exitCode !== null) {
      fail(
        "runtime",
        `Runtime exited before health with code ${child.exitCode}.`
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`, {
        headers: { accept: "application/json", "x-forge-runtime-probe": "1" },
        signal: AbortSignal.timeout(2_000)
      });
      if (response.ok) {
        const payload = await response.json();
        const storageRoot = payload?.runtime?.storageRoot;
        if (
          typeof storageRoot !== "string" ||
          path.resolve(storageRoot) !== path.resolve(dataRoot)
        ) {
          fail(
            "runtime_root",
            `Runtime health resolved ${String(storageRoot)}, expected ${dataRoot}.`
          );
        }
        return payload;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail("runtime", `Forge health timed out: ${lastError}.`);
}

function assertForgeRuntimePackageHealth(payload, expectedVersion) {
  if (
    payload?.runtime?.packageName !== "forge-openclaw-plugin" ||
    payload?.runtime?.packageVersion !== expectedVersion
  ) {
    fail(
      "runtime_version",
      "Forge health did not report the exact running OpenClaw runtime package."
    );
  }
}

function setCookieValues(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function firstCookie(headers) {
  for (const value of setCookieValues(headers)) {
    const cookie = String(value).split(";", 1)[0]?.trim();
    if (cookie) return cookie;
  }
  return null;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { accept: "application/json", ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000)
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

export async function exercisePeopleHttp({
  baseUrl,
  surface,
  userId = "user_operator"
}) {
  const session = await requestJson(`${baseUrl}/api/v1/auth/operator-session`);
  if (!session.response.ok) {
    fail(
      "runtime",
      `${surface} operator session returned ${session.response.status}.`
    );
  }
  const cookie = firstCookie(session.response.headers);
  if (!cookie)
    fail("runtime", `${surface} operator session returned no cookie.`);
  const displayName = `Packed ${surface} Person`;
  const create = await requestJson(`${baseUrl}/api/v1/entities/create`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      atomic: true,
      operations: [
        {
          entityType: "person",
          clientRef: `${surface}-person`,
          idempotencyKey: `people-packed-${surface}-person-v1`,
          data: {
            userId,
            displayName,
            relationshipCategory: "colleague",
            shortDescription: "Isolated packed-surface verification record."
          }
        }
      ]
    })
  });
  if (!create.response.ok || create.body?.results?.[0]?.ok !== true) {
    fail(
      "person_create",
      `${surface} Person create failed with HTTP ${create.response.status}.`
    );
  }
  const list = await requestJson(
    `${baseUrl}/api/v1/people?limit=20&source=both&sort=display_name&direction=asc`,
    { headers: { cookie } }
  );
  if (
    !list.response.ok ||
    !Array.isArray(list.body?.people) ||
    !list.body.people.some((person) => person.displayName === displayName)
  ) {
    fail(
      "person_list",
      `${surface} Person list did not return the created record.`
    );
  }
  const tokenResult = await requestJson(`${baseUrl}/api/v1/settings/tokens`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      label: `Packed ${surface} People reader`,
      agentLabel: `Packed ${surface}`,
      agentType: surface,
      description: "Ephemeral isolated release verification token.",
      trustLevel: "trusted",
      autonomyMode: "approval_required",
      approvalMode: "approval_by_default",
      scopes: ["read", "people:read:basic"],
      scopePolicy: { userIds: [userId], projectIds: [], tagIds: [] }
    })
  });
  const token = tokenResult.body?.token?.token;
  if (!tokenResult.response.ok || typeof token !== "string" || !token) {
    fail("token", `${surface} could not issue an isolated People read token.`);
  }
  return {
    cookie,
    token,
    displayName,
    personId: create.body?.results?.[0]?.entity?.id ?? null,
    created: true,
    listed: true
  };
}

function containsPersonRecord(value, displayName, depth = 0, seen = new Set()) {
  if (depth > 12) return false;
  if (typeof value === "string") {
    if (value.length > 2 * 1024 * 1024) return false;
    try {
      return containsPersonRecord(
        JSON.parse(value),
        displayName,
        depth + 1,
        seen
      );
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (
    value.displayName === displayName &&
    typeof value.id === "string" &&
    value.id.trim().length > 0
  ) {
    return true;
  }
  return Object.values(value).some((entry) =>
    containsPersonRecord(entry, displayName, depth + 1, seen)
  );
}

function assertPeopleToolResult(surface, result, displayName) {
  if (result?.isError === true || !containsPersonRecord(result, displayName)) {
    fail(
      "people_tool",
      `${surface} People tool did not return the created Person.`
    );
  }
  return true;
}

function spawnLogged(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: false
  });
  child.stdoutLog = "";
  child.stderrLog = "";
  child.spawnError = null;
  let resolveLogWritten;
  let rejectLogWritten;
  child.logWritten = new Promise((resolve, reject) => {
    resolveLogWritten = resolve;
    rejectLogWritten = reject;
  });
  child.stdout.on("data", (chunk) => {
    child.stdoutLog += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    child.stderrLog += chunk.toString();
  });
  child.on("error", (error) => {
    child.spawnError = error;
    child.stderrLog += `\nspawn error: ${error.message}\n`;
  });
  child.once("close", (code, signal) => {
    try {
      writeFileSync(
        options.logPath,
        `command: ${command} ${args.join(" ")}\nexit: ${String(code)}\nsignal: ${String(signal)}\n\nstdout:\n${child.stdoutLog}\n\nstderr:\n${child.stderrLog}\n`,
        { encoding: "utf8", mode: 0o600 }
      );
      resolveLogWritten();
    } catch (error) {
      rejectLogWritten(error);
    }
  });
  return child;
}

function installNpmArchive({
  archivePath,
  installRoot,
  packageName,
  config,
  logPath,
  env
}) {
  mkdirSync(installRoot, { recursive: true, mode: 0o700 });
  writeJson(path.join(installRoot, "package.json"), {
    name: `people-packed-${packageName.replace(/[^a-z0-9-]+/gi, "-")}`,
    private: true,
    type: "module"
  });
  runCaptured(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      "--no-save",
      "--package-lock=false",
      archivePath
    ],
    {
      cwd: installRoot,
      env,
      timeoutMs: config.timeouts.commandMs,
      logPath
    }
  );
  const packageRoot = path.join(installRoot, "node_modules", packageName);
  assertDirectory(packageRoot, `${packageName} installed package`);
  const installed = readJson(path.join(packageRoot, "package.json"));
  assertVersion(
    installed.version,
    config.expectedVersion,
    `${packageName} install`
  );
  return packageRoot;
}

async function probePeerGateway(packageRuntimeRoot, socketPath) {
  const gatewayPath = path.join(
    packageRuntimeRoot,
    "dist",
    "server",
    "apps",
    "api",
    "src",
    "services",
    "peer-core-ipc-gateway.js"
  );
  assertFile(gatewayPath, "Packed peer gateway module");
  const { UnixSocketPeerCoreGateway } = await import(
    `${pathToFileURL(gatewayPath).href}?packed=${Date.now()}`
  );
  const gateway = new UnixSocketPeerCoreGateway({
    socketPath,
    ownerUserId: "user_operator"
  });
  const health = await gateway.health();
  const identity = await gateway.localIdentity({
    ownerUserId: "user_operator"
  });
  if (
    !health?.enabled ||
    !health?.healthy ||
    health?.protocolVersion !== "forge-peer/1" ||
    !identity?.principal?.id ||
    identity?.principal?.trustState !== "verified" ||
    !identity?.device?.id
  ) {
    fail(
      "peer_admission",
      "Packed forge-peer gateway health or identity failed."
    );
  }
  return {
    healthy: true,
    protocolVersion: health.protocolVersion,
    principalId: identity.principal.id,
    deviceId: identity.device.id
  };
}

export function isolatedEnvironment(context, extra = {}) {
  return {
    ...isolatedToolEnvironment(
      context.homeRoot,
      path.join(context.root, "tool-cache")
    ),
    FORGE_DATA_ROOT: context.dataRoot,
    FORGE_ORIGIN: "http://127.0.0.1",
    FORGE_PORT: String(context.port),
    HOST: "127.0.0.1",
    PORT: String(context.port),
    FORGE_PEER_ENABLED: "1",
    FORGE_PEER_REQUIRED: "1",
    FORGE_PEER_ENABLE_IROH: "1",
    ...(context.native?.binaryPath
      ? { FORGE_PEER_BIN: context.native.binaryPath }
      : {}),
    FORGE_PEER_SOCKET_PATH: context.peerSocketPath,
    FORGE_PEER_STATE_DIR: context.peerStateRoot,
    ...extra
  };
}

export function resolveSurfaceSocketPath(evidenceRoot, surface) {
  const runId = createHash("sha256")
    .update(evidenceRoot)
    .digest("hex")
    .slice(0, 12);
  const socketPath = path.join(
    realpathSync("/tmp"),
    `fp-${runId}-${surface}.sock`
  );
  if (Buffer.byteLength(socketPath) > 100) {
    fail(
      "configuration",
      "The packed-surface forge-peer socket path exceeds the portable Unix limit."
    );
  }
  return socketPath;
}

export function resolveOwnerScopedSocketPath(
  configuredSocketPath,
  ownerUserId = "user_operator"
) {
  const ownerKey = createHash("sha256")
    .update(ownerUserId, "utf8")
    .digest("hex")
    .slice(0, 16);
  return path.join(
    path.dirname(configuredSocketPath),
    ownerKey,
    path.basename(configuredSocketPath)
  );
}

function makeSurfaceContext(surface, records, config, evidenceRoot) {
  const root = path.join(evidenceRoot, "surfaces", surface);
  const homeRoot = path.join(root, "home");
  const dataRoot = path.join(root, "data");
  const installRoot = path.join(root, "install");
  const peerStateRoot = path.join(root, "peer-state");
  const peerSocketPath = resolveSurfaceSocketPath(evidenceRoot, surface);
  for (const [candidate, label] of [
    [root, `${surface} root`],
    [homeRoot, `${surface} home`],
    [dataRoot, `${surface} data root`]
  ]) {
    assertIsolatedRoot(candidate, config.protectedRoots, label);
  }
  for (const directory of [
    root,
    homeRoot,
    dataRoot,
    installRoot,
    peerStateRoot
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  return {
    surface,
    root,
    homeRoot,
    dataRoot,
    installRoot,
    peerStateRoot,
    peerSocketPath,
    records,
    config,
    evidenceRoot,
    port: null,
    native: null
  };
}

async function invokeOpenClawPeopleTool(context, packageRoot, people) {
  const scriptPath = path.join(context.root, "invoke-openclaw-people.mjs");
  writeFileSync(
    scriptPath,
    `import { pathToFileURL } from "node:url";\nconst root = process.argv[2];\nconst token = process.env.FORGE_API_TOKEN;\nconst [{ resolveForgePluginConfig }, { registerForgePluginTools }] = await Promise.all([\n  import(pathToFileURL(root + "/dist/openclaw/plugin-entry-shared.js").href),\n  import(pathToFileURL(root + "/dist/openclaw/tools.js").href)\n]);\nconst config = resolveForgePluginConfig({ origin: "http://127.0.0.1", port: Number(process.env.FORGE_PORT), dataRoot: process.env.FORGE_DATA_ROOT, apiToken: token, actorLabel: "Packed OpenClaw", timeoutMs: 15000 });\nconst tools = [];\nregisterForgePluginTools({ registerTool: (tool) => tools.push(tool) }, config);\nconst tool = tools.find((entry) => entry.name === "forge_call_people_route");\nif (!tool) throw new Error("forge_call_people_route missing");\nconst result = await tool.execute("people_packed_surface", { routeKey: "listPeopleReadModel", query: { userId: "user_operator", query: process.env.PACKED_PERSON_NAME, limit: 20 } });\nprocess.stdout.write(JSON.stringify(result));\n`,
    { encoding: "utf8", mode: 0o700 }
  );
  const result = runCaptured(process.execPath, [scriptPath, packageRoot], {
    cwd: packageRoot,
    env: isolatedEnvironment(context, {
      FORGE_API_TOKEN: people.token,
      PACKED_PERSON_NAME: people.displayName
    }),
    timeoutMs: context.config.timeouts.commandMs,
    logPath: path.join(context.root, "openclaw-people-tool.log")
  });
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    fail("people_tool", "OpenClaw People tool returned non-JSON output.");
  }
  assertPeopleToolResult("openclaw", payload, people.displayName);
  return {
    name: "forge_call_people_route",
    transport: "openclaw_registered_tool",
    mcpExposedContract: true,
    returnedCreatedPerson: true
  };
}

async function executeOpenClaw(context, hooks) {
  const record = context.records.openclaw;
  const packageRoot = installNpmArchive({
    archivePath: record.archive.path,
    installRoot: context.installRoot,
    packageName: "forge-openclaw-plugin",
    config: context.config,
    logPath: path.join(context.root, "npm-install.log"),
    env: isolatedEnvironment(context)
  });
  context.native = await hooks.prepareNativeRuntime({
    nativeRoot: path.join(packageRoot, "dist", "forge-peer-src"),
    expectedVersion: context.config.expectedVersion,
    trustedKeys: context.config.trustedKeys,
    evidenceRoot: context.evidenceRoot,
    timeoutMs: context.config.timeouts.commandMs
  });
  context.port = await findFreePort();
  const child = spawnLogged(
    process.execPath,
    [path.join(packageRoot, "server", "index.js")],
    {
      cwd: packageRoot,
      env: isolatedEnvironment(context),
      logPath: path.join(context.root, "runtime.log")
    }
  );
  let cleanup;
  try {
    const baseUrl = `http://127.0.0.1:${context.port}`;
    const health = await waitForForgeHealth({
      baseUrl,
      dataRoot: context.dataRoot,
      timeoutMs: context.config.timeouts.runtimeMs,
      child
    });
    const peer = await hooks.probePeerGateway(
      packageRoot,
      resolveOwnerScopedSocketPath(context.peerSocketPath)
    );
    const people = await exercisePeopleHttp({ baseUrl, surface: "openclaw" });
    const peopleTool = await invokeOpenClawPeopleTool(
      context,
      packageRoot,
      people
    );
    return {
      runtimeResolution: {
        kind: "bundled_backend",
        packageName: "forge-openclaw-plugin",
        packageRoot,
        version: context.config.expectedVersion,
        targetArtifactRegistryFallbackAllowed: false,
        dependencyResolution: "package_declared_dependencies"
      },
      health: {
        ok: true,
        backend: health.backend,
        storageRoot: health.runtime?.storageRoot
      },
      native: { ...context.native, runtimeProbe: peer },
      person: {
        created: people.created,
        listed: people.listed,
        idPresent: typeof people.personId === "string"
      },
      peopleTool,
      cleanup: { allChildrenStopped: true, evidenceRootPreserved: true }
    };
  } finally {
    cleanup = await stopTrackedChild(child, context.config.timeouts.stopMs);
    const managedCleanup = await stopIsolatedManagedRuntimes(
      context.homeRoot,
      context.root,
      context.config.timeouts.stopMs
    );
    if (!cleanup.stopped || !managedCleanup.allStopped) {
      fail("cleanup", "OpenClaw packed runtime did not stop.");
    }
  }
}

function createHermesInvocationScript(context) {
  const scriptPath = path.join(context.root, "invoke-hermes.py");
  writeFileSync(
    scriptPath,
    `import json\nimport os\nfrom forge_hermes.tools import build_handler\ntool = os.environ["PACKED_HERMES_TOOL"]\nargs = json.loads(os.environ.get("PACKED_HERMES_ARGS", "{}"))\nprint(build_handler(tool)(args))\n`,
    { encoding: "utf8", mode: 0o700 }
  );
  return scriptPath;
}

async function executeHermes(context, hooks) {
  const wheel = context.records.hermes.archive.path;
  const venvRoot = path.join(context.installRoot, "venv");
  runCaptured(context.config.pythonCommand, ["-m", "venv", venvRoot], {
    env: isolatedEnvironment(context),
    timeoutMs: context.config.timeouts.commandMs,
    logPath: path.join(context.root, "venv.log")
  });
  const python =
    process.platform === "win32"
      ? path.join(venvRoot, "Scripts", "python.exe")
      : path.join(venvRoot, "bin", "python");
  runCaptured(python, ["-m", "pip", "install", "--no-deps", wheel], {
    env: {
      ...isolatedEnvironment(context),
      PIP_NO_INDEX: "1"
    },
    timeoutMs: context.config.timeouts.commandMs,
    logPath: path.join(context.root, "pip-install.log")
  });
  const location = runCaptured(
    python,
    [
      "-c",
      "import json, pathlib, forge_hermes; print(json.dumps({'root': str(pathlib.Path(forge_hermes.__file__).resolve().parent), 'version': forge_hermes.__version__}))"
    ],
    {
      env: isolatedEnvironment(context),
      timeoutMs: context.config.timeouts.commandMs
    }
  );
  const installed = JSON.parse(location.stdout);
  assertVersion(
    installed.version,
    context.config.expectedVersion,
    "Installed Hermes wheel"
  );
  const packageRoot = installed.root;
  context.native = await hooks.prepareNativeRuntime({
    nativeRoot: path.join(packageRoot, "runtime", "dist", "forge-peer-src"),
    expectedVersion: context.config.expectedVersion,
    trustedKeys: context.config.trustedKeys,
    evidenceRoot: context.evidenceRoot,
    timeoutMs: context.config.timeouts.commandMs
  });
  context.port = await findFreePort();
  const invocation = createHermesInvocationScript(context);
  const environment = isolatedEnvironment(context, {
    HERMES_HOME: path.join(context.homeRoot, ".hermes"),
    PACKED_HERMES_TOOL: "forge_get_operator_overview",
    PACKED_HERMES_ARGS: "{}"
  });
  try {
    runCaptured(python, [invocation], {
      cwd: context.root,
      env: environment,
      timeoutMs: context.config.timeouts.commandMs,
      logPath: path.join(context.root, "hermes-start.log")
    });
    const baseUrl = `http://127.0.0.1:${context.port}`;
    const health = await waitForForgeHealth({
      baseUrl,
      dataRoot: context.dataRoot,
      timeoutMs: context.config.timeouts.runtimeMs
    });
    const runtimeRoot = path.join(packageRoot, "runtime");
    const peer = await hooks.probePeerGateway(
      runtimeRoot,
      resolveOwnerScopedSocketPath(context.peerSocketPath)
    );
    const people = await exercisePeopleHttp({ baseUrl, surface: "hermes" });
    const peopleResult = runCaptured(python, [invocation], {
      cwd: context.root,
      env: {
        ...environment,
        FORGE_API_TOKEN: people.token,
        PACKED_HERMES_TOOL: "forge_call_people_route",
        PACKED_HERMES_ARGS: JSON.stringify({
          routeKey: "listPeopleReadModel",
          query: {
            userId: "user_operator",
            query: people.displayName,
            limit: 20
          }
        })
      },
      timeoutMs: context.config.timeouts.commandMs,
      logPath: path.join(context.root, "hermes-people-tool.log")
    });
    let payload;
    try {
      payload = JSON.parse(peopleResult.stdout.trim());
    } catch {
      fail("people_tool", "Hermes People handler returned non-JSON output.");
    }
    assertPeopleToolResult("hermes", payload, people.displayName);
    return {
      runtimeResolution: {
        kind: "wheel_bundled_node_runtime",
        packageName: "forge-hermes-plugin",
        packageRoot,
        runtimeRoot,
        version: context.config.expectedVersion,
        targetArtifactRegistryFallbackAllowed: false,
        dependencyResolution: "wheel_no_deps_no_index"
      },
      health: {
        ok: true,
        backend: health.backend,
        storageRoot: health.runtime?.storageRoot
      },
      native: { ...context.native, runtimeProbe: peer },
      person: {
        created: people.created,
        listed: people.listed,
        idPresent: typeof people.personId === "string"
      },
      peopleTool: {
        name: "forge_call_people_route",
        transport: "hermes_plugin_handler",
        mcpExposedContract: true,
        returnedCreatedPerson: true
      },
      cleanup: { allChildrenStopped: true, evidenceRootPreserved: true }
    };
  } finally {
    const cleanup = await stopIsolatedManagedRuntimes(
      context.homeRoot,
      context.root,
      context.config.timeouts.stopMs
    );
    if (!cleanup.allStopped)
      fail("cleanup", "Hermes managed runtime did not stop.");
  }
}

function installForgeMemoryPair(context) {
  const memoryRoot = installNpmArchive({
    archivePath: context.records.forgeMemory.archive.path,
    installRoot: context.installRoot,
    packageName: "forge-memory",
    config: context.config,
    logPath: path.join(context.root, "forge-memory-install.log"),
    env: isolatedEnvironment(context)
  });
  const runtimeInstallRoot = path.join(context.homeRoot, ".forge", "runtime");
  const runtimeRoot = installNpmArchive({
    archivePath: context.records.openclaw.archive.path,
    installRoot: runtimeInstallRoot,
    packageName: "forge-openclaw-plugin",
    config: context.config,
    logPath: path.join(context.root, "openclaw-runtime-install.log"),
    env: isolatedEnvironment(context)
  });
  return { memoryRoot, runtimeRoot, runtimeInstallRoot };
}

function runForgeMemoryAdmission(context, memoryRoot, runtimeRoot) {
  const scriptPath = path.join(context.root, "admit-forge-peer.mjs");
  writeFileSync(
    scriptPath,
    `import { spawnSync } from "node:child_process";\nimport { pathToFileURL } from "node:url";\nconst memoryRoot = process.argv[2];\nconst pluginRoot = process.argv[3];\nconst nativeRoot = process.argv[4];\nconst version = process.argv[5];\nconst { prepareForgePeerRuntime } = await import(pathToFileURL(memoryRoot + "/lib/peer-runtime-install.mjs").href);\nconst result = await prepareForgePeerRuntime({ mode: "packaged", pluginRoot, nativeRoot, runtimePackageVersion: version, environment: process.env, runCargo: async ({ args, cwd, env }) => { const child = spawnSync("cargo", args, { cwd, env, encoding: "utf8", timeout: 600000 }); if (child.status !== 0) { process.stderr.write(child.stdout || ""); process.stderr.write(child.stderr || ""); return { ok: false }; } return { ok: true }; } });\nprocess.stdout.write(JSON.stringify(result));\n`,
    { encoding: "utf8", mode: 0o700 }
  );
  const nativeRoot = path.join(context.homeRoot, ".forge", "native");
  const result = runCaptured(
    process.execPath,
    [
      scriptPath,
      memoryRoot,
      runtimeRoot,
      nativeRoot,
      context.config.expectedVersion
    ],
    {
      cwd: context.root,
      env: isolatedEnvironment(context),
      timeoutMs: context.config.timeouts.commandMs,
      logPath: path.join(context.root, "forge-memory-native-admission.log")
    }
  );
  const payload = JSON.parse(result.stdout);
  if (!payload?.ok || !payload?.binaryPath || !payload?.receiptPath) {
    fail(
      "peer_admission",
      "Forge Memory did not admit the signed forge-peer source."
    );
  }
  if (
    payload.sourceIdentity?.runtimePackageVersion !==
    context.config.expectedVersion
  ) {
    fail(
      "peer_admission",
      "Forge Memory admitted native source for the wrong runtime version."
    );
  }
  const resolvedNativeRoot = realpathSync(nativeRoot);
  assertOwnedRegularFile(
    payload.binaryPath,
    "Forge Memory admitted forge-peer binary"
  );
  assertOwnedRegularFile(
    payload.receiptPath,
    "Forge Memory native build receipt"
  );
  const binaryPath = realpathSync(payload.binaryPath);
  const receiptPath = realpathSync(payload.receiptPath);
  if (
    !isSameOrNested(binaryPath, resolvedNativeRoot) ||
    !isSameOrNested(receiptPath, resolvedNativeRoot)
  ) {
    fail(
      "peer_admission",
      "Forge Memory native admission escaped its isolated native root."
    );
  }
  return {
    sourceVerified: true,
    signatureVerified: true,
    admissionModule: path.join(memoryRoot, "lib", "peer-runtime-install.mjs"),
    binaryPath,
    binarySha256: sha256File(binaryPath),
    receiptPath,
    sourceIdentity: payload.sourceIdentity
  };
}

function startForgeMemory(context, memoryRoot, adapters) {
  const cli = path.join(memoryRoot, "bin", "forge-memory.mjs");
  const args = [
    cli,
    "install",
    "--yes",
    "--skip-pair-ios",
    "--no-doctor",
    "--data-root",
    context.dataRoot,
    "--port",
    String(context.port),
    "--enable-peer",
    "--enable-peer-iroh",
    "--adapters",
    adapters
  ];
  runCaptured(process.execPath, args, {
    cwd: context.installRoot,
    env: isolatedEnvironment(context, {
      npm_config_registry: "http://127.0.0.1:9/",
      npm_config_fetch_retries: "0",
      npm_config_fetch_timeout: "1000"
    }),
    timeoutMs: context.config.timeouts.commandMs,
    logPath: path.join(context.root, "forge-memory-start.log")
  });
  return cli;
}

function replaceStaleManagedForgeMemoryRuntime(
  context,
  memoryRoot,
  runtimeRoot,
  adapters
) {
  const statePath = path.join(
    context.homeRoot,
    ".forge",
    "run",
    "forge-memory-runtime.json"
  );
  const initialState = readJson(statePath);
  const initialServerPid = initialState?.children?.find(
    (child) => child?.role === "server"
  )?.pid;
  if (
    initialState?.runtimePackageName !== "forge-openclaw-plugin" ||
    initialState?.runtimePackageVersion !== context.config.expectedVersion ||
    !Number.isInteger(initialServerPid) ||
    initialServerPid <= 0
  ) {
    fail(
      "runtime_version",
      "Forge Memory did not record the exact managed runtime package identity."
    );
  }

  writeFileSync(
    statePath,
    `${JSON.stringify(
      { ...initialState, runtimePackageVersion: "0.0.0-stale" },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  startForgeMemory(context, memoryRoot, adapters);

  const replacementState = readJson(statePath);
  const replacementServerPid = replacementState?.children?.find(
    (child) => child?.role === "server"
  )?.pid;
  if (
    replacementState?.runtimePackageName !== "forge-openclaw-plugin" ||
    replacementState?.runtimePackageVersion !==
      context.config.expectedVersion ||
    !Number.isInteger(replacementServerPid) ||
    replacementServerPid <= 0 ||
    replacementServerPid === initialServerPid ||
    processExists(initialServerPid)
  ) {
    fail(
      "runtime_version",
      "Forge Memory adopted a stale managed runtime instead of replacing it."
    );
  }

  const migrations = verifyMigrationRoots(
    "Forge Memory replaced runtime",
    [
      path.join(runtimeRoot, "server", "migrations"),
      path.join(runtimeRoot, "dist", "server", "apps", "api", "migrations")
    ],
    context.config
  );
  return {
    staleRuntimeReplaced: true,
    initialServerPid,
    replacementServerPid,
    verifiedMigrationRoots: migrations.length
  };
}

export async function callMcpPeopleTool({
  command,
  args,
  cwd,
  env,
  displayName,
  logPath,
  timeoutMs
}) {
  const child = spawnLogged(command, args, { cwd, env, logPath });
  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  const failPending = (error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error)
          entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
      }
    }
  });
  child.once("exit", (code, signal) => {
    failPending(
      new Error(`MCP process exited (${String(code)}, ${String(signal)}).`)
    );
  });
  child.once("error", (error) => failPending(error));
  const request = (method, params) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} timed out.`));
      }, timeoutMs);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        }
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`
      );
    });
  };
  try {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "forge-people-packed-surfaces", version: "1.0.0" }
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`
    );
    const tools = await request("tools/list", {});
    if (
      !Array.isArray(tools?.tools) ||
      !tools.tools.some((tool) => tool.name === "forge_call_people_route")
    ) {
      fail("people_tool", "MCP server omits forge_call_people_route.");
    }
    const result = await request("tools/call", {
      name: "forge_call_people_route",
      arguments: {
        routeKey: "listPeopleReadModel",
        query: {
          userId: "user_operator",
          query: displayName,
          limit: 20
        }
      }
    });
    assertPeopleToolResult("MCP", result, displayName);
    return {
      name: "forge_call_people_route",
      transport: "mcp_stdio",
      mcpExposedContract: true,
      returnedCreatedPerson: true
    };
  } finally {
    child.stdin.end();
    const cleanup = await stopTrackedChild(child, DEFAULT_TIMEOUTS.stopMs);
    if (!cleanup.stopped) fail("cleanup", "MCP process did not stop.");
    await child.logWritten;
  }
}

async function executeForgeMemoryAdapter(context, hooks, adapter) {
  const codexRuntimeSnapshotRoot =
    adapter === "codex"
      ? installNpmArchive({
          archivePath: context.records.codex.archive.path,
          installRoot: path.join(context.root, "codex-runtime-install"),
          packageName: "forge-codex-runtime",
          config: context.config,
          logPath: path.join(context.root, "codex-runtime-install.log"),
          env: isolatedEnvironment(context)
        })
      : null;
  const { memoryRoot, runtimeRoot, runtimeInstallRoot } =
    installForgeMemoryPair(context);
  context.port = await findFreePort();
  const admission = runForgeMemoryAdmission(context, memoryRoot, runtimeRoot);
  context.native = admission;
  const cli = path.join(memoryRoot, "bin", "forge-memory.mjs");
  const baseUrl = `http://127.0.0.1:${context.port}`;
  let execution = null;
  let executionError = null;
  try {
    const adapters = adapter === "codex" ? "codex" : "none";
    startForgeMemory(context, memoryRoot, adapters);
    let health = await waitForForgeHealth({
      baseUrl,
      dataRoot: context.dataRoot,
      timeoutMs: context.config.timeouts.runtimeMs
    });
    assertForgeRuntimePackageHealth(health, context.config.expectedVersion);
    const staleRuntimeReplacement = replaceStaleManagedForgeMemoryRuntime(
      context,
      memoryRoot,
      runtimeRoot,
      adapters
    );
    health = await waitForForgeHealth({
      baseUrl,
      dataRoot: context.dataRoot,
      timeoutMs: context.config.timeouts.runtimeMs
    });
    assertForgeRuntimePackageHealth(health, context.config.expectedVersion);
    const peer = await hooks.probePeerGateway(
      runtimeRoot,
      resolveOwnerScopedSocketPath(context.peerSocketPath)
    );
    const people = await exercisePeopleHttp({ baseUrl, surface: adapter });
    if (adapter === "codex") {
      const codexConfig = assertFile(
        path.join(context.homeRoot, ".codex", "config.toml"),
        "Codex adapter config"
      );
      const source = readFileSync(codexConfig, "utf8");
      if (
        !source.includes('command = "npx"') ||
        !source.includes('args = ["forge-memory", "mcp"]')
      ) {
        fail(
          "contract",
          "Codex config does not resolve through forge-memory mcp."
        );
      }
      runCaptured("npx", ["--no-install", "forge-memory", "--version"], {
        cwd: context.installRoot,
        env: isolatedEnvironment(context, {
          PATH: `${path.join(context.installRoot, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`
        }),
        timeoutMs: context.config.timeouts.commandMs,
        logPath: path.join(context.root, "codex-exact-resolution.log")
      });
    }
    const peopleTool = await callMcpPeopleTool({
      command: process.execPath,
      args: [cli, "mcp"],
      cwd: context.installRoot,
      env: isolatedEnvironment(context, {
        FORGE_API_TOKEN: people.token,
        FORGE_AGENT_PROVIDER: adapter,
        FORGE_ACTOR_LABEL: adapter
      }),
      displayName: people.displayName,
      logPath: path.join(context.root, `${adapter}-mcp.log`),
      timeoutMs: context.config.timeouts.runtimeMs
    });
    execution = {
      runtimeResolution: {
        kind:
          adapter === "codex"
            ? "codex_config_to_exact_forge_memory_mcp_to_openclaw_runtime"
            : "forge_memory_cli_to_exact_openclaw_runtime",
        packageName: "forge-memory",
        packageRoot: memoryRoot,
        runtimePackageName: "forge-openclaw-plugin",
        runtimePackageRoot: runtimeRoot,
        runtimeInstallRoot,
        codexRuntimeSnapshotRoot,
        codexRuntimeSnapshotExecuted: false,
        version: context.config.expectedVersion,
        targetArtifactRegistryFallbackAllowed: false,
        dependencyResolution: "package_declared_dependencies",
        ...staleRuntimeReplacement
      },
      health: {
        ok: true,
        backend: health.backend,
        storageRoot: health.runtime?.storageRoot
      },
      native: { ...admission, runtimeProbe: peer },
      person: {
        created: people.created,
        listed: people.listed,
        idPresent: typeof people.personId === "string"
      },
      peopleTool,
      cleanup: { allChildrenStopped: false, evidenceRootPreserved: true }
    };
  } catch (error) {
    executionError = error;
  }
  let stopError = null;
  try {
    runCaptured(process.execPath, [cli, "stop", "--json"], {
      cwd: context.installRoot,
      env: isolatedEnvironment(context),
      timeoutMs: context.config.timeouts.commandMs,
      logPath: path.join(context.root, `${adapter}-stop.log`)
    });
  } catch (error) {
    stopError = error;
  }
  const cleanup = await stopIsolatedManagedRuntimes(
    context.homeRoot,
    context.root,
    context.config.timeouts.stopMs
  );
  if (!cleanup.allStopped) {
    fail("cleanup", `${adapter} managed runtime did not stop.`);
  }
  if (stopError) throw stopError;
  if (executionError) throw executionError;
  execution.cleanup.allChildrenStopped = true;
  return execution;
}

async function defaultExecuteSurface(context, hooks) {
  if (context.surface === "openclaw") return executeOpenClaw(context, hooks);
  if (context.surface === "hermes") return executeHermes(context, hooks);
  if (context.surface === "codex") {
    return executeForgeMemoryAdapter(context, hooks, "codex");
  }
  return executeForgeMemoryAdapter(context, hooks, "forgeMemory");
}

export function assertCompleteSurfaceEvidence(surface, value) {
  const required = [
    value?.runtimeResolution?.version,
    value?.health?.ok,
    value?.native?.sourceVerified,
    value?.native?.signatureVerified,
    value?.native?.runtimeProbe?.healthy,
    value?.person?.created,
    value?.person?.listed,
    value?.peopleTool?.mcpExposedContract,
    value?.peopleTool?.returnedCreatedPerson,
    value?.cleanup?.allChildrenStopped,
    value?.cleanup?.evidenceRootPreserved,
    value?.runtimeResolution?.targetArtifactRegistryFallbackAllowed === false
  ];
  if (
    required[0] === undefined ||
    required.slice(1).some((entry) => entry !== true)
  ) {
    fail(
      "partial_evidence",
      `${surface} returned partial runtime evidence and cannot pass.`
    );
  }
  if (
    surface === "codex" &&
    (typeof value.runtimeResolution.codexRuntimeSnapshotRoot !== "string" ||
      value.runtimeResolution.codexRuntimeSnapshotExecuted !== false)
  ) {
    fail(
      "partial_evidence",
      "codex did not prove the installed runtime snapshot and adapter boundary."
    );
  }
  return value;
}

function createEvidenceRoot(config) {
  if (config.evidenceRoot) {
    if (existsSync(config.evidenceRoot)) {
      fail(
        "evidence_root",
        `Evidence root already exists and will not be overwritten: ${config.evidenceRoot}.`
      );
    }
    mkdirSync(config.evidenceRoot, { recursive: false, mode: 0o700 });
    return realpathSync(config.evidenceRoot);
  }
  const root = mkdtempSync(
    path.join(os.tmpdir(), "forge-people-packed-surfaces-")
  );
  chmodSync(root, 0o700);
  return root;
}

function machineResultBase(config, evidenceRoot) {
  return {
    schemaVersion: 1,
    kind: "forge-people-packed-surface-matrix",
    expectedVersion: config.expectedVersion,
    status: "running",
    evidenceRoot,
    protectedRootsChecked: config.protectedRoots,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    surfaces: {}
  };
}

export async function runPackedSurfaceMatrix(input, options = {}) {
  const config = validatePackedSurfaceConfig(structuredClone(input));
  const evidenceRoot = createEvidenceRoot(config);
  for (const directory of [
    "logs",
    "artifacts",
    "extracted",
    "inventories",
    "surfaces"
  ]) {
    mkdirSync(path.join(evidenceRoot, directory), {
      recursive: true,
      mode: 0o700
    });
  }
  const result = machineResultBase(config, evidenceRoot);
  const records = {};
  const hooks = {
    prepareNativeRuntime: options.prepareNativeRuntime ?? prepareNativeRuntime,
    probePeerGateway: options.probePeerGateway ?? probePeerGateway,
    executeSurface: options.executeSurface ?? defaultExecuteSurface
  };

  for (const surface of PEOPLE_PACKED_SURFACE_NAMES) {
    try {
      const resolved = await resolveArtifact(
        surface,
        config.artifacts[surface],
        evidenceRoot,
        config
      );
      const extracted = await extractArchive(
        surface,
        resolved.archivePath,
        evidenceRoot,
        config
      );
      const inspected = await inspectArtifact(surface, extracted, config);
      const carriedNative = inspected.nativeRoot
        ? await hooks.prepareNativeRuntime({
            nativeRoot: inspected.nativeRoot,
            expectedVersion: config.expectedVersion,
            trustedKeys: config.trustedKeys,
            evidenceRoot,
            timeoutMs: config.timeouts.commandMs
          })
        : null;
      if (
        inspected.nativeRoot &&
        (carriedNative?.sourceVerified !== true ||
          carriedNative?.signatureVerified !== true)
      ) {
        fail(
          "peer_admission",
          `${surface} did not prove its signed forge-peer source.`
        );
      }
      records[surface] = {
        surface,
        provenance: resolved.provenance,
        sourceRoot: resolved.sourceRoot,
        archive: extracted.archive,
        inventoryPath: extracted.inventoryPath,
        classification: inspected.classification,
        packageName: inspected.packageName,
        version: inspected.version,
        migrationRoots: inspected.migrationRoots,
        native: carriedNative,
        inspected
      };
      result.surfaces[surface] = {
        status: "artifact_verified",
        artifact: {
          ...extracted.archive,
          provenance: resolved.provenance,
          inventoryPath: extracted.inventoryPath
        },
        classification: inspected.classification,
        version: inspected.version,
        migrations: inspected.migrationRoots,
        carriedNative
      };
    } catch (error) {
      result.surfaces[surface] = {
        status: "failed",
        phase: "artifact",
        error: normalizeError(error)
      };
    }
  }

  const artifactFailures = PEOPLE_PACKED_SURFACE_NAMES.filter(
    (surface) => result.surfaces[surface]?.status === "failed"
  );
  if (artifactFailures.length === 0) {
    for (const surface of PEOPLE_PACKED_SURFACE_NAMES) {
      const context = makeSurfaceContext(
        surface,
        records,
        config,
        evidenceRoot
      );
      try {
        const execution = assertCompleteSurfaceEvidence(
          surface,
          await hooks.executeSurface(context, hooks)
        );
        assertVersion(
          execution.runtimeResolution.version,
          config.expectedVersion,
          `${surface} executed runtime`
        );
        result.surfaces[surface] = {
          ...result.surfaces[surface],
          status: "passed",
          execution
        };
      } catch (error) {
        result.surfaces[surface] = {
          ...result.surfaces[surface],
          status: "failed",
          phase: "execution",
          error: normalizeError(error)
        };
      }
    }
  }

  result.finishedAt = new Date().toISOString();
  const failures = PEOPLE_PACKED_SURFACE_NAMES.filter(
    (surface) => result.surfaces[surface]?.status !== "passed"
  );
  result.status = failures.length === 0 ? "passed" : "failed";
  result.failedSurfaces = failures;
  const evidencePath = path.join(evidenceRoot, "result.json");
  result.resultPath = evidencePath;
  writeJson(evidencePath, result);
  return result;
}

function parseCli(argv) {
  let configPath = null;
  let outputPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--config") configPath = argv[++index];
    else if (argument.startsWith("--config=")) configPath = argument.slice(9);
    else if (argument === "--output") outputPath = argv[++index];
    else if (argument.startsWith("--output=")) outputPath = argument.slice(9);
    else if (argument === "--help" || argument === "-h") {
      return { help: true, configPath: null, outputPath: null };
    } else {
      fail("configuration", `Unknown argument: ${argument}.`);
    }
  }
  if (!configPath)
    fail("configuration", "--config <absolute-json-path> is required.");
  return {
    help: false,
    configPath: resolveAbsolute(configPath, "--config"),
    outputPath: outputPath ? resolveAbsolute(outputPath, "--output") : null
  };
}

function printHelp() {
  process.stdout.write(
    `Usage:\n  node scripts/smoke/people-packed-surfaces.mjs --config /absolute/matrix.json [--output /absolute/result.json]\n\nThe config must provide exact OpenClaw, Hermes, Codex, and Forge Memory artifacts (or caller-supplied source roots), canonical People migration files 087/088/094/099/100, an expected version, and protected roots. Evidence is preserved.\n`
  );
}

async function main() {
  let cli;
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (error) {
    const result = {
      schemaVersion: 1,
      kind: "forge-people-packed-surface-matrix",
      status: "failed",
      error: normalizeError(error),
      evidenceRoot: null,
      surfaces: {}
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  if (cli.help) {
    printHelp();
    return;
  }
  let result;
  if (cli.outputPath && existsSync(cli.outputPath)) {
    result = {
      schemaVersion: 1,
      kind: "forge-people-packed-surface-matrix",
      status: "failed",
      error: normalizeError(
        new PackedSurfaceError(
          "output_exists",
          `Output path already exists and will not be overwritten: ${cli.outputPath}.`
        )
      ),
      evidenceRoot: null,
      surfaces: {}
    };
  } else {
    try {
      const config = readJson(cli.configPath, "Matrix config");
      result = await runPackedSurfaceMatrix(config);
    } catch (error) {
      result = {
        schemaVersion: 1,
        kind: "forge-people-packed-surface-matrix",
        status: "failed",
        error: normalizeError(error),
        evidenceRoot: null,
        surfaces: {}
      };
    }
  }
  if (cli.outputPath && !existsSync(cli.outputPath)) {
    writeJson(cli.outputPath, result);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  await main();
}
