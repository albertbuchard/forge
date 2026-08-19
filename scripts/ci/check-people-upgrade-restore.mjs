#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  truncateSync,
  writeFileSync,
  writeSync,
  closeSync
} from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const defaultRepoRoot = path.resolve(moduleDir, "..", "..");
export const HARNESS_MARKER_FILE = ".forge-people-upgrade-restore-harness.json";
export const HARNESS_MARKER_KIND = "forge-people-upgrade-restore-harness/v1";
export const EVIDENCE_ROOT_PREFIX = "forge-people-upgrade-restore-";
export const PEOPLE_MIGRATIONS = Object.freeze([
  "087_people_and_peer_sharing.sql",
  "088_people_peer_identity_hardening.sql",
  "094_people_peer_authorization_and_companion_v2.sql",
  "099_people_owner_partition_identity.sql",
  "100_people_read_model_revision.sql",
  "102_people_outbox_claim_order_indexes.sql"
]);
export const PRIOR_RELEASE_ARTIFACT = Object.freeze({
  packageName: "forge-openclaw-plugin",
  version: "0.3.32",
  packageSpec: "forge-openclaw-plugin@0.3.32",
  registry: "https://registry.npmjs.org/",
  registryIntegrity:
    "sha512-Pd0wgdkMq8iAn5Jj5eW4o3x5lDBRvkZancT77eb0AQ4vZv+G8cVxBiOJjygOsugwVheuQRd1eZJVYQvUqsJ+Mw==",
  tarballSha256:
    "cea8d2d64347650dca2cedeec505405887c64e2956e4cd85a05bf2cf60ceb971",
  tagCommit: "74a112ab66eb4e34bb2c7ffce8664d4c4ab08878",
  tarballUrl:
    "https://registry.npmjs.org/forge-openclaw-plugin/-/forge-openclaw-plugin-0.3.32.tgz",
  migrationCutoff: "085_artifact_store_search.sql",
  migrationCount: 86
});

const FIXTURE_TIMESTAMP = "2026-07-15T08:00:00.000Z";
const OPERATION_TIMESTAMP = "2026-07-16T10:00:00.000Z";
const OWNER_USER_ID = "user_people_upgrade_harness";
const DATABASE_FILE = "forge.sqlite";
const MAX_CHILD_OUTPUT_BYTES = 16 * 1024 * 1024;
let activeEvidenceRoot = null;

const REPEAT_UPGRADE_VOLATILE_COLUMNS = Object.freeze({
  questionnaire_instruments: Object.freeze(["created_at", "updated_at"]),
  questionnaire_versions: Object.freeze([
    "created_at",
    "updated_at",
    "published_at"
  ])
});

const INDEPENDENT_UPGRADE_VOLATILE_COLUMNS = Object.freeze({
  user_ownership_defaults: Object.freeze(["created_at", "updated_at"])
});

const PRIOR_RUNTIME_STARTUP_VOLATILE_COLUMNS = Object.freeze({
  user_access_grants: Object.freeze(["updated_at"]),
  users: Object.freeze(["updated_at"])
});

const LEGACY_PEOPLE_READ_MODEL_VOLATILE_COLUMNS = Object.freeze({
  people_read_model_revisions: Object.freeze(["updated_at"])
});

const EXPECTED_ADDITIVE_UPGRADE_ROWS = Object.freeze({
  questionnaire_instruments: Object.freeze({
    rowCount: 7,
    reason: "current built-in questionnaire instrument seeds"
  }),
  questionnaire_versions: Object.freeze({
    rowCount: 7,
    reason: "current built-in questionnaire version seeds"
  })
});

const EXPECTED_PREFERENCE_OWNERSHIP_BACKFILL_ROWS = Object.freeze({
  entity_owners: Object.freeze({
    rowCount: 2,
    reason:
      "migration 086 owner backfill for the pre-086 preference catalog and catalog item"
  })
});

const PRESERVATION_TABLES = Object.freeze([
  ["users", "identity"],
  ["goals", "planning"],
  ["projects", "planning"],
  ["tasks", "planning"],
  ["habits", "planning"],
  ["activity_events", "audit"],
  ["notes", "knowledge"],
  ["stored_secrets", "calendar"],
  ["calendar_connections", "calendar"],
  ["calendar_calendars", "calendar"],
  ["calendar_events", "calendar"],
  ["preference_profiles", "preferences"],
  ["preference_contexts", "preferences"],
  ["preference_items", "preferences"],
  ["preference_catalogs", "preferences"],
  ["preference_catalog_items", "preferences"],
  ["artifact_blobs", "artifacts"],
  ["artifacts", "artifacts"],
  ["life_events", "life-events"],
  ["movement_places", "movement"],
  ["movement_stays", "movement"],
  ["movement_trips", "movement"],
  ["health_sleep_sessions", "health"],
  ["health_workout_sessions", "health"],
  ["entity_links", "links"],
  ["entity_owners", "ownership"],
  ["people", "people"],
  ["person_aliases", "people"],
  ["person_contact_methods", "people"],
  ["person_facts", "people"],
  ["forge_principals", "peer"],
  ["forge_devices", "peer"],
  ["peer_relationships", "peer"],
  ["peer_relationship_devices", "peer"],
  ["peer_remote_records", "peer"],
  ["peer_command_journal", "peer"]
]);

const RELEASE_SCENARIOS = Object.freeze([
  Object.freeze({
    id: "released-v0.3.32-085",
    cutoff: PRIOR_RELEASE_ARTIFACT.migrationCutoff,
    fixtureScale: "release",
    legacyPeople: false,
    baselineKind: "exact_prior_runtime",
    expectQuestionnaireSeedAdditions: false,
    expectVolatileQuestionnaireSeedTimestamps: false,
    expectPreferenceOwnershipBackfill: true
  }),
  Object.freeze({
    id: "legacy-people-087",
    cutoff: "087_people_and_peer_sharing.sql",
    fixtureScale: "release",
    legacyPeople: true,
    baselineKind: "synthetic_quarantine_only",
    expectQuestionnaireSeedAdditions: true,
    expectVolatileQuestionnaireSeedTimestamps: true,
    expectPreferenceOwnershipBackfill: false
  })
]);

const FOCUSED_SCENARIOS = Object.freeze([
  Object.freeze({
    id: "focused-pre-people-085",
    cutoff: PRIOR_RELEASE_ARTIFACT.migrationCutoff,
    fixtureScale: "focused",
    legacyPeople: false,
    baselineKind: "focused_synthetic_fixture",
    expectQuestionnaireSeedAdditions: true,
    expectVolatileQuestionnaireSeedTimestamps: true,
    expectPreferenceOwnershipBackfill: false
  })
]);

class HarnessError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "HarnessError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new HarnessError(code, message, details);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha512Sri(value) {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

export function verifyPriorReleaseArtifactBytes(
  bytes,
  expected = PRIOR_RELEASE_ARTIFACT
) {
  if (!bytes || !Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
    fail(
      "prior_artifact_missing",
      "The exact prior-release tarball is missing or empty."
    );
  }
  const actualSha256 = sha256(bytes);
  const actualIntegrity = sha512Sri(bytes);
  if (actualSha256 !== expected.tarballSha256) {
    fail(
      "prior_artifact_sha256_mismatch",
      "The prior-release tarball SHA-256 does not match the pinned artifact.",
      { expected: expected.tarballSha256, actual: actualSha256 }
    );
  }
  if (actualIntegrity !== expected.registryIntegrity) {
    fail(
      "prior_artifact_integrity_mismatch",
      "The prior-release tarball SHA-512 integrity does not match the registry pin.",
      { expected: expected.registryIntegrity, actual: actualIntegrity }
    );
  }
  return {
    byteSize: bytes.byteLength,
    tarballSha256: actualSha256,
    registryIntegrity: actualIntegrity
  };
}

export function verifyPriorReleaseRegistryMetadata(
  metadata,
  expected = PRIOR_RELEASE_ARTIFACT
) {
  if (!metadata || typeof metadata !== "object") {
    fail(
      "prior_artifact_registry_metadata_missing",
      "Pinned prior-release registry metadata is missing."
    );
  }
  const integrity = metadata["dist.integrity"] ?? metadata.dist?.integrity;
  const tarballUrl = metadata["dist.tarball"] ?? metadata.dist?.tarball;
  const checks = [
    ["name", metadata.name, expected.packageName],
    ["version", metadata.version, expected.version],
    ["gitHead", metadata.gitHead, expected.tagCommit],
    ["dist.integrity", integrity, expected.registryIntegrity],
    ["dist.tarball", tarballUrl, expected.tarballUrl]
  ];
  const mismatch = checks.find(([, actual, pinned]) => actual !== pinned);
  if (mismatch) {
    const [field, actual, pinned] = mismatch;
    fail(
      "prior_artifact_registry_metadata_mismatch",
      `Registry metadata ${field} does not match the pinned prior release.`,
      { field, expected: pinned, actual }
    );
  }
  return {
    packageName: metadata.name,
    version: metadata.version,
    tagCommit: metadata.gitHead,
    registryIntegrity: integrity,
    tarballUrl
  };
}

function stableJson(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { $blobBase64: Buffer.from(value).toString("base64") };
  }
  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }
  if (Array.isArray(value)) {
    return value.map(stableJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, nested]) => [key, stableJson(nested)])
    );
  }
  return value;
}

function stableSerialize(value) {
  return JSON.stringify(stableJson(value));
}

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    fail("unsafe_sql_identifier", `Unsafe SQLite identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function resolveThroughExistingParent(inputPath) {
  let cursor = path.resolve(inputPath);
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const base = existsSync(cursor) ? realpathSync(cursor) : path.resolve(cursor);
  return path.resolve(base, ...suffix);
}

function parseJsonDataRoot(filePath, selector) {
  if (!existsSync(filePath)) return null;
  try {
    const value = selector(JSON.parse(readFileSync(filePath, "utf8")));
    return typeof value === "string" && value.trim()
      ? path.resolve(value.trim())
      : null;
  } catch {
    return null;
  }
}

export function discoverProtectedRoots({
  repoRoot = defaultRepoRoot,
  env = process.env,
  homeDir = os.homedir()
} = {}) {
  const monorepoRoot = path.resolve(repoRoot, "..", "..");
  const roots = [
    { label: "Forge source checkout", root: repoRoot },
    {
      label: "monorepo Forge data default",
      root: path.join(monorepoRoot, "data", "forge")
    },
    {
      label: "monorepo private Forge backups",
      root: path.join(monorepoRoot, "private", "forge-backups")
    },
    { label: "user Forge data default", root: path.join(homeDir, ".forge") },
    {
      label: "OpenClaw Forge runtime",
      root: path.join(homeDir, ".openclaw", "forge")
    },
    {
      label: "OpenClaw Forge extension",
      root: path.join(
        homeDir,
        ".openclaw",
        "extensions",
        "forge-openclaw-plugin"
      )
    },
    {
      label: "Hermes Forge runtime",
      root: path.join(homeDir, ".hermes", "forge")
    },
    {
      label: "XDG Forge data default",
      root: path.join(homeDir, ".local", "share", "forge")
    },
    {
      label: "macOS Forge application support",
      root: path.join(homeDir, "Library", "Application Support", "Forge")
    }
  ];
  if (env.FORGE_DATA_ROOT?.trim()) {
    roots.push({
      label: "FORGE_DATA_ROOT",
      root: path.resolve(env.FORGE_DATA_ROOT.trim())
    });
  }
  for (const configuredRoot of (env.FORGE_PROTECTED_DATA_ROOTS ?? "").split(
    path.delimiter
  )) {
    if (configuredRoot.trim()) {
      roots.push({
        label: "FORGE_PROTECTED_DATA_ROOTS",
        root: path.resolve(configuredRoot.trim())
      });
    }
  }

  const configuredRoots = [
    {
      label: "monorepo runtime preference",
      value: parseJsonDataRoot(
        path.join(monorepoRoot, "data", "forge-runtime.json"),
        (payload) => payload?.dataRoot
      )
    },
    {
      label: "OpenClaw Forge plugin data root",
      value: parseJsonDataRoot(
        path.join(homeDir, ".openclaw", "openclaw.json"),
        (payload) =>
          payload?.plugins?.entries?.["forge-openclaw-plugin"]?.config?.dataRoot
      )
    },
    {
      label: "Hermes Forge data root",
      value: parseJsonDataRoot(
        path.join(homeDir, ".hermes", "forge", "config.json"),
        (payload) => payload?.dataRoot
      )
    }
  ];
  for (const configured of configuredRoots) {
    if (configured.value) {
      roots.push({ label: configured.label, root: configured.value });
    }
  }

  const deduplicated = new Map();
  for (const entry of roots) {
    const resolved = resolveThroughExistingParent(entry.root);
    const current = deduplicated.get(resolved);
    if (current) {
      current.labels.push(entry.label);
    } else {
      deduplicated.set(resolved, { root: resolved, labels: [entry.label] });
    }
  }
  return [...deduplicated.values()].sort((left, right) =>
    left.root.localeCompare(right.root, "en")
  );
}

function assertNotProtected(candidate, protectedRoots) {
  for (const protectedRoot of protectedRoots) {
    if (
      isWithin(protectedRoot.root, candidate) ||
      isWithin(candidate, protectedRoot.root)
    ) {
      fail(
        "protected_data_root",
        `Evidence root overlaps ${protectedRoot.labels.join(" / ")}; refusing without inspecting it.`
      );
    }
  }
}

export function assertOutputPathAllowed(outputPath, protectedRoots) {
  const resolvedOutput = resolveThroughExistingParent(outputPath);
  assertNotProtected(resolvedOutput, protectedRoots);
  return resolvedOutput;
}

export async function createHarnessEvidenceRoot({
  requestedRoot,
  repoRoot = defaultRepoRoot,
  env = process.env,
  homeDir = os.homedir(),
  tempDir = os.tmpdir()
} = {}) {
  const protectedRoots = discoverProtectedRoots({ repoRoot, env, homeDir });
  const canonicalTemp = resolveThroughExistingParent(tempDir);
  let evidenceRoot;

  if (requestedRoot) {
    evidenceRoot = resolveThroughExistingParent(requestedRoot);
    if (
      !isWithin(canonicalTemp, evidenceRoot) ||
      evidenceRoot === canonicalTemp
    ) {
      fail(
        "evidence_root_not_temporary",
        `Evidence roots must be fresh children of the OS temp directory (${canonicalTemp}).`
      );
    }
    if (!path.basename(evidenceRoot).startsWith(EVIDENCE_ROOT_PREFIX)) {
      fail(
        "evidence_root_name_invalid",
        `Evidence root names must start with ${EVIDENCE_ROOT_PREFIX}.`
      );
    }
    assertNotProtected(evidenceRoot, protectedRoots);
    if (existsSync(evidenceRoot)) {
      fail(
        "evidence_root_exists",
        "The requested evidence root already exists; refusing to inspect or reuse it."
      );
    }
    mkdirSync(evidenceRoot, { mode: 0o700 });
  } else {
    evidenceRoot = await mkdtemp(
      path.join(canonicalTemp, EVIDENCE_ROOT_PREFIX)
    );
    assertNotProtected(evidenceRoot, protectedRoots);
  }

  const marker = {
    kind: HARNESS_MARKER_KIND,
    root: evidenceRoot,
    createdAt: new Date().toISOString(),
    canonicalDataAccess: "forbidden"
  };
  writeFileSync(
    path.join(evidenceRoot, HARNESS_MARKER_FILE),
    `${JSON.stringify(marker, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 }
  );
  assertHarnessRoot(evidenceRoot, { tempDir });
  activeEvidenceRoot = evidenceRoot;
  return {
    evidenceRoot,
    protectedRootLabels: protectedRoots.flatMap((entry) => entry.labels),
    protectedRoots
  };
}

export function assertHarnessRoot(
  evidenceRoot,
  { tempDir = os.tmpdir() } = {}
) {
  const resolvedRoot = resolveThroughExistingParent(evidenceRoot);
  const canonicalTemp = resolveThroughExistingParent(tempDir);
  if (
    !isWithin(canonicalTemp, resolvedRoot) ||
    resolvedRoot === canonicalTemp
  ) {
    fail(
      "unmarked_or_unsafe_root",
      "Harness root is outside the OS temp directory."
    );
  }
  const rootMetadata = lstatSync(resolvedRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    fail("unmarked_or_unsafe_root", "Harness root must be a real directory.");
  }
  const markerPath = path.join(resolvedRoot, HARNESS_MARKER_FILE);
  if (!existsSync(markerPath)) {
    fail("harness_marker_missing", "Harness-created root marker is missing.");
  }
  const markerMetadata = lstatSync(markerPath);
  if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink()) {
    fail(
      "harness_marker_invalid",
      "Harness root marker must be a regular file."
    );
  }
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    fail("harness_marker_invalid", "Harness root marker is not valid JSON.");
  }
  if (
    marker?.kind !== HARNESS_MARKER_KIND ||
    resolveThroughExistingParent(marker?.root ?? "") !== resolvedRoot ||
    marker?.canonicalDataAccess !== "forbidden"
  ) {
    fail(
      "harness_marker_invalid",
      "Harness root marker does not match this root."
    );
  }
  return resolvedRoot;
}

export function assertHarnessPath(evidenceRoot, candidatePath) {
  const root = assertHarnessRoot(evidenceRoot);
  const candidate = resolveThroughExistingParent(candidatePath);
  if (candidate === root || !isWithin(root, candidate)) {
    fail("path_outside_harness", "Path is outside the marked harness root.");
  }
  return candidate;
}

function assertFreshPath(evidenceRoot, candidatePath) {
  const candidate = assertHarnessPath(evidenceRoot, candidatePath);
  if (existsSync(candidate)) {
    fail(
      "destination_exists",
      `Refusing to overwrite existing harness path: ${candidate}`
    );
  }
  return candidate;
}

function runEvidenceCommand({
  evidenceRoot,
  cwd,
  command,
  args,
  env,
  label,
  logDirectory,
  timeout = 120_000
}) {
  const safeCwd = assertHarnessPath(evidenceRoot, cwd);
  const safeLogDirectory = assertHarnessPath(evidenceRoot, logDirectory);
  mkdirSync(safeCwd, { recursive: true, mode: 0o700 });
  mkdirSync(safeLogDirectory, { recursive: true, mode: 0o700 });
  const result = spawnSync(command, args, {
    cwd: safeCwd,
    env,
    encoding: "utf8",
    maxBuffer: MAX_CHILD_OUTPUT_BYTES,
    timeout
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  writeChildLog(
    evidenceRoot,
    path.join(safeLogDirectory, `${label}.stdout.log`),
    stdout
  );
  writeChildLog(
    evidenceRoot,
    path.join(safeLogDirectory, `${label}.stderr.log`),
    stderr
  );
  if (result.error) {
    fail("evidence_command_failed", `${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail("evidence_command_failed", `${label} exited ${result.status}.`, {
      command,
      status: result.status,
      signal: result.signal ?? null,
      stderr: stderr.slice(-4000)
    });
  }
  return { stdout, stderr };
}

function isolatedNpmEnvironment(evidenceRoot, artifactRoot) {
  const home = assertHarnessPath(evidenceRoot, path.join(artifactRoot, "home"));
  const temp = assertHarnessPath(evidenceRoot, path.join(artifactRoot, "temp"));
  const cache = assertHarnessPath(
    evidenceRoot,
    path.join(artifactRoot, "npm-cache")
  );
  const prefix = assertHarnessPath(
    evidenceRoot,
    path.join(artifactRoot, "npm-prefix")
  );
  const config = assertHarnessPath(
    evidenceRoot,
    path.join(artifactRoot, "npmrc")
  );
  const globalConfig = assertHarnessPath(
    evidenceRoot,
    path.join(artifactRoot, "npm-globalrc")
  );
  for (const directory of [home, temp, cache, prefix]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  for (const filePath of [config, globalConfig]) {
    writeFileSync(
      assertFreshPath(evidenceRoot, filePath),
      [
        `registry=${PRIOR_RELEASE_ARTIFACT.registry}`,
        "ignore-scripts=true",
        "audit=false",
        "fund=false",
        "package-lock=true",
        "always-auth=false",
        ""
      ].join("\n"),
      { encoding: "utf8", flag: "wx", mode: 0o600 }
    );
  }
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase().startsWith("npm_config_")) delete environment[key];
  }
  Object.assign(environment, {
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    NPM_CONFIG_CACHE: cache,
    NPM_CONFIG_PREFIX: prefix,
    NPM_CONFIG_USERCONFIG: config,
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    NPM_CONFIG_REGISTRY: PRIOR_RELEASE_ARTIFACT.registry,
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_ALWAYS_AUTH: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    TZ: "UTC"
  });
  for (const key of [
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_AUTH_TOKEN",
    "NPM_TOKEN"
  ]) {
    delete environment[key];
  }
  return environment;
}

function parseJsonCommandOutput(label, stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    fail("evidence_json_invalid", `${label} did not emit valid JSON.`, {
      error: error.message,
      outputTail: stdout.slice(-2000)
    });
  }
}

function validateTarEntries(entries) {
  if (entries.length === 0) {
    fail("prior_artifact_archive_empty", "The pinned prior artifact is empty.");
  }
  const seen = new Set();
  for (const rawEntry of entries) {
    const entry = rawEntry.endsWith("/") ? rawEntry.slice(0, -1) : rawEntry;
    if (!entry || (entry !== "package" && !entry.startsWith("package/"))) {
      fail(
        "prior_artifact_archive_path_invalid",
        `Archive entry is outside package/: ${rawEntry}`
      );
    }
    const segments = entry.split("/");
    if (
      path.posix.isAbsolute(entry) ||
      segments.some(
        (segment) => segment === "" || segment === "." || segment === ".."
      ) ||
      path.posix.normalize(entry) !== entry
    ) {
      fail(
        "prior_artifact_archive_path_invalid",
        `Archive entry is unsafe: ${rawEntry}`
      );
    }
    if (seen.has(entry)) {
      fail(
        "prior_artifact_archive_duplicate",
        `Archive entry is duplicated: ${rawEntry}`
      );
    }
    seen.add(entry);
  }
  return { entryCount: entries.length };
}

function collectRegularFileManifest(root, { exclude = () => false } = {}) {
  const rootMetadata = lstatSync(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    fail(
      "prior_artifact_extraction_invalid",
      "Extracted package root must be a real directory."
    );
  }
  const entries = [];
  const walk = (directory) => {
    for (const dirent of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name, "en")
    )) {
      const absolutePath = path.join(directory, dirent.name);
      const relativePath = path
        .relative(root, absolutePath)
        .split(path.sep)
        .join("/");
      const metadata = lstatSync(absolutePath);
      if (
        metadata.isSymbolicLink() ||
        (!metadata.isDirectory() && !metadata.isFile())
      ) {
        fail(
          "prior_artifact_extraction_invalid",
          `Extracted package contains a non-regular entry: ${relativePath}`
        );
      }
      if (exclude(relativePath, metadata)) continue;
      if (metadata.isDirectory()) {
        walk(absolutePath);
      } else {
        const bytes = readFileSync(absolutePath);
        entries.push({
          path: relativePath,
          byteSize: bytes.byteLength,
          sha256: sha256(bytes)
        });
      }
    }
  };
  walk(root);
  return {
    fileCount: entries.length,
    totalByteSize: entries.reduce((sum, entry) => sum + entry.byteSize, 0),
    manifestSha256: sha256(stableSerialize(entries)),
    entries
  };
}

function extractVerifiedPriorArtifact({
  evidenceRoot,
  artifactRoot,
  tarballPath,
  destination,
  environment,
  label,
  logDirectory
}) {
  const safeDestination = assertFreshPath(evidenceRoot, destination);
  mkdirSync(safeDestination, { recursive: true, mode: 0o700 });
  runEvidenceCommand({
    evidenceRoot,
    cwd: artifactRoot,
    command: "tar",
    args: [
      "-xzf",
      tarballPath,
      "-C",
      safeDestination,
      "--strip-components=1",
      "--no-same-owner"
    ],
    env: environment,
    label,
    logDirectory
  });
  return collectRegularFileManifest(safeDestination);
}

async function acquirePriorReleaseArtifact({ evidenceRoot }) {
  const artifactRoot = assertFreshPath(
    evidenceRoot,
    path.join(evidenceRoot, "prior-release-artifact")
  );
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const acquiredDirectory = path.join(artifactRoot, "acquired");
  const pristinePackagePath = path.join(artifactRoot, "package-pristine");
  const runtimePackagePath = path.join(artifactRoot, "package-runtime");
  const logDirectory = path.join(artifactRoot, "logs");
  for (const directory of [acquiredDirectory, logDirectory]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const environment = isolatedNpmEnvironment(evidenceRoot, artifactRoot);
  const metadataResult = runEvidenceCommand({
    evidenceRoot,
    cwd: artifactRoot,
    command: "npm",
    args: [
      "view",
      PRIOR_RELEASE_ARTIFACT.packageSpec,
      "name",
      "version",
      "gitHead",
      "dist.integrity",
      "dist.tarball",
      "--json",
      `--registry=${PRIOR_RELEASE_ARTIFACT.registry}`
    ],
    env: environment,
    label: "npm-view-pinned-release",
    logDirectory,
    timeout: 60_000
  });
  const registry = verifyPriorReleaseRegistryMetadata(
    parseJsonCommandOutput("npm view", metadataResult.stdout)
  );
  const packResult = runEvidenceCommand({
    evidenceRoot,
    cwd: artifactRoot,
    command: "npm",
    args: [
      "pack",
      PRIOR_RELEASE_ARTIFACT.packageSpec,
      "--ignore-scripts",
      "--json",
      `--registry=${PRIOR_RELEASE_ARTIFACT.registry}`,
      `--pack-destination=${acquiredDirectory}`
    ],
    env: environment,
    label: "npm-pack-pinned-release",
    logDirectory,
    timeout: 120_000
  });
  const packEntries = parseJsonCommandOutput("npm pack", packResult.stdout);
  if (!Array.isArray(packEntries) || packEntries.length !== 1) {
    fail(
      "prior_artifact_pack_result_invalid",
      "npm pack did not return exactly one pinned package."
    );
  }
  const packed = packEntries[0];
  if (
    packed?.name !== PRIOR_RELEASE_ARTIFACT.packageName ||
    packed?.version !== PRIOR_RELEASE_ARTIFACT.version ||
    packed?.integrity !== PRIOR_RELEASE_ARTIFACT.registryIntegrity ||
    typeof packed?.filename !== "string" ||
    path.basename(packed.filename) !== packed.filename
  ) {
    fail(
      "prior_artifact_pack_result_invalid",
      "npm pack metadata does not match the pinned prior release.",
      packed
    );
  }
  const tarballPath = assertHarnessPath(
    evidenceRoot,
    path.join(acquiredDirectory, packed.filename)
  );
  const acquiredFiles = readdirSync(acquiredDirectory);
  if (
    acquiredFiles.length !== 1 ||
    acquiredFiles[0] !== packed.filename ||
    !lstatSync(tarballPath).isFile() ||
    lstatSync(tarballPath).isSymbolicLink()
  ) {
    fail(
      "prior_artifact_acquisition_ambiguous",
      "Pinned acquisition directory does not contain exactly one regular tarball."
    );
  }
  const artifactBytes = verifyPriorReleaseArtifactBytes(
    readFileSync(tarballPath)
  );
  const listResult = runEvidenceCommand({
    evidenceRoot,
    cwd: artifactRoot,
    command: "tar",
    args: ["-tzf", tarballPath],
    env: environment,
    label: "tar-list-pinned-release",
    logDirectory
  });
  const archiveEntries = listResult.stdout
    .split(/\r?\n/u)
    .filter((entry) => entry.length > 0);
  const archive = validateTarEntries(archiveEntries);
  const verboseList = runEvidenceCommand({
    evidenceRoot,
    cwd: artifactRoot,
    command: "tar",
    args: ["-tvzf", tarballPath],
    env: environment,
    label: "tar-types-pinned-release",
    logDirectory
  });
  const unsafeType = verboseList.stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .find((line) => !new Set(["-", "d"]).has(line[0]));
  if (unsafeType) {
    fail(
      "prior_artifact_archive_type_invalid",
      "Pinned artifact contains a link or special archive entry.",
      { entry: unsafeType }
    );
  }

  const pristineManifest = extractVerifiedPriorArtifact({
    evidenceRoot,
    artifactRoot,
    tarballPath,
    destination: pristinePackagePath,
    environment,
    label: "extract-pristine-pinned-release",
    logDirectory
  });
  const runtimeBeforeInstall = extractVerifiedPriorArtifact({
    evidenceRoot,
    artifactRoot,
    tarballPath,
    destination: runtimePackagePath,
    environment,
    label: "extract-runtime-pinned-release",
    logDirectory
  });
  if (
    pristineManifest.manifestSha256 !== runtimeBeforeInstall.manifestSha256 ||
    pristineManifest.fileCount !== runtimeBeforeInstall.fileCount
  ) {
    fail(
      "prior_artifact_extraction_mismatch",
      "Independent pinned artifact extractions differ."
    );
  }
  const packageJsonPath = path.join(pristinePackagePath, "package.json");
  const packageJson = parseJsonCommandOutput(
    "prior package.json",
    readFileSync(packageJsonPath, "utf8")
  );
  if (
    packageJson.name !== PRIOR_RELEASE_ARTIFACT.packageName ||
    packageJson.version !== PRIOR_RELEASE_ARTIFACT.version
  ) {
    fail(
      "prior_artifact_package_identity_mismatch",
      "Extracted package identity does not match the pinned release."
    );
  }
  if (
    existsSync(path.join(pristinePackagePath, "package-lock.json")) ||
    existsSync(path.join(pristinePackagePath, "npm-shrinkwrap.json"))
  ) {
    fail(
      "prior_artifact_unexpected_dependency_lock",
      "The pinned package unexpectedly contains a dependency lockfile."
    );
  }
  const migrationsDirectory = path.join(
    pristinePackagePath,
    "server",
    "migrations"
  );
  const migrationEntries = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const bytes = readFileSync(path.join(migrationsDirectory, name));
      return { name, byteSize: bytes.byteLength, sha256: sha256(bytes) };
    });
  if (
    migrationEntries.length !== PRIOR_RELEASE_ARTIFACT.migrationCount ||
    migrationEntries.at(-1)?.name !== PRIOR_RELEASE_ARTIFACT.migrationCutoff
  ) {
    fail(
      "prior_artifact_migration_contract_mismatch",
      "Pinned prior package does not contain the expected migration chain.",
      {
        expectedCount: PRIOR_RELEASE_ARTIFACT.migrationCount,
        actualCount: migrationEntries.length,
        expectedLast: PRIOR_RELEASE_ARTIFACT.migrationCutoff,
        actualLast: migrationEntries.at(-1)?.name ?? null
      }
    );
  }

  runEvidenceCommand({
    evidenceRoot,
    cwd: runtimePackagePath,
    command: "npm",
    args: [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--package-lock=true",
      "--no-audit",
      "--no-fund",
      `--registry=${PRIOR_RELEASE_ARTIFACT.registry}`
    ],
    env: environment,
    label: "npm-install-pinned-runtime-dependencies",
    logDirectory,
    timeout: 300_000
  });
  const generatedLockPath = path.join(runtimePackagePath, "package-lock.json");
  if (!existsSync(generatedLockPath)) {
    fail(
      "prior_artifact_dependency_lock_missing",
      "Pinned runtime dependency resolution did not produce an evidence lockfile."
    );
  }
  const generatedLockBytes = readFileSync(generatedLockPath);
  const generatedLock = parseJsonCommandOutput(
    "generated package-lock.json",
    generatedLockBytes.toString("utf8")
  );
  const runtimeSourceManifest = collectRegularFileManifest(runtimePackagePath, {
    exclude: (relativePath) =>
      relativePath === "package-lock.json" ||
      relativePath === "node_modules" ||
      relativePath.startsWith("node_modules/")
  });
  if (
    runtimeSourceManifest.fileCount !== pristineManifest.fileCount ||
    runtimeSourceManifest.manifestSha256 !== pristineManifest.manifestSha256
  ) {
    fail(
      "prior_artifact_source_modified_by_install",
      "Dependency installation changed the pinned package source."
    );
  }
  const lifecycleScriptNames = [
    "preinstall",
    "install",
    "postinstall",
    "prepare",
    "prepack",
    "postpack"
  ].filter((name) => typeof packageJson.scripts?.[name] === "string");
  return {
    runtimePackagePath,
    migrationEntries,
    report: {
      status: "verified",
      package: {
        name: PRIOR_RELEASE_ARTIFACT.packageName,
        version: PRIOR_RELEASE_ARTIFACT.version,
        packageSpec: PRIOR_RELEASE_ARTIFACT.packageSpec,
        tagCommit: PRIOR_RELEASE_ARTIFACT.tagCommit
      },
      registry,
      artifact: {
        ...artifactBytes,
        path: path.relative(evidenceRoot, tarballPath),
        archiveEntryCount: archive.entryCount,
        npmPackFileCount: packed.entryCount ?? packed.files?.length ?? null
      },
      packageSource: {
        path: path.relative(evidenceRoot, pristinePackagePath),
        fileCount: pristineManifest.fileCount,
        totalByteSize: pristineManifest.totalByteSize,
        manifestSha256: pristineManifest.manifestSha256
      },
      migrations: {
        migrationCount: migrationEntries.length,
        firstMigration: migrationEntries[0].name,
        lastMigration: migrationEntries.at(-1).name,
        manifestSha256: sha256(stableSerialize(migrationEntries))
      },
      dependencyResolution: {
        lifecycleScriptsDisabled: true,
        packageLifecycleScriptsPresent: lifecycleScriptNames,
        lockfileGeneratedInsideEvidenceRoot: true,
        generatedLockfileSha256: sha256(generatedLockBytes),
        lockfileVersion: generatedLock.lockfileVersion ?? null,
        resolvedPackageCount:
          generatedLock.packages && typeof generatedLock.packages === "object"
            ? Object.keys(generatedLock.packages).length
            : null,
        historicalLockAvailable: false,
        caveat:
          "The exact published tarball and runtime source are pinned. Version 0.3.32 did not publish a lockfile, so npm resolved current production dependencies allowed by its published semver ranges with all lifecycle scripts disabled; this is not a claim of the historical dependency graph."
      },
      logs: path.relative(evidenceRoot, logDirectory)
    }
  };
}

export function readMigrationSourceManifest(repoRoot = defaultRepoRoot) {
  const migrationsDir = path.join(repoRoot, "apps", "api", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    fail("migration_chain_empty", "No canonical Forge migrations were found.");
  }
  const entries = files.map((name) => {
    const filePath = path.join(migrationsDir, name);
    const metadata = lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(
        "migration_source_invalid",
        `${name} is not a regular migration file.`
      );
    }
    const content = readFileSync(filePath);
    return { name, byteSize: content.byteLength, sha256: sha256(content) };
  });
  for (const required of PEOPLE_MIGRATIONS) {
    if (!entries.some((entry) => entry.name === required)) {
      fail(
        "people_migration_missing",
        `Required People migration is missing: ${required}`
      );
    }
  }
  return {
    migrationCount: entries.length,
    firstMigration: entries[0].name,
    lastMigration: entries.at(-1).name,
    manifestSha256: sha256(stableSerialize(entries)),
    entries
  };
}

function assertMigrationManifestUnchanged(expected, repoRoot) {
  const current = readMigrationSourceManifest(repoRoot);
  if (current.manifestSha256 !== expected.manifestSha256) {
    fail(
      "migration_source_changed",
      "Canonical migrations changed while the evidence run was active.",
      { expected: expected.manifestSha256, actual: current.manifestSha256 }
    );
  }
}

function execute(db, sql, parameters = []) {
  db.prepare(sql).run(...parameters);
}

function seedOwner(db, entityType, entityId) {
  execute(
    db,
    `INSERT INTO entity_owners (
       entity_type, entity_id, user_id, role, created_at, updated_at
     ) VALUES (?, ?, ?, 'owner', ?, ?)`,
    [entityType, entityId, OWNER_USER_ID, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
}

function seedBaseFixture(
  db,
  fixtureScale,
  { seedPreferenceCatalogOwners = true } = {}
) {
  execute(
    db,
    `INSERT INTO users (
       id, kind, handle, display_name, description, accent_color, created_at, updated_at
     ) VALUES (?, 'human', 'people_upgrade_harness', 'People Upgrade Harness',
               'Isolated deterministic verification owner.', '#3b82f6', ?, ?)`,
    [OWNER_USER_ID, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO goals (
       id, title, description, horizon, status, target_points, theme_color,
       created_at, updated_at
     ) VALUES ('goal_upgrade_fixture', 'Preserve the migration fixture',
               'Sentinel planning record.', 'year', 'active', 1000, '#2563eb', ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO projects (
       id, goal_id, title, description, status, theme_color, target_points,
       created_at, updated_at
     ) VALUES ('project_upgrade_fixture', 'goal_upgrade_fixture',
               'Upgrade verification', 'Sentinel project.', 'active', '#0f766e',
               500, ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO tasks (
       id, title, description, status, priority, owner, goal_id, project_id,
       due_date, effort, energy, points, sort_order, completed_at, created_at, updated_at
     ) VALUES ('task_upgrade_fixture', 'Keep this exact task', 'Sentinel task.',
               'backlog', 'high', 'People Upgrade Harness', 'goal_upgrade_fixture',
               'project_upgrade_fixture', '2026-08-01', 'medium', 'medium', 80,
               10, NULL, ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO notes (
       id, content_markdown, content_plain, author, source, tags_json, kind,
       title, slug, space_id, aliases_json, summary, frontmatter_json,
       revision_hash, created_at, updated_at
     ) VALUES ('note_upgrade_fixture', '# Upgrade evidence\nPreserve this note.',
               'Upgrade evidence Preserve this note.', 'Harness', 'ui',
               '["upgrade","people"]', 'wiki_page', 'Upgrade evidence',
               'upgrade-evidence', 'verification', '[]', 'Sentinel wiki record.',
               '{}', ?, ?, ?)`,
    ["d".repeat(64), FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO activity_events (
       id, entity_type, entity_id, event_type, title, description, actor,
       source, metadata_json, created_at
     ) VALUES ('activity_upgrade_fixture', 'task', 'task_upgrade_fixture',
               'created', 'Fixture created', 'Audit sentinel.', 'Harness', 'system',
               '{"fixture":true}', ?)`,
    [FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO entity_links (
       source_entity_type, source_entity_id, target_entity_type, target_entity_id,
       anchor_key, relationship, created_by_actor, created_at
     ) VALUES
       ('task', 'task_upgrade_fixture', 'goal', 'goal_upgrade_fixture', '',
        'supports', 'Harness', ?),
       ('note', 'note_upgrade_fixture', 'project', 'project_upgrade_fixture',
        'upgrade-context', 'documents', 'Harness', ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  for (const [type, id] of [
    ["goal", "goal_upgrade_fixture"],
    ["project", "project_upgrade_fixture"],
    ["task", "task_upgrade_fixture"],
    ["note", "note_upgrade_fixture"]
  ]) {
    seedOwner(db, type, id);
  }

  if (fixtureScale !== "release") return;

  execute(
    db,
    `INSERT INTO habits (
       id, title, description, status, polarity, frequency, target_count,
       week_days_json, reward_xp, penalty_xp, created_at, updated_at
     ) VALUES ('habit_upgrade_fixture', 'Preserve fixture habit', 'Habit sentinel.',
               'active', 'positive', 'daily', 1, '[]', 12, 8, ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  seedOwner(db, "habit", "habit_upgrade_fixture");

  execute(
    db,
    `INSERT INTO stored_secrets (id, cipher_text, description, created_at, updated_at)
     VALUES ('secret_upgrade_fixture', 'fixture-ciphertext', 'Calendar fixture', ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO calendar_connections (
       id, provider, label, account_label, status, config_json,
       credentials_secret_id, created_at, updated_at
     ) VALUES ('calendar_connection_upgrade_fixture', 'caldav', 'Fixture calendar',
               'fixture@example.invalid', 'connected', '{}',
               'secret_upgrade_fixture', ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO entity_owners (
       entity_type, entity_id, user_id, role, created_at, updated_at
     ) VALUES ('calendar_connection', 'calendar_connection_upgrade_fixture',
               'user_operator', 'owner', ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO calendar_calendars (
       id, connection_id, remote_id, title, description, color, timezone,
       is_primary, can_write, forge_managed, created_at, updated_at
     ) VALUES ('calendar_upgrade_fixture', 'calendar_connection_upgrade_fixture',
               'remote-calendar-fixture', 'Fixture calendar', 'Calendar sentinel.',
               '#0284c7', 'Europe/Zurich', 1, 1, 0, ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO calendar_events (
       id, connection_id, calendar_id, remote_id, ownership, status, title,
       description, location, start_at, end_at, is_all_day, availability,
       event_type, categories_json, raw_payload_json, created_at, updated_at
     ) VALUES ('calendar_event_upgrade_fixture', 'calendar_connection_upgrade_fixture',
               'calendar_upgrade_fixture', 'remote-event-fixture', 'external',
               'confirmed', 'Fixture appointment', 'Calendar event sentinel.',
               'Zurich', '2026-07-20T08:00:00.000Z', '2026-07-20T09:00:00.000Z',
               0, 'busy', 'meeting', '["verification"]', '{}', ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  seedOwner(db, "calendar_event", "calendar_event_upgrade_fixture");

  execute(
    db,
    `INSERT INTO preference_profiles (
       id, user_id, domain, default_context_id, model_version, created_at, updated_at
     ) VALUES ('preference_profile_upgrade_fixture', ?, 'travel', NULL, 'v1', ?, ?)`,
    [OWNER_USER_ID, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO preference_contexts (
       id, profile_id, name, description, share_mode, active, is_default,
       decay_days, created_at, updated_at
     ) VALUES ('preference_context_upgrade_fixture', 'preference_profile_upgrade_fixture',
               'Trips', 'Preference context sentinel.', 'blended', 1, 1, 90, ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `UPDATE preference_profiles SET default_context_id = 'preference_context_upgrade_fixture'
     WHERE id = 'preference_profile_upgrade_fixture'`
  );
  execute(
    db,
    `INSERT INTO preference_items (
       id, profile_id, label, description, tags_json, feature_weights_json,
       metadata_json, created_at, updated_at
     ) VALUES ('preference_item_upgrade_fixture', 'preference_profile_upgrade_fixture',
               'Quiet train', 'Preference item sentinel.', '["travel"]',
               '{"quiet":1}', '{}', ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  const preferenceCatalogHasContractColumns = tableColumns(
    db,
    "preference_catalogs"
  ).some((column) => column.name === "scope_in");
  if (preferenceCatalogHasContractColumns) {
    execute(
      db,
      `INSERT INTO preference_catalogs (
         id, profile_id, domain, slug, title, description, source, archived,
         scope_in, scope_out, created_source, created_by_actor, created_at, updated_at
       ) VALUES ('preference_catalog_upgrade_fixture', 'preference_profile_upgrade_fixture',
                 'travel', 'upgrade-fixture', 'Upgrade fixture', 'Catalog sentinel.',
                 'custom', 0, 'travel', 'commute', 'system', 'Harness', ?, ?)`,
      [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
    );
  } else {
    execute(
      db,
      `INSERT INTO preference_catalogs (
         id, profile_id, domain, slug, title, description, source, archived,
         created_at, updated_at
       ) VALUES ('preference_catalog_upgrade_fixture', 'preference_profile_upgrade_fixture',
                 'travel', 'upgrade-fixture', 'Upgrade fixture', 'Catalog sentinel.',
                 'custom', 0, ?, ?)`,
      [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
    );
  }
  execute(
    db,
    `INSERT INTO preference_catalog_items (
       id, catalog_id, label, description, tags_json, feature_weights_json,
       position, archived, created_at, updated_at
     ) VALUES ('preference_catalog_item_upgrade_fixture',
               'preference_catalog_upgrade_fixture', 'Window seat',
               'Catalog item sentinel.', '["travel"]', '{"window":1}', 0, 0, ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  const preferenceOwners = [
    ["preference_context", "preference_context_upgrade_fixture"],
    ["preference_item", "preference_item_upgrade_fixture"]
  ];
  if (seedPreferenceCatalogOwners) {
    preferenceOwners.push(
      ["preference_catalog", "preference_catalog_upgrade_fixture"],
      ["preference_catalog_item", "preference_catalog_item_upgrade_fixture"]
    );
  }
  for (const [type, id] of preferenceOwners) {
    seedOwner(db, type, id);
  }

  execute(
    db,
    `INSERT INTO artifact_blobs (
       content_sha256, storage_key, byte_size, detected_mime_type, created_at,
       stored_content_sha256, stored_byte_size, content_protection_mode
     ) VALUES (?, 'fixtures/upgrade.xlsx', 128, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               ?, ?, 128, 'plaintext')`,
    ["a".repeat(64), FIXTURE_TIMESTAMP, "a".repeat(64)]
  );
  execute(
    db,
    `INSERT INTO artifacts (
       id, title, short_description, description, original_file_name,
       storage_key, storage_path, content_sha256, byte_size, detected_extension,
       declared_mime_type, detected_mime_type, format_family, source_kind,
       source_label, uploaded_by_user_id, acting_for_user_id, artifact_state,
       danger_score, danger_level, download_policy, scan_results_json,
       enrichment_results_json, metadata_json, stored_content_sha256,
       stored_byte_size, content_protection_mode, created_at, updated_at
     ) VALUES ('artifact_upgrade_fixture', 'Fixture workbook', 'Artifact sentinel.',
               'Artifact metadata must survive unchanged.', 'fixture.xlsx',
               'fixtures/upgrade.xlsx', 'fixtures/upgrade.xlsx', ?, 128, '.xlsx',
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'spreadsheet', 'upload', 'Upgrade harness', ?, ?, 'active', 0,
               'low', 'human_only', '{}', '{}', '{"fixture":true}', ?, 128,
               'plaintext', ?, ?)`,
    [
      "a".repeat(64),
      OWNER_USER_ID,
      OWNER_USER_ID,
      "a".repeat(64),
      FIXTURE_TIMESTAMP,
      FIXTURE_TIMESTAMP
    ]
  );
  seedOwner(db, "artifact", "artifact_upgrade_fixture");

  execute(
    db,
    `INSERT INTO life_events (
       id, title, short_description, description, event_type, status, importance,
       starts_at, ends_at, timezone, is_all_day, place_label, place_timezone,
       source_kind, extraction_status, extraction_summary_json, travel_details_json,
       display_style_json, metadata_json, created_at, updated_at
     ) VALUES ('life_event_upgrade_fixture', 'Fixture journey', 'Life-event sentinel.',
               'A deterministic travel interval.', 'travel', 'planned', 'major',
               '2026-08-10T08:00:00.000Z', '2026-08-17T18:00:00.000Z',
               'Europe/Zurich', 0, 'Paris', 'Europe/Paris', 'manual', 'none',
               '{}', '{"mode":"train"}', '{}', '{"fixture":true}', ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  seedOwner(db, "life_event", "life_event_upgrade_fixture");

  execute(
    db,
    `INSERT INTO movement_places (
       id, external_uid, user_id, label, aliases_json, latitude, longitude,
       radius_meters, category_tags_json, visibility, linked_entities_json,
       linked_people_json, metadata_json, source, created_at, updated_at
     ) VALUES ('movement_place_upgrade_fixture', 'place-upgrade-fixture', ?,
               'Fixture station', '[]', 47.3769, 8.5417, 100, '["station"]',
               'private', '[]', '[]', '{"fixture":true}', 'user', ?, ?)`,
    [OWNER_USER_ID, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO movement_stays (
       id, external_uid, user_id, place_id, label, status, classification,
       started_at, ended_at, center_latitude, center_longitude, radius_meters,
       sample_count, weather_json, metrics_json, metadata_json, created_at, updated_at
     ) VALUES ('movement_stay_upgrade_fixture', 'stay-upgrade-fixture', ?,
               'movement_place_upgrade_fixture', 'Station wait', 'completed',
               'stationary', '2026-07-15T06:00:00.000Z', '2026-07-15T06:20:00.000Z',
               47.3769, 8.5417, 50, 12, '{}', '{}', '{"fixture":true}', ?, ?)`,
    [OWNER_USER_ID, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO movement_trips (
       id, external_uid, user_id, start_place_id, end_place_id, label, status,
       travel_mode, activity_type, started_at, ended_at, distance_meters,
       moving_seconds, idle_seconds, average_speed_mps, max_speed_mps,
       calories_kcal, expected_met, weather_json, tags_json, linked_entities_json,
       linked_people_json, metadata_json, created_at, updated_at
     ) VALUES ('movement_trip_upgrade_fixture', 'trip-upgrade-fixture', ?,
               'movement_place_upgrade_fixture', 'movement_place_upgrade_fixture',
               'Fixture loop', 'completed', 'cycling', 'cycling',
               '2026-07-15T06:20:00.000Z', '2026-07-15T07:20:00.000Z', 18000,
               3300, 300, 5.45, 10.2, 420, 7.5, '{}', '["fixture"]', '[]',
               '[]', '{"fixture":true}', ?, ?)`,
    [OWNER_USER_ID, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );

  execute(
    db,
    `INSERT INTO health_sleep_sessions (
       id, external_uid, user_id, source, source_type, source_device, started_at,
       ended_at, time_in_bed_seconds, asleep_seconds, awake_seconds, sleep_score,
       stage_breakdown_json, recovery_metrics_json, links_json, annotations_json,
       provenance_json, derived_json, source_timezone, local_date_key,
       raw_segment_count, source_metrics_json, created_at, updated_at
     ) VALUES ('sleep_upgrade_fixture', 'sleep-upgrade-fixture', ?, 'harness',
               'manual', 'fixture', '2026-07-14T21:30:00.000Z',
               '2026-07-15T05:30:00.000Z', 28800, 27000, 1800, 82, '[]', '{}',
               '[]', '{}', '{"fixture":true}', '{}', 'Europe/Zurich', '2026-07-15',
               0, '{}', ?, ?)`,
    [OWNER_USER_ID, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  execute(
    db,
    `INSERT INTO health_workout_sessions (
       id, external_uid, user_id, source, source_type, workout_type, source_device,
       started_at, ended_at, duration_seconds, active_energy_kcal,
       total_energy_kcal, distance_meters, exercise_minutes, average_heart_rate,
       max_heart_rate, subjective_effort, mood_before, mood_after, meaning_text,
       planned_context, social_context, links_json, tags_json, annotations_json,
       provenance_json, derived_json, reconciliation_status, created_at, updated_at
     ) VALUES ('workout_upgrade_fixture', 'workout-upgrade-fixture', ?, 'harness',
               'manual', 'cycling', 'fixture', '2026-07-15T06:20:00.000Z',
               '2026-07-15T07:20:00.000Z', 3600, 420, 500, 18000, 60, 132, 171,
               6, 'steady', 'energized', 'Workout sentinel.', 'verification', 'solo',
               '[]', '["fixture"]', '{}', '{"fixture":true}', '{}', 'standalone', ?, ?)`,
    [OWNER_USER_ID, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
}

function canonicalKey(byte) {
  return Buffer.alloc(32, byte).toString("base64url");
}

function seedLegacyPeopleFixture(db) {
  execute(
    db,
    `INSERT INTO people (
       id, user_id, display_name, normalized_display_name, given_name,
       relationship_category, relationship_label, closeness, importance,
       short_description, description, private_notes, how_we_met, birthday_precision,
       timezone, contact_preferences_json, metadata_json, created_at, updated_at
     ) VALUES ('person_legacy_upgrade_fixture', ?, 'Legacy Person', 'legacy person',
               'Legacy', 'friend', 'Old sharing fixture', 4, 5,
               'Valid 087 Person row.', 'Must survive 088 and 094.', '', '', 'unknown',
               'Europe/Zurich', '{}', '{"fixture":"legacy"}', ?, ?)`,
    [OWNER_USER_ID, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );
  seedOwner(db, "person", "person_legacy_upgrade_fixture");
  execute(
    db,
    `INSERT INTO person_aliases (
       id, person_id, alias, normalized_alias, kind, created_at, updated_at
     ) VALUES ('person_alias_legacy_fixture', 'person_legacy_upgrade_fixture',
               'Legacy friend', 'legacy friend', 'nickname', ?, ?)`,
    [FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP]
  );

  const localPrincipal = "a".repeat(64);
  const remotePrincipal = "b".repeat(64);
  const insertPrincipal = db.prepare(
    `INSERT INTO forge_principals (
       id, owner_user_id, principal_kind, public_principal_id, root_public_key,
       root_key_secret_id, display_label, local_person_id, trust_state,
       first_verified_at, last_verified_at, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, '{}', ?, ?)`
  );
  insertPrincipal.run(
    localPrincipal,
    OWNER_USER_ID,
    "local",
    localPrincipal,
    canonicalKey(11),
    "secret://legacy-local-principal",
    "Legacy local Forge",
    null,
    FIXTURE_TIMESTAMP,
    FIXTURE_TIMESTAMP,
    FIXTURE_TIMESTAMP,
    FIXTURE_TIMESTAMP
  );
  insertPrincipal.run(
    remotePrincipal,
    OWNER_USER_ID,
    "remote",
    remotePrincipal,
    canonicalKey(12),
    null,
    "Legacy remote Forge",
    "person_legacy_upgrade_fixture",
    FIXTURE_TIMESTAMP,
    FIXTURE_TIMESTAMP,
    FIXTURE_TIMESTAMP,
    FIXTURE_TIMESTAMP
  );
  execute(
    db,
    `INSERT INTO peer_relationships (
       id, owner_user_id, local_principal_id, remote_principal_id,
       local_person_id, status, negotiated_protocol_version,
       verification_phrase_hash, transport_privacy_mode,
       highest_received_sequence, highest_sent_sequence, established_at,
       last_connected_at, created_at, updated_at
     ) VALUES ('relationship_legacy_upgrade_fixture', ?, ?, ?,
               'person_legacy_upgrade_fixture', 'active', 'forge-peer/1', ?,
               'fastest', 2, 3, ?, ?, ?, ?)`,
    [
      OWNER_USER_ID,
      localPrincipal,
      remotePrincipal,
      "f".repeat(64),
      FIXTURE_TIMESTAMP,
      FIXTURE_TIMESTAMP,
      FIXTURE_TIMESTAMP,
      FIXTURE_TIMESTAMP
    ]
  );
  execute(
    db,
    `INSERT INTO peer_remote_records (
       id, owner_user_id, relationship_id, projection_id, projection_version,
       source_record_id, source_version, encrypted_payload, encryption_key_id,
       encryption_nonce, payload_hash, query_metadata_json, source_timestamp,
       received_at, valid_until, completeness, precision, cache_state,
       created_at, updated_at
     ) VALUES ('remote_record_legacy_unbound', ?, 'relationship_legacy_upgrade_fixture',
               'person.profile.v1', 1, 'legacy-person-profile', 'v1', ?,
               'legacy-key', ?, ?, '{}', ?, ?, '2026-12-31T23:59:59.000Z',
               1.0, 'exact', 'current', ?, ?)`,
    [
      OWNER_USER_ID,
      Buffer.from("legacy-encrypted-payload", "utf8"),
      Buffer.alloc(12, 7),
      "c".repeat(64),
      FIXTURE_TIMESTAMP,
      FIXTURE_TIMESTAMP,
      FIXTURE_TIMESTAMP,
      FIXTURE_TIMESTAMP
    ]
  );
  execute(
    db,
    `INSERT INTO peer_command_journal (
       command_id, owner_user_id, operation_id, target_type, target_id,
       request_hash, expected_version, status, attempt_count, result_hash,
       result_reference, last_error, last_dispatched_at, applied_at,
       created_at, updated_at
     ) VALUES ('legacy_command_without_current_authority', ?,
               'revokePeerRelationship', 'relationship',
               'relationship_legacy_upgrade_fixture', ?, ?, 'failed', 1,
               NULL, NULL, 'Legacy command has no 094 authority binding.', ?,
               NULL, ?, ?)`,
    [
      OWNER_USER_ID,
      "e".repeat(64),
      FIXTURE_TIMESTAMP,
      FIXTURE_TIMESTAMP,
      FIXTURE_TIMESTAMP,
      FIXTURE_TIMESTAMP
    ]
  );
}

function applyPriorReleaseMigrations({
  evidenceRoot,
  databasePath,
  repoRoot,
  cutoff,
  fixtureScale,
  legacyPeople
}) {
  const safeDatabasePath = assertFreshPath(evidenceRoot, databasePath);
  mkdirSync(path.dirname(safeDatabasePath), { recursive: true, mode: 0o700 });
  const migrationsDir = path.join(repoRoot, "apps", "api", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql") && file <= cutoff)
    .sort();
  if (!files.includes(cutoff)) {
    fail(
      "fixture_cutoff_missing",
      `Fixture migration cutoff is missing: ${cutoff}`
    );
  }

  const db = new DatabaseSync(safeDatabasePath);
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE;");
    db.exec(
      `CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
    );
    for (const file of files) {
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      db.exec("BEGIN");
      try {
        db.exec(sql);
        db.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)").run(
          file,
          FIXTURE_TIMESTAMP
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        fail("prior_fixture_migration_failed", `${file}: ${error.message}`);
      }
    }
    seedBaseFixture(db, fixtureScale);
    if (legacyPeople) seedLegacyPeopleFixture(db);
    const integrity = db.prepare("PRAGMA integrity_check").all();
    const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      fail(
        "prior_fixture_integrity_failed",
        "Prior fixture failed integrity_check."
      );
    }
    if (foreignKeys.length !== 0) {
      fail(
        "prior_fixture_foreign_key_failed",
        "Prior fixture failed foreign_key_check."
      );
    }
  } finally {
    db.close();
  }
  return { migrationCount: files.length, cutoff };
}

function tableExists(db, tableName) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
  );
}

function tableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
}

function tableSnapshot(db, tableName, requestedColumns = null) {
  const metadata = tableColumns(db, tableName);
  const available = new Set(metadata.map((column) => column.name));
  const columns = requestedColumns ?? metadata.map((column) => column.name);
  for (const column of columns) {
    if (!available.has(column)) {
      fail(
        "preservation_column_missing",
        `${tableName}.${column} disappeared during upgrade.`
      );
    }
  }
  const primaryKey = metadata
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
  const orderColumns = primaryKey.length > 0 ? primaryKey : columns;
  const select = columns.map(quoteIdentifier).join(", ");
  const orderBy = orderColumns.map(quoteIdentifier).join(", ");
  const rows = db
    .prepare(
      `SELECT ${select} FROM ${quoteIdentifier(tableName)} ORDER BY ${orderBy}`
    )
    .all();
  const payload = { tableName, columns, rows };
  return {
    columns,
    primaryKey,
    rows,
    rowCount: rows.length,
    logicalSha256: sha256(stableSerialize(payload)),
    rowDigests: rows
      .map((row) => sha256(stableSerialize(row)))
      .sort((left, right) => left.localeCompare(right, "en"))
  };
}

function databaseTableInventory(db) {
  return db
    .prepare("PRAGMA table_list")
    .all()
    .filter(
      (row) =>
        row.schema === "main" &&
        !row.name.startsWith("sqlite_") &&
        row.name !== "migrations"
    )
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function listPreservationTables(inventory, additiveContracts) {
  const familyByTable = new Map(PRESERVATION_TABLES);
  return inventory
    .filter((row) => row.type === "table" || row.type === "virtual")
    .map((row) => {
      const additiveContract = additiveContracts[row.name];
      return {
        tableName: row.name,
        storageType: row.type,
        family: familyByTable.get(row.name) ?? "other",
        strictCount: !additiveContract,
        expectedAdditiveRows: additiveContract?.rowCount ?? 0,
        additiveReason: additiveContract?.reason ?? null
      };
    });
}

function checkpointDatabase(databasePath) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

function databaseHealth(db) {
  const integrityCheck = db
    .prepare("PRAGMA integrity_check")
    .all()
    .map((row) => row.integrity_check);
  const foreignKeyCheck = db.prepare("PRAGMA foreign_key_check").all();
  return { integrityCheck, foreignKeyCheck };
}

function captureDatabaseSnapshot(
  evidenceRoot,
  databasePath,
  { additiveContracts = EXPECTED_ADDITIVE_UPGRADE_ROWS } = {}
) {
  const safePath = assertHarnessPath(evidenceRoot, databasePath);
  checkpointDatabase(safePath);
  const db = new DatabaseSync(safePath, { readOnly: true });
  try {
    const health = databaseHealth(db);
    const tableInventory = databaseTableInventory(db);
    const excludedDerivedShadowTables = tableInventory
      .filter((table) => table.type === "shadow")
      .map((table) => table.name);
    const tables = {};
    const families = new Set();
    for (const {
      tableName,
      storageType,
      family,
      strictCount,
      expectedAdditiveRows,
      additiveReason
    } of listPreservationTables(tableInventory, additiveContracts)) {
      tables[tableName] = {
        family,
        storageType,
        strictCount,
        expectedAdditiveRows,
        additiveReason,
        ...tableSnapshot(db, tableName)
      };
      families.add(family);
    }
    const migrations = db
      .prepare("SELECT id, applied_at AS appliedAt FROM migrations ORDER BY id")
      .all();
    const metadata = statSync(safePath);
    return {
      databaseFile: path.relative(evidenceRoot, safePath),
      byteSize: metadata.size,
      fileSha256: sha256(readFileSync(safePath)),
      preservationSha256: sha256(
        stableSerialize(
          Object.fromEntries(
            Object.entries(tables).map(([name, table]) => [
              name,
              {
                rowCount: table.rowCount,
                logicalSha256: table.logicalSha256,
                storageType: table.storageType,
                strictCount: table.strictCount,
                expectedAdditiveRows: table.expectedAdditiveRows
              }
            ])
          )
        )
      ),
      preservationFamilyCount: families.size,
      preservationFamilies: [...families].sort(),
      excludedDerivedShadowTables,
      tables,
      migrations,
      health
    };
  } finally {
    db.close();
  }
}

function verifyPreservedRows(evidenceRoot, databasePath, baseline) {
  const safePath = assertHarnessPath(evidenceRoot, databasePath);
  const db = new DatabaseSync(safePath, { readOnly: true });
  const checked = [];
  try {
    for (const [tableName, expected] of Object.entries(baseline.tables)) {
      if (!tableExists(db, tableName)) {
        fail(
          "preservation_table_missing",
          `${tableName} disappeared during upgrade.`
        );
      }
      const actual = tableSnapshot(db, tableName, expected.columns);
      if (actual.rowCount < expected.rowCount) {
        fail(
          "preservation_row_count_changed",
          `${tableName} row count changed (${expected.rowCount} -> ${actual.rowCount}).`
        );
      }

      const remainingRows = new Map();
      for (const digest of actual.rowDigests) {
        remainingRows.set(digest, (remainingRows.get(digest) ?? 0) + 1);
      }
      for (const digest of expected.rowDigests) {
        const remaining = remainingRows.get(digest) ?? 0;
        if (remaining === 0) {
          fail(
            "preservation_hash_changed",
            `${tableName} no longer contains every pre-upgrade logical row.`
          );
        }
        remainingRows.set(digest, remaining - 1);
      }

      const additiveRows = actual.rowCount - expected.rowCount;
      if (
        expected.strictCount &&
        (actual.rowCount !== expected.rowCount ||
          actual.logicalSha256 !== expected.logicalSha256)
      ) {
        fail(
          "preservation_strict_table_changed",
          `${tableName} must remain byte-logically exact (${expected.rowCount} -> ${actual.rowCount} rows).`
        );
      }
      if (
        !expected.strictCount &&
        additiveRows !== expected.expectedAdditiveRows
      ) {
        fail(
          "preservation_additive_contract_changed",
          `${tableName} added ${additiveRows} rows; expected exactly ${expected.expectedAdditiveRows} (${expected.additiveReason}).`
        );
      }
      checked.push({
        tableName,
        family: expected.family,
        storageType: expected.storageType,
        strictCount: expected.strictCount,
        rowCountBefore: expected.rowCount,
        rowCountAfter: actual.rowCount,
        additiveRows,
        expectedAdditiveRows: expected.expectedAdditiveRows,
        additiveReason: expected.additiveReason,
        baselineLogicalSha256: expected.logicalSha256
      });
    }
  } finally {
    db.close();
  }
  return {
    checkedTableCount: checked.length,
    strictTableCount: checked.filter((table) => table.strictCount).length,
    checkedRowCount: checked.reduce(
      (sum, table) => sum + table.rowCountBefore,
      0
    ),
    additiveRowCount: checked.reduce(
      (sum, table) => sum + table.additiveRows,
      0
    ),
    tables: checked
  };
}

function copyVerifiedBackup({
  evidenceRoot,
  sourcePath,
  backupPath,
  baseline
}) {
  const source = assertHarnessPath(evidenceRoot, sourcePath);
  const backup = assertFreshPath(evidenceRoot, backupPath);
  mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
  copyFileSync(source, backup, fsConstants.COPYFILE_EXCL);
  const descriptor = openSync(backup, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const manifest = {
    sourceFileSha256: baseline.fileSha256,
    sourceByteSize: baseline.byteSize,
    sourcePreservationSha256: baseline.preservationSha256,
    backupFileSha256: sha256(readFileSync(backup)),
    backupByteSize: statSync(backup).size
  };
  if (
    manifest.backupFileSha256 !== manifest.sourceFileSha256 ||
    manifest.backupByteSize !== manifest.sourceByteSize
  ) {
    fail(
      "backup_copy_mismatch",
      "Backup copy is not byte-identical to its source."
    );
  }
  return manifest;
}

export function verifyBackupManifest(evidenceRoot, backupPath, manifest) {
  const backup = assertHarnessPath(evidenceRoot, backupPath);
  const metadata = statSync(backup);
  const digest = sha256(readFileSync(backup));
  if (
    metadata.size !== manifest.backupByteSize ||
    digest !== manifest.backupFileSha256
  ) {
    fail("backup_tampered", "Backup bytes do not match the recorded manifest.");
  }
  return { byteSize: metadata.size, fileSha256: digest };
}

function restoreVerifiedBackup({
  evidenceRoot,
  backupPath,
  destinationPath,
  manifest
}) {
  const backup = assertHarnessPath(evidenceRoot, backupPath);
  const destination = assertFreshPath(evidenceRoot, destinationPath);
  verifyBackupManifest(evidenceRoot, backup, manifest);
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  copyFileSync(backup, destination, fsConstants.COPYFILE_EXCL);
  const descriptor = openSync(destination, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const restored = {
    byteSize: statSync(destination).size,
    fileSha256: sha256(readFileSync(destination))
  };
  if (
    restored.byteSize !== manifest.backupByteSize ||
    restored.fileSha256 !== manifest.backupFileSha256
  ) {
    fail(
      "restore_copy_mismatch",
      "Restored database is not byte-identical to backup."
    );
  }
  return restored;
}

function writeChildLog(evidenceRoot, logPath, content) {
  const safeLog = assertFreshPath(evidenceRoot, logPath);
  mkdirSync(path.dirname(safeLog), { recursive: true, mode: 0o700 });
  writeFileSync(safeLog, content, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
}

async function reserveLoopbackPort() {
  const server = createServer();
  server.unref();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    fail(
      "prior_runtime_port_reservation_failed",
      "Could not reserve a TCP port."
    );
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

function priorRuntimeEnvironment({
  evidenceRoot,
  dataRoot,
  processRoot,
  port
}) {
  const home = path.join(processRoot, "home");
  const temp = path.join(processRoot, "temp");
  const config = path.join(home, ".config");
  const data = path.join(home, ".local", "share");
  const cache = path.join(home, ".cache");
  for (const directory of [home, temp, config, data, cache]) {
    mkdirSync(assertHarnessPath(evidenceRoot, directory), {
      recursive: true,
      mode: 0o700
    });
  }
  const environment = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    XDG_CACHE_HOME: cache,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    FORGE_DATA_ROOT: dataRoot,
    FORGE_HARNESS_DATA_ROOT: dataRoot,
    FORGE_OPENCLAW_DEV: "0",
    FORGE_SEED_DEMO_DATA: "0",
    FORGE_PEER_ENABLED: "0",
    FORGE_PEER_REQUIRED: "0",
    FORGE_DISABLE_DISCOVERY_ADVERTISEMENT: "1",
    FORGE_LEGACY_WIKI_AUTO_IMPORT: "0",
    FORGE_DEBUG: "0",
    HOST: "127.0.0.1",
    PORT: String(port),
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    TZ: "UTC"
  };
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  return environment;
}

async function waitWithTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runExactPriorRuntime({
  evidenceRoot,
  dataRoot,
  priorRelease,
  label,
  logDirectory
}) {
  if (!/^[a-z0-9-]+$/u.test(label)) {
    fail("prior_runtime_label_invalid", `Unsafe prior runtime label: ${label}`);
  }
  const safeDataRoot = assertHarnessPath(evidenceRoot, dataRoot);
  const runtimePackagePath = assertHarnessPath(
    evidenceRoot,
    priorRelease.runtimePackagePath
  );
  const entrypoint = path.join(runtimePackagePath, "server", "index.js");
  const entrypointMetadata = lstatSync(entrypoint);
  if (!entrypointMetadata.isFile() || entrypointMetadata.isSymbolicLink()) {
    fail(
      "prior_runtime_entrypoint_invalid",
      "Pinned prior runtime entrypoint is not a regular file."
    );
  }
  mkdirSync(safeDataRoot, { recursive: true, mode: 0o700 });
  const processRoot = assertFreshPath(
    evidenceRoot,
    path.join(evidenceRoot, "prior-runtime-processes", label)
  );
  mkdirSync(processRoot, { recursive: true, mode: 0o700 });
  const port = await reserveLoopbackPort();
  const environment = priorRuntimeEnvironment({
    evidenceRoot,
    dataRoot: safeDataRoot,
    processRoot,
    port
  });
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let outputOverflow = false;
  let healthPayload = null;
  let completionResult = null;
  let spawnError = null;
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: runtimePackagePath,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const appendOutput = (target, chunk) => {
    const next = target + chunk.toString("utf8");
    if (Buffer.byteLength(next, "utf8") > MAX_CHILD_OUTPUT_BYTES) {
      outputOverflow = true;
      return target;
    }
    return next;
  };
  child.stdout.on("data", (chunk) => {
    stdout = appendOutput(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendOutput(stderr, chunk);
  });
  child.once("error", (error) => {
    spawnError = error;
  });
  const completion = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      completionResult = { code, signal };
      resolve(completionResult);
    });
  });
  let result = null;
  let runError = null;
  try {
    const startupDeadline = Date.now() + 45_000;
    let lastHealthError = null;
    while (Date.now() < startupDeadline && !healthPayload) {
      if (outputOverflow) {
        fail(
          "prior_runtime_output_overflow",
          "Pinned prior runtime exceeded the bounded output allowance."
        );
      }
      if (spawnError) {
        fail("prior_runtime_spawn_failed", spawnError.message);
      }
      if (completionResult) {
        fail(
          "prior_runtime_exited_before_health",
          `Pinned prior runtime exited before health (code ${completionResult.code}, signal ${completionResult.signal}).`,
          { stderr: stderr.slice(-4000) }
        );
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
          headers: { "x-forge-runtime-probe": "1" },
          signal: AbortSignal.timeout(1_500)
        });
        if (response.status === 200) {
          const payload = await response.json();
          if (
            payload?.ok !== true ||
            payload?.app !== "forge" ||
            payload?.apiVersion !== "v1" ||
            payload?.backend !== "forge-node-runtime" ||
            payload?.runtime?.pid !== child.pid ||
            path.resolve(payload?.runtime?.storageRoot ?? "") !== safeDataRoot
          ) {
            fail(
              "prior_runtime_health_contract_mismatch",
              "Pinned prior runtime returned an unexpected health contract.",
              payload
            );
          }
          healthPayload = payload;
          break;
        }
        lastHealthError = `HTTP ${response.status}`;
      } catch (error) {
        lastHealthError =
          error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 125));
    }
    if (!healthPayload) {
      fail(
        "prior_runtime_health_timeout",
        "Pinned prior runtime did not become healthy before the deadline.",
        { lastHealthError, stderr: stderr.slice(-4000) }
      );
    }
    const healthyAt = Date.now();
    if (!child.kill("SIGTERM")) {
      fail(
        "prior_runtime_shutdown_signal_failed",
        "Could not signal the pinned prior runtime for clean shutdown."
      );
    }
    const gracefulExit = await waitWithTimeout(completion, 8_000);
    if (!gracefulExit) {
      child.kill("SIGKILL");
      await waitWithTimeout(completion, 3_000);
      fail(
        "prior_runtime_shutdown_timeout",
        "Pinned prior runtime did not stop after SIGTERM."
      );
    }
    if (gracefulExit.code !== 0 || gracefulExit.signal !== null) {
      fail(
        "prior_runtime_shutdown_unclean",
        "Pinned prior runtime did not exit cleanly after SIGTERM.",
        gracefulExit
      );
    }
    result = {
      status: "passed",
      packageVersion: PRIOR_RELEASE_ARTIFACT.version,
      packageTagCommit: PRIOR_RELEASE_ARTIFACT.tagCommit,
      dataRoot: path.relative(evidenceRoot, safeDataRoot),
      processId: child.pid,
      health: {
        statusCode: 200,
        ok: healthPayload.ok,
        app: healthPayload.app,
        apiVersion: healthPayload.apiVersion,
        backend: healthPayload.backend,
        runtimePidMatched: healthPayload.runtime.pid === child.pid,
        storageRootMatched:
          path.resolve(healthPayload.runtime.storageRoot) === safeDataRoot
      },
      startupMilliseconds: healthyAt - startedAt,
      shutdown: {
        signalSent: "SIGTERM",
        exitCode: gracefulExit.code,
        exitSignal: gracefulExit.signal,
        milliseconds: Date.now() - healthyAt
      },
      logs: {
        stdout: path.relative(
          evidenceRoot,
          path.join(logDirectory, `${label}.stdout.log`)
        ),
        stderr: path.relative(
          evidenceRoot,
          path.join(logDirectory, `${label}.stderr.log`)
        ),
        health: path.relative(
          evidenceRoot,
          path.join(logDirectory, `${label}.health.json`)
        )
      }
    };
  } catch (error) {
    runError = error;
    if (!completionResult) {
      child.kill("SIGKILL");
      await waitWithTimeout(completion, 3_000);
    }
  } finally {
    writeChildLog(
      evidenceRoot,
      path.join(logDirectory, `${label}.stdout.log`),
      stdout
    );
    writeChildLog(
      evidenceRoot,
      path.join(logDirectory, `${label}.stderr.log`),
      stderr
    );
    if (healthPayload) {
      writeChildLog(
        evidenceRoot,
        path.join(logDirectory, `${label}.health.json`),
        `${JSON.stringify(healthPayload, null, 2)}\n`
      );
    }
  }
  if (runError) throw runError;
  return result;
}

function verifyPriorReleaseDatabaseContract({
  evidenceRoot,
  databasePath,
  priorRelease
}) {
  const safePath = assertHarnessPath(evidenceRoot, databasePath);
  const db = new DatabaseSync(safePath, { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT id, applied_at AS appliedAt FROM migrations ORDER BY id")
      .all();
    const sqlRows = rows.filter((row) => row.id.endsWith(".sql"));
    const runtimeRows = rows.filter((row) => !row.id.endsWith(".sql"));
    const expectedSql = priorRelease.migrationEntries.map(
      (entry) => entry.name
    );
    if (
      sqlRows.length !== expectedSql.length ||
      sqlRows.some((row, index) => row.id !== expectedSql[index])
    ) {
      fail(
        "prior_runtime_migration_ledger_mismatch",
        "Pinned prior runtime did not apply its exact packed SQL migration chain."
      );
    }
    const runtimeMarkerIds = runtimeRows.map((row) => row.id);
    if (
      stableSerialize(runtimeMarkerIds) !==
      stableSerialize(["runtime:legacy-wiki-markdown-import:v1"])
    ) {
      fail(
        "prior_runtime_marker_mismatch",
        "Pinned prior runtime emitted an unexpected non-SQL migration marker.",
        { runtimeMarkerIds }
      );
    }
    const health = databaseHealth(db);
    if (
      stableSerialize(health.integrityCheck) !== stableSerialize(["ok"]) ||
      health.foreignKeyCheck.length !== 0
    ) {
      fail(
        "prior_runtime_database_health_failed",
        "Pinned prior runtime database failed integrity or foreign-key checks.",
        health
      );
    }
    return {
      sqlMigrationCount: sqlRows.length,
      firstSqlMigration: sqlRows[0]?.id ?? null,
      lastSqlMigration: sqlRows.at(-1)?.id ?? null,
      runtimeMarkerIds,
      totalLedgerCount: rows.length,
      health
    };
  } finally {
    db.close();
  }
}

function seedExactPriorReleaseFixture({ evidenceRoot, databasePath }) {
  const safePath = assertHarnessPath(evidenceRoot, databasePath);
  const db = new DatabaseSync(safePath);
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE;");
    db.prepare("UPDATE migrations SET applied_at = ?").run(FIXTURE_TIMESTAMP);
    const questionnaireInstrumentCount = db
      .prepare("SELECT COUNT(*) AS count FROM questionnaire_instruments")
      .get().count;
    const questionnaireVersionCount = db
      .prepare("SELECT COUNT(*) AS count FROM questionnaire_versions")
      .get().count;
    if (questionnaireInstrumentCount !== 7 || questionnaireVersionCount !== 7) {
      fail(
        "prior_runtime_seed_contract_mismatch",
        "Pinned prior runtime did not create its expected built-in questionnaire rows.",
        { questionnaireInstrumentCount, questionnaireVersionCount }
      );
    }
    db.prepare(
      "UPDATE questionnaire_instruments SET created_at = ?, updated_at = ?"
    ).run(FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP);
    db.prepare(
      "UPDATE questionnaire_versions SET created_at = ?, updated_at = ?, published_at = ?"
    ).run(FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP);
    seedBaseFixture(db, "release", { seedPreferenceCatalogOwners: false });
    const health = databaseHealth(db);
    if (
      stableSerialize(health.integrityCheck) !== stableSerialize(["ok"]) ||
      health.foreignKeyCheck.length !== 0
    ) {
      fail(
        "prior_fixture_health_failed",
        "Exact prior-release fixture failed integrity or foreign-key checks.",
        health
      );
    }
    return {
      deterministicTimestamp: FIXTURE_TIMESTAMP,
      questionnaireInstrumentCount,
      questionnaireVersionCount,
      preferenceOwnershipBackfillCandidates: 2,
      health
    };
  } finally {
    db.close();
  }
}

function normalizeExactPriorRuntimeVolatileState({
  evidenceRoot,
  databasePath
}) {
  const safePath = assertHarnessPath(evidenceRoot, databasePath);
  const db = new DatabaseSync(safePath);
  try {
    db.prepare("UPDATE users SET updated_at = ?").run(FIXTURE_TIMESTAMP);
    db.prepare("UPDATE user_access_grants SET updated_at = ?").run(
      FIXTURE_TIMESTAMP
    );
    return {
      normalizedAt: FIXTURE_TIMESTAMP,
      columns: PRIOR_RUNTIME_STARTUP_VOLATILE_COLUMNS
    };
  } finally {
    db.close();
  }
}

async function createExactPriorReleaseFixture({
  evidenceRoot,
  dataRoot,
  databasePath,
  priorRelease,
  logDirectory,
  scenarioId
}) {
  const runtimeLabelPrefix = scenarioId.replaceAll(".", "-");
  const safeDataRoot = assertFreshPath(evidenceRoot, dataRoot);
  const safeDatabasePath = assertFreshPath(evidenceRoot, databasePath);
  mkdirSync(safeDataRoot, { recursive: true, mode: 0o700 });
  const initialStartup = await runExactPriorRuntime({
    evidenceRoot,
    dataRoot: safeDataRoot,
    priorRelease,
    label: `${runtimeLabelPrefix}-prior-initial`,
    logDirectory
  });
  if (!existsSync(safeDatabasePath)) {
    fail(
      "prior_runtime_database_missing",
      "Pinned prior runtime did not create the isolated Forge database."
    );
  }
  const initialContract = verifyPriorReleaseDatabaseContract({
    evidenceRoot,
    databasePath: safeDatabasePath,
    priorRelease
  });
  const seededFixture = seedExactPriorReleaseFixture({
    evidenceRoot,
    databasePath: safeDatabasePath
  });
  const seededStartup = await runExactPriorRuntime({
    evidenceRoot,
    dataRoot: safeDataRoot,
    priorRelease,
    label: `${runtimeLabelPrefix}-prior-seeded`,
    logDirectory
  });
  const normalizedStartupState = normalizeExactPriorRuntimeVolatileState({
    evidenceRoot,
    databasePath: safeDatabasePath
  });
  const seededContract = verifyPriorReleaseDatabaseContract({
    evidenceRoot,
    databasePath: safeDatabasePath,
    priorRelease
  });
  return {
    fixture: {
      origin: "exact_published_runtime_v0.3.32",
      cutoff: PRIOR_RELEASE_ARTIFACT.migrationCutoff,
      sqlMigrationCount: seededContract.sqlMigrationCount,
      totalLedgerCount: seededContract.totalLedgerCount,
      runtimeMarkerIds: seededContract.runtimeMarkerIds,
      deterministicFixture: seededFixture,
      normalizedStartupState,
      initialDatabaseContract: initialContract
    },
    priorRuntime: { initialStartup, seededStartup }
  };
}

function runTsxChild({
  evidenceRoot,
  dataRoot,
  repoRoot,
  label,
  script,
  logDirectory
}) {
  assertHarnessRoot(evidenceRoot);
  assertHarnessPath(evidenceRoot, dataRoot);
  const childHome = assertHarnessPath(
    evidenceRoot,
    path.join(evidenceRoot, "process-home")
  );
  const childTemp = assertHarnessPath(
    evidenceRoot,
    path.join(evidenceRoot, "process-temp")
  );
  const childConfig = path.join(childHome, ".config");
  const childData = path.join(childHome, ".local", "share");
  const childCache = path.join(childHome, ".cache");
  for (const directory of [
    childHome,
    childTemp,
    childConfig,
    childData,
    childCache
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const childEnvironment = {
    ...process.env,
    HOME: childHome,
    USERPROFILE: childHome,
    XDG_CONFIG_HOME: childConfig,
    XDG_DATA_HOME: childData,
    XDG_CACHE_HOME: childCache,
    TMPDIR: childTemp,
    TMP: childTemp,
    TEMP: childTemp,
    FORGE_DATA_ROOT: dataRoot,
    FORGE_HARNESS_DATA_ROOT: dataRoot,
    FORGE_SEED_DEMO_DATA: "0",
    FORGE_PEER_ENABLED: "0",
    FORGE_PEER_REQUIRED: "0",
    FORGE_LEGACY_WIKI_AUTO_IMPORT: "0",
    FORGE_DEBUG: "0",
    TZ: "UTC"
  };
  delete childEnvironment.NODE_OPTIONS;
  delete childEnvironment.NODE_PATH;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: repoRoot,
      env: childEnvironment,
      encoding: "utf8",
      maxBuffer: MAX_CHILD_OUTPUT_BYTES,
      timeout: 120_000
    }
  );
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  writeChildLog(
    evidenceRoot,
    path.join(logDirectory, `${label}.stdout.log`),
    stdout
  );
  writeChildLog(
    evidenceRoot,
    path.join(logDirectory, `${label}.stderr.log`),
    stderr
  );
  if (result.error) {
    fail("child_process_failed", `${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail("child_process_failed", `${label} exited ${result.status}.`, {
      stderr: stderr.slice(-4000)
    });
  }
  return { stdout, stderr };
}

function migrationRunnerScript(repoRoot) {
  const dbModule = pathToFileURL(
    path.join(repoRoot, "apps", "api", "src", "db.ts")
  ).href;
  return `
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  initializeDatabase
} from ${JSON.stringify(dbModule)};
const dataRoot = process.env.FORGE_HARNESS_DATA_ROOT;
if (!dataRoot) throw new Error("FORGE_HARNESS_DATA_ROOT is required.");
configureDatabase({ dataRoot, seedDemoData: false });
configureLegacyWikiAutoImport(false);
try {
  await initializeDatabase();
} finally {
  closeDatabase();
}
`;
}

function runActualMigrationRunner(input) {
  return runTsxChild({
    ...input,
    script: migrationRunnerScript(input.repoRoot)
  });
}

function operationsScript(repoRoot) {
  const source = (relativePath) =>
    pathToFileURL(path.join(repoRoot, "apps", "api", "src", relativePath)).href;
  return `
import { createHash } from "node:crypto";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from ${JSON.stringify(source("db.ts"))};
import { createPerson, listPeople } from ${JSON.stringify(source("repositories/people.ts"))};
import {
  listEntityLinksForEntity,
  replaceEntityLinksForSource
} from ${JSON.stringify(source("repositories/entity-links.ts"))};
import {
  getPeerRelationship,
  revokePeerRelationshipRecord
} from ${JSON.stringify(source("repositories/peer-sharing.ts"))};
import {
  hashPeerQueryCacheIdentity,
  peerTypedQuestionSchema
} from ${JSON.stringify(source("services/peer-typed-query.ts"))};

const dataRoot = process.env.FORGE_HARNESS_DATA_ROOT;
if (!dataRoot) throw new Error("FORGE_HARNESS_DATA_ROOT is required.");
const ownerUserId = ${JSON.stringify(OWNER_USER_ID)};
const now = new Date(${JSON.stringify(OPERATION_TIMESTAMP)});
const revokedAt = new Date("2026-07-16T10:01:00.000Z");
const key = (byte) => Buffer.alloc(32, byte).toString("base64url");
configureDatabase({ dataRoot, seedDemoData: false });
configureLegacyWikiAutoImport(false);
await initializeDatabase();
try {
  const person = createPerson(
    {
      userId: ownerUserId,
      displayName: "Post-upgrade Person",
      preferredName: "Post-upgrade",
      relationshipCategory: "friend",
      relationshipLabel: "Upgrade verification",
      shortDescription: "Created through the current Person repository after upgrade.",
      aliases: [{ alias: "Upgrade friend", kind: "nickname" }],
      contacts: [],
      facts: [],
      links: []
    },
    { id: "person_post_upgrade_fixture", now }
  );
  const listed = listPeople({
    userId: ownerUserId,
    q: "Post-upgrade",
    includeDeleted: false,
    limit: 20,
    offset: 0,
    sort: "name"
  });
  replaceEntityLinksForSource({
    sourceEntityType: "person",
    sourceEntityId: person.id,
    links: [
      {
        entityType: "goal",
        entityId: "goal_upgrade_fixture",
        anchorKey: "people-upgrade",
        relationship: "supports"
      }
    ],
    actor: "People upgrade harness",
    now
  });
  const links = listEntityLinksForEntity("person", person.id);
  const query = peerTypedQuestionSchema.parse({
    projectionId: "person.profile.v1",
    parameters: {},
    interval: null,
    entityIds: [],
    fields: ["displayName", "preferredName", "relationshipLabel"],
    precision: "exact",
    maximumResultCount: 20
  });
  const queryHash = hashPeerQueryCacheIdentity(query);

  const db = getDatabase();
  const localPrincipalId = "1".repeat(64);
  const remotePrincipalId = "2".repeat(64);
  const insertPrincipal = db.prepare(
    \`INSERT INTO forge_principals (
       id, owner_user_id, principal_kind, public_principal_id, root_public_key,
       root_key_secret_id, display_label, local_person_id, trust_state,
       first_verified_at, last_verified_at, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, '{}', ?, ?)\`
  );
  insertPrincipal.run(
    localPrincipalId, ownerUserId, "local", localPrincipalId, key(21),
    "secret://post-upgrade-local", "Post-upgrade local Forge", null,
    now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString()
  );
  insertPrincipal.run(
    remotePrincipalId, ownerUserId, "remote", remotePrincipalId, key(22),
    null, "Post-upgrade remote Forge", person.id,
    now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString()
  );
  db.prepare(
    \`INSERT INTO peer_relationships (
       id, owner_user_id, local_principal_id, remote_principal_id,
       local_person_id, status, negotiated_protocol_version,
       verification_phrase_hash, transport_privacy_mode,
       highest_received_sequence, highest_sent_sequence, established_at,
       last_connected_at, created_at, updated_at
     ) VALUES ('relationship_post_upgrade_fixture', ?, ?, ?, ?, 'active',
               'forge-peer/1', ?, 'fastest', 0, 0, ?, ?, ?, ?)\`
  ).run(
    ownerUserId, localPrincipalId, remotePrincipalId, person.id,
    createHash("sha256").update("post-upgrade-verification").digest("hex"),
    now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString()
  );
  const beforeRevoke = getPeerRelationship(
    ownerUserId,
    "relationship_post_upgrade_fixture"
  );
  if (!beforeRevoke) throw new Error("Post-upgrade relationship was not created.");
  const revoked = revokePeerRelationshipRecord({
    ownerUserId,
    relationshipId: beforeRevoke.id,
    expectedVersion: beforeRevoke.updatedAt,
    reason: "Upgrade/restore executable verification",
    purgeManagedCache: true,
    now: revokedAt
  });
  const readModelRevision = db
    .prepare(
      "SELECT revision FROM people_read_model_revisions WHERE owner_user_id = ?"
    )
    .get(ownerUserId)?.revision ?? 0;
  const result = {
    createdPersonId: person.id,
    listMatched: listed.people.some((candidate) => candidate.id === person.id),
    listTotal: listed.total,
    linkCount: links.length,
    linkTarget: links[0]?.targetEntityId ?? null,
    queryProjectionId: query.projectionId,
    queryHash,
    relationshipBeforeRevoke: beforeRevoke.status,
    relationshipAfterRevoke: revoked?.status ?? null,
    revokedAt: revoked?.revokedAt ?? null,
    readModelRevision
  };
  process.stdout.write(${JSON.stringify("FORGE_HARNESS_RESULT=")} + JSON.stringify(result) + "\\n");
} finally {
  closeDatabase();
}
`;
}

function runPostUpgradeOperations(input) {
  const result = runTsxChild({
    ...input,
    script: operationsScript(input.repoRoot)
  });
  const line = result.stdout
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith("FORGE_HARNESS_RESULT="));
  if (!line) {
    fail(
      "operation_result_missing",
      "Post-upgrade operation result was not emitted."
    );
  }
  const parsed = JSON.parse(line.slice("FORGE_HARNESS_RESULT=".length));
  if (
    parsed.createdPersonId !== "person_post_upgrade_fixture" ||
    parsed.listMatched !== true ||
    parsed.linkCount !== 1 ||
    parsed.linkTarget !== "goal_upgrade_fixture" ||
    parsed.queryProjectionId !== "person.profile.v1" ||
    !/^[a-f0-9]{64}$/.test(parsed.queryHash) ||
    parsed.relationshipBeforeRevoke !== "active" ||
    parsed.relationshipAfterRevoke !== "revoked" ||
    parsed.revokedAt !== "2026-07-16T10:01:00.000Z" ||
    !Number.isInteger(parsed.readModelRevision) ||
    parsed.readModelRevision < 4
  ) {
    fail(
      "post_upgrade_operations_failed",
      "Post-upgrade People operations were incomplete.",
      parsed
    );
  }
  return parsed;
}

function verifyCurrentMigrationContract({
  evidenceRoot,
  databasePath,
  sourceManifest,
  legacyPeople,
  expectedRuntimeMigrationMarkers = []
}) {
  const safePath = assertHarnessPath(evidenceRoot, databasePath);
  const db = new DatabaseSync(safePath);
  try {
    const applied = db
      .prepare(
        "SELECT id, COUNT(*) AS count FROM migrations GROUP BY id ORDER BY id"
      )
      .all();
    const appliedSql = applied.filter((row) => row.id.endsWith(".sql"));
    const appliedRuntimeMarkers = applied.filter(
      (row) => !row.id.endsWith(".sql")
    );
    if (
      appliedSql.length !== sourceManifest.migrationCount ||
      applied.some((row) => row.count !== 1) ||
      appliedSql.some(
        (row, index) => row.id !== sourceManifest.entries[index].name
      ) ||
      stableSerialize(appliedRuntimeMarkers.map((row) => row.id)) !==
        stableSerialize(expectedRuntimeMigrationMarkers)
    ) {
      fail(
        "migration_chain_incomplete",
        "Applied migration ledger is not the exact source chain plus preserved runtime markers."
      );
    }
    const deviceColumns = new Set(
      tableColumns(db, "forge_devices").map((column) => column.name)
    );
    for (const column of [
      "key_agreement_public_key",
      "certificate_serial",
      "certificate_hash"
    ]) {
      if (!deviceColumns.has(column)) {
        fail(
          "migration_088_contract_missing",
          `forge_devices.${column} is missing.`
        );
      }
    }
    const commandColumns = new Set(
      tableColumns(db, "peer_command_journal").map((column) => column.name)
    );
    for (const column of [
      "authorization_state",
      "approval_owner_user_id",
      "approval_deadline",
      "authorization_id",
      "authorization_state_hash",
      "quarantine_reason"
    ]) {
      if (!commandColumns.has(column)) {
        fail(
          "migration_094_contract_missing",
          `peer_command_journal.${column} is missing.`
        );
      }
    }
    for (const tableName of [
      "people",
      "peer_companion_enrollments",
      "peer_companion_enrollment_challenges",
      "peer_companion_v2_request_nonces"
    ]) {
      if (!tableExists(db, tableName)) {
        fail(
          "people_schema_missing",
          `Required People table is missing: ${tableName}`
        );
      }
    }

    let oldBinaryWriteRejected = false;
    try {
      db.prepare(
        `INSERT INTO peer_command_journal (
           command_id, owner_user_id, operation_id, target_type, target_id,
           request_hash, status, created_at, updated_at
         ) VALUES ('old_binary_unbound_command', ?, 'revokePeerRelationship',
                   'relationship', 'legacy-target', ?, 'prepared', ?, ?)`
      ).run(
        OWNER_USER_ID,
        "9".repeat(64),
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP
      );
    } catch (error) {
      oldBinaryWriteRejected = /exact current approval binding/u.test(
        error.message
      );
    }
    const oldBinaryWriteCount = db
      .prepare(
        "SELECT COUNT(*) AS count FROM peer_command_journal WHERE command_id = 'old_binary_unbound_command'"
      )
      .get().count;
    if (!oldBinaryWriteRejected || oldBinaryWriteCount !== 0) {
      fail(
        "old_binary_write_not_rejected",
        "An old-style unbound peer command was not rejected fail-closed."
      );
    }

    let legacyEvidence = null;
    if (legacyPeople) {
      const command = db
        .prepare(
          `SELECT status, attempt_count AS attemptCount, last_error AS lastError,
                  authorization_state AS authorizationState,
                  approval_owner_user_id AS approvalOwnerUserId,
                  authorization_id AS authorizationId
           FROM peer_command_journal
           WHERE command_id = 'legacy_command_without_current_authority'`
        )
        .get();
      const remoteRecord = db
        .prepare(
          `SELECT cache_state AS cacheState, query_hash AS queryHash,
                  hex(encrypted_payload) AS encryptedPayloadHex
           FROM peer_remote_records WHERE id = 'remote_record_legacy_unbound'`
        )
        .get();
      if (
        command?.status !== "failed" ||
        command?.attemptCount !== 1 ||
        command?.authorizationState !== "legacy_unverifiable" ||
        command?.approvalOwnerUserId !== null ||
        command?.authorizationId !== null ||
        remoteRecord?.cacheState !== "current" ||
        remoteRecord?.queryHash !== null
      ) {
        fail(
          "legacy_quarantine_contract_failed",
          "Legacy unbound command/cache evidence was not preserved fail-closed."
        );
      }
      legacyEvidence = {
        command,
        remoteRecord: {
          cacheState: remoteRecord.cacheState,
          queryHash: remoteRecord.queryHash,
          encryptedPayloadSha256: sha256(
            Buffer.from(remoteRecord.encryptedPayloadHex, "hex")
          )
        },
        eligibility: "ineligible_until_reauthorized_or_resynced"
      };
    }
    return {
      appliedMigrationCount: applied.length,
      appliedSqlMigrationCount: appliedSql.length,
      runtimeMigrationMarkers: appliedRuntimeMarkers.map((row) => row.id),
      requiredPeopleMigrations: PEOPLE_MIGRATIONS,
      oldBinaryWriteRejected,
      legacyEvidence
    };
  } finally {
    db.close();
  }
}

function isCanonicalDatabaseTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value) {
    return true;
  }
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)) {
    return false;
  }
  const sqliteUtc = new Date(`${value.replace(" ", "T")}Z`);
  return (
    !Number.isNaN(sqliteUtc.valueOf()) &&
    sqliteUtc.toISOString().replace("T", " ").slice(0, 19) === value
  );
}

function tableHashWithoutVolatileColumns(tableName, table, volatileColumns) {
  const volatile = new Set(volatileColumns);
  for (const column of volatile) {
    if (!table.columns.includes(column)) {
      fail(
        "repeat_upgrade_volatile_column_missing",
        `${tableName}.${column} is missing from the repeat-upgrade snapshot.`
      );
    }
  }
  const columns = table.columns.filter((column) => !volatile.has(column));
  const rows = table.rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column, row[column]]))
  );
  for (const row of table.rows) {
    for (const column of volatile) {
      const value = row[column];
      if (value !== null && !isCanonicalDatabaseTimestamp(value)) {
        fail(
          "repeat_upgrade_volatile_value_invalid",
          `${tableName}.${column} contains a non-canonical timestamp.`
        );
      }
    }
  }
  return sha256(stableSerialize({ tableName, columns, rows }));
}

function verifySnapshotsEquivalent(
  left,
  right,
  {
    compareMigrationTimestamps = false,
    volatileColumnsByTable = Object.freeze({})
  } = {}
) {
  if (
    stableSerialize(left.excludedDerivedShadowTables) !==
    stableSerialize(right.excludedDerivedShadowTables)
  ) {
    fail(
      "repeat_upgrade_shadow_table_mismatch",
      "Repeat upgrade exposed a different SQLite shadow-table set."
    );
  }
  const leftTables = Object.keys(left.tables).sort();
  const rightTables = Object.keys(right.tables).sort();
  if (stableSerialize(leftTables) !== stableSerialize(rightTables)) {
    fail(
      "repeat_upgrade_table_mismatch",
      "Repeat upgrade exposed a different table set."
    );
  }
  const volatileTableEvidence = [];
  for (const tableName of leftTables) {
    const leftTable = left.tables[tableName];
    const rightTable = right.tables[tableName];
    if (
      leftTable.rowCount !== rightTable.rowCount ||
      leftTable.logicalSha256 !== rightTable.logicalSha256
    ) {
      const volatileColumns = volatileColumnsByTable[tableName] ?? [];
      if (
        leftTable.rowCount !== rightTable.rowCount ||
        volatileColumns.length === 0 ||
        tableHashWithoutVolatileColumns(
          tableName,
          leftTable,
          volatileColumns
        ) !==
          tableHashWithoutVolatileColumns(
            tableName,
            rightTable,
            volatileColumns
          )
      ) {
        fail(
          "repeat_upgrade_hash_mismatch",
          `Repeat upgrade differs in ${tableName}.`
        );
      }
      volatileTableEvidence.push({ tableName, volatileColumns });
    }
  }
  const leftMigrations = left.migrations.map((migration) =>
    compareMigrationTimestamps ? migration : migration.id
  );
  const rightMigrations = right.migrations.map((migration) =>
    compareMigrationTimestamps ? migration : migration.id
  );
  if (stableSerialize(leftMigrations) !== stableSerialize(rightMigrations)) {
    fail(
      "repeat_upgrade_migration_ledger_mismatch",
      compareMigrationTimestamps
        ? "Idempotent rerun changed the migration ledger or application timestamps."
        : "Repeat upgrade applied a different migration ID sequence."
    );
  }
  return {
    tableCount: leftTables.length,
    excludedDerivedShadowTableCount: left.excludedDerivedShadowTables.length,
    migrationCount: leftMigrations.length,
    migrationTimestampsCompared: compareMigrationTimestamps,
    volatileTableEvidence,
    logicalSha256: sha256(
      stableSerialize(
        leftTables.map((tableName) => ({
          tableName,
          rowCount: left.tables[tableName].rowCount,
          logicalSha256: left.tables[tableName].logicalSha256
        }))
      )
    )
  };
}

function exerciseAdversarialBackups({
  evidenceRoot,
  scenarioRoot,
  backupPath,
  manifest
}) {
  const adversarialRoot = path.join(scenarioRoot, "adversarial");
  assertHarnessPath(evidenceRoot, adversarialRoot);
  mkdirSync(adversarialRoot, { recursive: true, mode: 0o700 });

  const tamperedPath = assertFreshPath(
    evidenceRoot,
    path.join(adversarialRoot, "tampered.sqlite")
  );
  copyFileSync(backupPath, tamperedPath, fsConstants.COPYFILE_EXCL);
  const tamperedDescriptor = openSync(tamperedPath, "a");
  writeSync(tamperedDescriptor, Buffer.from("tampered", "utf8"));
  closeSync(tamperedDescriptor);
  let tamperedRejected = false;
  try {
    verifyBackupManifest(evidenceRoot, tamperedPath, manifest);
  } catch (error) {
    tamperedRejected = error.code === "backup_tampered";
  }

  const interruptedPath = assertFreshPath(
    evidenceRoot,
    path.join(adversarialRoot, "interrupted.sqlite")
  );
  copyFileSync(backupPath, interruptedPath, fsConstants.COPYFILE_EXCL);
  truncateSync(
    interruptedPath,
    Math.max(1, Math.floor(manifest.backupByteSize / 2))
  );
  let interruptedRejected = false;
  try {
    verifyBackupManifest(evidenceRoot, interruptedPath, manifest);
  } catch (error) {
    interruptedRejected = error.code === "backup_tampered";
  }

  const corruptPath = assertFreshPath(
    evidenceRoot,
    path.join(adversarialRoot, "corrupt.sqlite")
  );
  copyFileSync(backupPath, corruptPath, fsConstants.COPYFILE_EXCL);
  const corruptDescriptor = openSync(corruptPath, "r+");
  writeSync(corruptDescriptor, Buffer.alloc(32, 0), 0, 32, 0);
  closeSync(corruptDescriptor);
  let corruptRejected = false;
  try {
    verifyBackupManifest(evidenceRoot, corruptPath, manifest);
  } catch (error) {
    corruptRejected = error.code === "backup_tampered";
  }

  let wrongRootRejected = false;
  try {
    assertHarnessPath(
      evidenceRoot,
      path.join(os.tmpdir(), "forge-people-wrong-root", DATABASE_FILE)
    );
  } catch (error) {
    wrongRootRejected = error.code === "path_outside_harness";
  }

  if (
    !tamperedRejected ||
    !interruptedRejected ||
    !corruptRejected ||
    !wrongRootRejected
  ) {
    fail(
      "adversarial_backup_check_failed",
      "A backup adversarial case was accepted."
    );
  }
  return {
    tamperedRejected,
    interruptedRejected,
    corruptRejected,
    wrongRootRejected,
    preservedFiles: [tamperedPath, interruptedPath, corruptPath].map(
      (filePath) => path.relative(evidenceRoot, filePath)
    )
  };
}

async function runScenario({
  evidenceRoot,
  repoRoot,
  sourceManifest,
  scenario,
  priorRelease
}) {
  const scenarioRoot = assertHarnessPath(
    evidenceRoot,
    path.join(evidenceRoot, "scenarios", scenario.id)
  );
  mkdirSync(scenarioRoot, { recursive: true, mode: 0o700 });
  const sourceRoot = path.join(scenarioRoot, "source");
  const sourceDatabase = path.join(sourceRoot, DATABASE_FILE);
  const backupPath = path.join(scenarioRoot, "backup", DATABASE_FILE);
  const restoreRoot = path.join(scenarioRoot, "restore");
  const restoreDatabase = path.join(restoreRoot, DATABASE_FILE);
  const logRoot = path.join(scenarioRoot, "logs");
  const additiveContracts = {
    ...(scenario.expectQuestionnaireSeedAdditions
      ? EXPECTED_ADDITIVE_UPGRADE_ROWS
      : {}),
    ...(scenario.expectPreferenceOwnershipBackfill
      ? EXPECTED_PREFERENCE_OWNERSHIP_BACKFILL_ROWS
      : {})
  };
  const volatileColumnsByTable = {
    ...INDEPENDENT_UPGRADE_VOLATILE_COLUMNS,
    ...(scenario.expectVolatileQuestionnaireSeedTimestamps
      ? REPEAT_UPGRADE_VOLATILE_COLUMNS
      : {}),
    ...(scenario.baselineKind === "exact_prior_runtime"
      ? PRIOR_RUNTIME_STARTUP_VOLATILE_COLUMNS
      : {}),
    ...(scenario.legacyPeople ? LEGACY_PEOPLE_READ_MODEL_VOLATILE_COLUMNS : {})
  };

  assertMigrationManifestUnchanged(sourceManifest, repoRoot);
  let fixture;
  let priorRuntime;
  if (scenario.baselineKind === "exact_prior_runtime") {
    if (!priorRelease) {
      fail(
        "prior_artifact_not_acquired",
        "Exact prior-release scenario requires the verified pinned artifact."
      );
    }
    const exactFixture = await createExactPriorReleaseFixture({
      evidenceRoot,
      dataRoot: sourceRoot,
      databasePath: sourceDatabase,
      priorRelease,
      logDirectory: logRoot,
      scenarioId: scenario.id
    });
    fixture = exactFixture.fixture;
    priorRuntime = {
      status: "passed",
      historicalExecutableClaim: true,
      ...exactFixture.priorRuntime
    };
  } else {
    fixture = {
      ...applyPriorReleaseMigrations({
        evidenceRoot,
        databasePath: sourceDatabase,
        repoRoot,
        cutoff: scenario.cutoff,
        fixtureScale: scenario.fixtureScale,
        legacyPeople: scenario.legacyPeople
      }),
      origin:
        scenario.baselineKind === "synthetic_quarantine_only"
          ? "current_source_synthetic_087_quarantine_fixture"
          : "current_source_focused_085_fixture"
    };
    priorRuntime =
      scenario.baselineKind === "synthetic_quarantine_only"
        ? {
            status: "not_available_not_claimed",
            historicalExecutableClaim: false,
            reason:
              "No pinned historical executable for the synthetic 087 boundary is available; this scenario proves only current migration quarantine behavior."
          }
        : {
            status: "focused_fixture_not_historical",
            historicalExecutableClaim: false,
            reason:
              "Focused mode uses deterministic current-source fixture construction and does not claim prior-release runtime execution."
          };
  }
  const baseline = captureDatabaseSnapshot(evidenceRoot, sourceDatabase, {
    additiveContracts
  });
  if (
    baseline.health.integrityCheck.length !== 1 ||
    baseline.health.integrityCheck[0] !== "ok" ||
    baseline.health.foreignKeyCheck.length !== 0
  ) {
    fail(
      "baseline_health_failed",
      `${scenario.id} baseline database is unhealthy.`
    );
  }
  const minimumFamilies = scenario.fixtureScale === "release" ? 12 : 5;
  if (baseline.preservationFamilyCount < minimumFamilies) {
    fail(
      "fixture_coverage_incomplete",
      `${scenario.id} covers only ${baseline.preservationFamilyCount} preservation families.`
    );
  }
  const backupManifest = copyVerifiedBackup({
    evidenceRoot,
    sourcePath: sourceDatabase,
    backupPath,
    baseline
  });

  runActualMigrationRunner({
    evidenceRoot,
    dataRoot: sourceRoot,
    repoRoot,
    label: "source-upgrade",
    logDirectory: logRoot
  });
  assertMigrationManifestUnchanged(sourceManifest, repoRoot);
  const sourcePreservation = verifyPreservedRows(
    evidenceRoot,
    sourceDatabase,
    baseline
  );
  const sourceContract = verifyCurrentMigrationContract({
    evidenceRoot,
    databasePath: sourceDatabase,
    sourceManifest,
    legacyPeople: scenario.legacyPeople,
    expectedRuntimeMigrationMarkers: baseline.migrations
      .filter((migration) => !migration.id.endsWith(".sql"))
      .map((migration) => migration.id)
  });
  const upgradedBeforeRerun = captureDatabaseSnapshot(
    evidenceRoot,
    sourceDatabase,
    { additiveContracts }
  );

  runActualMigrationRunner({
    evidenceRoot,
    dataRoot: sourceRoot,
    repoRoot,
    label: "source-idempotent-rerun",
    logDirectory: logRoot
  });
  const upgradedAfterRerun = captureDatabaseSnapshot(
    evidenceRoot,
    sourceDatabase,
    { additiveContracts }
  );
  const idempotent = verifySnapshotsEquivalent(
    upgradedBeforeRerun,
    upgradedAfterRerun,
    { compareMigrationTimestamps: true }
  );
  const sourceOperations = runPostUpgradeOperations({
    evidenceRoot,
    dataRoot: sourceRoot,
    repoRoot,
    label: "source-post-upgrade-operations",
    logDirectory: logRoot
  });

  const restoredBytes = restoreVerifiedBackup({
    evidenceRoot,
    backupPath,
    destinationPath: restoreDatabase,
    manifest: backupManifest
  });
  const restoredBaseline = captureDatabaseSnapshot(
    evidenceRoot,
    restoreDatabase,
    { additiveContracts }
  );
  let restorePreservationBaseline = baseline;
  if (
    restoredBaseline.fileSha256 !== baseline.fileSha256 ||
    restoredBaseline.preservationSha256 !== baseline.preservationSha256
  ) {
    fail(
      "restored_baseline_mismatch",
      "Restored prior-release fixture differs from source backup."
    );
  }
  if (scenario.baselineKind === "exact_prior_runtime") {
    const restoredStartup = await runExactPriorRuntime({
      evidenceRoot,
      dataRoot: restoreRoot,
      priorRelease,
      label: `${scenario.id.replaceAll(".", "-")}-prior-restored`,
      logDirectory: logRoot
    });
    const restoredPriorContract = verifyPriorReleaseDatabaseContract({
      evidenceRoot,
      databasePath: restoreDatabase,
      priorRelease
    });
    const restoredAfterPriorRuntime = captureDatabaseSnapshot(
      evidenceRoot,
      restoreDatabase,
      { additiveContracts }
    );
    priorRuntime.restoredStartup = restoredStartup;
    priorRuntime.restoredDatabaseContract = restoredPriorContract;
    priorRuntime.restoredLogicalEquivalence = verifySnapshotsEquivalent(
      restoredBaseline,
      restoredAfterPriorRuntime,
      {
        compareMigrationTimestamps: true,
        volatileColumnsByTable: PRIOR_RUNTIME_STARTUP_VOLATILE_COLUMNS
      }
    );
    restorePreservationBaseline = restoredAfterPriorRuntime;
  }
  runActualMigrationRunner({
    evidenceRoot,
    dataRoot: restoreRoot,
    repoRoot,
    label: "restored-upgrade",
    logDirectory: logRoot
  });
  assertMigrationManifestUnchanged(sourceManifest, repoRoot);
  const restorePreservation = verifyPreservedRows(
    evidenceRoot,
    restoreDatabase,
    restorePreservationBaseline
  );
  const restoreContract = verifyCurrentMigrationContract({
    evidenceRoot,
    databasePath: restoreDatabase,
    sourceManifest,
    legacyPeople: scenario.legacyPeople,
    expectedRuntimeMigrationMarkers: baseline.migrations
      .filter((migration) => !migration.id.endsWith(".sql"))
      .map((migration) => migration.id)
  });
  const restoredUpgrade = captureDatabaseSnapshot(
    evidenceRoot,
    restoreDatabase,
    { additiveContracts }
  );
  const repeatable = verifySnapshotsEquivalent(
    upgradedBeforeRerun,
    restoredUpgrade,
    { volatileColumnsByTable }
  );
  const restoreOperations = runPostUpgradeOperations({
    evidenceRoot,
    dataRoot: restoreRoot,
    repoRoot,
    label: "restored-post-upgrade-operations",
    logDirectory: logRoot
  });
  if (
    stableSerialize(sourceOperations) !== stableSerialize(restoreOperations)
  ) {
    fail(
      "repeat_operations_mismatch",
      "Restored upgrade operations differ from source upgrade."
    );
  }

  const adversarial = exerciseAdversarialBackups({
    evidenceRoot,
    scenarioRoot,
    backupPath,
    manifest: backupManifest
  });
  return {
    id: scenario.id,
    cutoff: scenario.cutoff,
    baselineKind: scenario.baselineKind,
    fixture,
    priorRuntime,
    preservationContract: {
      additiveTables: additiveContracts,
      volatileColumnsByTable
    },
    paths: {
      sourceDatabase: path.relative(evidenceRoot, sourceDatabase),
      backupDatabase: path.relative(evidenceRoot, backupPath),
      restoredDatabase: path.relative(evidenceRoot, restoreDatabase),
      logs: path.relative(evidenceRoot, logRoot)
    },
    baseline: {
      byteSize: baseline.byteSize,
      fileSha256: baseline.fileSha256,
      preservationSha256: baseline.preservationSha256,
      preservationFamilies: baseline.preservationFamilies,
      excludedDerivedShadowTables: baseline.excludedDerivedShadowTables,
      migrationCount: baseline.migrations.length,
      sqlMigrationCount: baseline.migrations.filter((migration) =>
        migration.id.endsWith(".sql")
      ).length,
      runtimeMigrationMarkers: baseline.migrations
        .filter((migration) => !migration.id.endsWith(".sql"))
        .map((migration) => migration.id),
      health: baseline.health
    },
    backupManifest,
    sourceUpgrade: {
      fileSha256BeforeRerun: upgradedBeforeRerun.fileSha256,
      fileSha256AfterRerun: upgradedAfterRerun.fileSha256,
      preservation: sourcePreservation,
      contract: sourceContract,
      idempotent,
      operations: sourceOperations,
      health: upgradedAfterRerun.health
    },
    restoredUpgrade: {
      restoredBytes,
      fileSha256AfterUpgrade: restoredUpgrade.fileSha256,
      preservation: restorePreservation,
      contract: restoreContract,
      repeatable,
      operations: restoreOperations,
      health: restoredUpgrade.health
    },
    adversarial
  };
}

function validateReleaseCoverage(
  mode,
  scenarios,
  priorRelease,
  sourceManifest
) {
  if (mode !== "release") return;
  if (
    priorRelease?.report?.status !== "verified" ||
    priorRelease.report.artifact.tarballSha256 !==
      PRIOR_RELEASE_ARTIFACT.tarballSha256 ||
    priorRelease.report.artifact.registryIntegrity !==
      PRIOR_RELEASE_ARTIFACT.registryIntegrity ||
    priorRelease.report.package.tagCommit !==
      PRIOR_RELEASE_ARTIFACT.tagCommit ||
    priorRelease.report.migrations.migrationCount !==
      PRIOR_RELEASE_ARTIFACT.migrationCount ||
    priorRelease.report.migrations.lastMigration !==
      PRIOR_RELEASE_ARTIFACT.migrationCutoff
  ) {
    fail(
      "release_coverage_incomplete",
      "Release mode requires the exact verified v0.3.32 prior artifact."
    );
  }
  if (scenarios.length !== RELEASE_SCENARIOS.length) {
    fail(
      "release_coverage_incomplete",
      `Release mode requires exactly ${RELEASE_SCENARIOS.length} scenarios.`
    );
  }
  const ids = new Set(scenarios.map((scenario) => scenario.id));
  for (const required of RELEASE_SCENARIOS) {
    if (!ids.has(required.id)) {
      fail(
        "release_coverage_incomplete",
        `Release scenario is missing: ${required.id}`
      );
    }
  }
  const isHealthy = (health) =>
    stableSerialize(health?.integrityCheck) === stableSerialize(["ok"]) &&
    Array.isArray(health?.foreignKeyCheck) &&
    health.foreignKeyCheck.length === 0;
  const isSha256 = (value) =>
    typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  const isPriorRuntimeProof = (proof) =>
    proof?.status === "passed" &&
    proof.health?.statusCode === 200 &&
    proof.health?.ok === true &&
    proof.health?.runtimePidMatched === true &&
    proof.health?.storageRootMatched === true &&
    proof.shutdown?.signalSent === "SIGTERM" &&
    proof.shutdown?.exitCode === 0 &&
    proof.shutdown?.exitSignal === null;
  for (const result of scenarios) {
    const definition = RELEASE_SCENARIOS.find(
      (scenario) => scenario.id === result.id
    );
    const sourcePreservation = result.sourceUpgrade.preservation;
    const restoredPreservation = result.restoredUpgrade.preservation;
    const expectedAdditiveEvidence = Object.entries(
      result.preservationContract.additiveTables
    )
      .map(([tableName, contract]) => ({
        tableName,
        expectedAdditiveRows: contract.rowCount,
        additiveRows: contract.rowCount
      }))
      .sort((left, right) =>
        left.tableName.localeCompare(right.tableName, "en")
      );
    const expectedVolatileEvidence = Object.entries(
      result.preservationContract.volatileColumnsByTable
    )
      .map(([tableName, volatileColumns]) => ({
        tableName,
        volatileColumns
      }))
      .sort((left, right) =>
        left.tableName.localeCompare(right.tableName, "en")
      );
    const observedVolatileEvidenceIsDeclared =
      result.restoredUpgrade.repeatable.volatileTableEvidence.every(
        ({ tableName, volatileColumns }) =>
          stableSerialize(
            result.preservationContract.volatileColumnsByTable[tableName]
          ) === stableSerialize(volatileColumns)
      );
    const sourceAdditiveEvidence = sourcePreservation.tables
      .filter((table) => !table.strictCount)
      .map(({ tableName, expectedAdditiveRows, additiveRows }) => ({
        tableName,
        expectedAdditiveRows,
        additiveRows
      }))
      .sort((left, right) =>
        left.tableName.localeCompare(right.tableName, "en")
      );
    const restoredAdditiveEvidence = restoredPreservation.tables
      .filter((table) => !table.strictCount)
      .map(({ tableName, expectedAdditiveRows, additiveRows }) => ({
        tableName,
        expectedAdditiveRows,
        additiveRows
      }))
      .sort((left, right) =>
        left.tableName.localeCompare(right.tableName, "en")
      );
    if (
      result.cutoff !== definition?.cutoff ||
      result.baselineKind !== definition?.baselineKind ||
      result.sourceUpgrade.preservation.checkedTableCount < 20 ||
      result.baseline.preservationFamilies.length < 12 ||
      result.baseline.excludedDerivedShadowTables.length === 0 ||
      !result.sourceUpgrade.contract.oldBinaryWriteRejected ||
      !result.restoredUpgrade.contract.oldBinaryWriteRejected ||
      sourcePreservation.strictTableCount !==
        sourcePreservation.checkedTableCount -
          expectedAdditiveEvidence.length ||
      restoredPreservation.strictTableCount !==
        restoredPreservation.checkedTableCount -
          expectedAdditiveEvidence.length ||
      stableSerialize(sourceAdditiveEvidence) !==
        stableSerialize(expectedAdditiveEvidence) ||
      stableSerialize(restoredAdditiveEvidence) !==
        stableSerialize(expectedAdditiveEvidence) ||
      result.sourceUpgrade.idempotent.migrationTimestampsCompared !== true ||
      result.sourceUpgrade.idempotent.volatileTableEvidence.length !== 0 ||
      result.sourceUpgrade.idempotent.excludedDerivedShadowTableCount === 0 ||
      result.sourceUpgrade.fileSha256BeforeRerun !==
        result.sourceUpgrade.fileSha256AfterRerun ||
      result.restoredUpgrade.repeatable.migrationTimestampsCompared !== false ||
      result.restoredUpgrade.repeatable.excludedDerivedShadowTableCount !==
        result.sourceUpgrade.idempotent.excludedDerivedShadowTableCount ||
      !observedVolatileEvidenceIsDeclared ||
      result.restoredUpgrade.repeatable.volatileTableEvidence.length >
        expectedVolatileEvidence.length ||
      result.sourceUpgrade.contract.appliedMigrationCount !==
        result.sourceUpgrade.idempotent.migrationCount ||
      result.sourceUpgrade.contract.appliedSqlMigrationCount !==
        sourceManifest.migrationCount ||
      result.restoredUpgrade.contract.appliedMigrationCount !==
        result.restoredUpgrade.repeatable.migrationCount ||
      result.restoredUpgrade.contract.appliedSqlMigrationCount !==
        sourceManifest.migrationCount ||
      result.backupManifest.sourceFileSha256 !== result.baseline.fileSha256 ||
      result.backupManifest.backupFileSha256 !== result.baseline.fileSha256 ||
      result.restoredUpgrade.restoredBytes.fileSha256 !==
        result.baseline.fileSha256 ||
      !isSha256(result.sourceUpgrade.fileSha256AfterRerun) ||
      !isSha256(result.restoredUpgrade.fileSha256AfterUpgrade) ||
      !isHealthy(result.baseline.health) ||
      !isHealthy(result.sourceUpgrade.health) ||
      !isHealthy(result.restoredUpgrade.health) ||
      !result.adversarial.tamperedRejected ||
      !result.adversarial.interruptedRejected ||
      !result.adversarial.corruptRejected ||
      !result.adversarial.wrongRootRejected
    ) {
      fail(
        "release_coverage_incomplete",
        `${result.id} did not meet release coverage.`
      );
    }
  }
  const legacy = scenarios.find(
    (scenario) => scenario.id === "legacy-people-087"
  );
  if (
    !legacy?.sourceUpgrade.contract.legacyEvidence ||
    !legacy?.restoredUpgrade.contract.legacyEvidence ||
    legacy.priorRuntime.status !== "not_available_not_claimed" ||
    legacy.priorRuntime.historicalExecutableClaim !== false ||
    legacy.fixture.origin !== "current_source_synthetic_087_quarantine_fixture"
  ) {
    fail(
      "release_coverage_incomplete",
      "Legacy People quarantine evidence is missing."
    );
  }
  const exact = scenarios.find(
    (scenario) => scenario.id === "released-v0.3.32-085"
  );
  if (
    exact?.fixture.origin !== "exact_published_runtime_v0.3.32" ||
    exact.fixture.sqlMigrationCount !== PRIOR_RELEASE_ARTIFACT.migrationCount ||
    exact.baseline.sqlMigrationCount !==
      PRIOR_RELEASE_ARTIFACT.migrationCount ||
    stableSerialize(exact.baseline.runtimeMigrationMarkers) !==
      stableSerialize(["runtime:legacy-wiki-markdown-import:v1"]) ||
    exact.priorRuntime.status !== "passed" ||
    exact.priorRuntime.historicalExecutableClaim !== true ||
    !isPriorRuntimeProof(exact.priorRuntime.initialStartup) ||
    !isPriorRuntimeProof(exact.priorRuntime.seededStartup) ||
    !isPriorRuntimeProof(exact.priorRuntime.restoredStartup) ||
    exact.priorRuntime.restoredDatabaseContract.sqlMigrationCount !==
      PRIOR_RELEASE_ARTIFACT.migrationCount ||
    exact.priorRuntime.restoredLogicalEquivalence
      .migrationTimestampsCompared !== true
  ) {
    fail(
      "release_coverage_incomplete",
      "Exact prior runtime startup, restore, or shutdown evidence is incomplete."
    );
  }
}

export async function runPeopleUpgradeRestoreHarness({
  mode = "release",
  requestedEvidenceRoot,
  repoRoot = defaultRepoRoot,
  outputPath = null,
  env = process.env,
  homeDir = os.homedir(),
  tempDir = os.tmpdir()
} = {}) {
  if (!new Set(["focused", "release"]).has(mode)) {
    fail("mode_invalid", "Mode must be focused or release.");
  }
  const branch = spawnSync("git", ["branch", "--show-current"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 10_000
  });
  if (branch.status !== 0 || branch.stdout.trim() !== "main") {
    fail(
      "branch_not_main",
      "People upgrade/restore evidence must run on branch main."
    );
  }

  const { evidenceRoot, protectedRootLabels, protectedRoots } =
    await createHarnessEvidenceRoot({
      requestedRoot: requestedEvidenceRoot,
      repoRoot,
      env,
      homeDir,
      tempDir
    });
  let resolvedOutputPath = null;
  if (outputPath && outputPath !== "-") {
    resolvedOutputPath = assertOutputPathAllowed(outputPath, protectedRoots);
    if (existsSync(resolvedOutputPath)) {
      fail(
        "output_exists",
        "Refusing to overwrite the requested JSON output path."
      );
    }
    if (!existsSync(path.dirname(resolvedOutputPath))) {
      fail(
        "output_parent_missing",
        "Requested JSON output parent does not exist."
      );
    }
  }
  const sourceManifest = readMigrationSourceManifest(repoRoot);
  const priorRelease =
    mode === "release"
      ? await acquirePriorReleaseArtifact({ evidenceRoot })
      : null;
  const scenarioDefinitions =
    mode === "release" ? RELEASE_SCENARIOS : FOCUSED_SCENARIOS;
  const scenarioResults = [];
  for (const scenario of scenarioDefinitions) {
    scenarioResults.push(
      await runScenario({
        evidenceRoot,
        repoRoot,
        sourceManifest,
        scenario,
        priorRelease
      })
    );
  }
  validateReleaseCoverage(mode, scenarioResults, priorRelease, sourceManifest);
  assertMigrationManifestUnchanged(sourceManifest, repoRoot);

  const exactPriorScenario = scenarioResults.find(
    (scenario) => scenario.id === "released-v0.3.32-085"
  );

  const report = {
    schemaVersion: 2,
    status: "passed",
    mode,
    generatedAt: new Date().toISOString(),
    branch: "main",
    evidenceRoot,
    canonicalDataAccess: "forbidden_and_not_attempted",
    protectedRootSources: protectedRootLabels,
    migrationSource: {
      migrationCount: sourceManifest.migrationCount,
      firstMigration: sourceManifest.firstMigration,
      lastMigration: sourceManifest.lastMigration,
      manifestSha256: sourceManifest.manifestSha256,
      peopleMigrations: PEOPLE_MIGRATIONS
    },
    priorReleaseArtifact: priorRelease?.report ?? {
      status: "not_acquired_focused_mode",
      packageSpec: PRIOR_RELEASE_ARTIFACT.packageSpec,
      verificationCoverage:
        "Focused tests exercise deterministic pinned-byte and registry-metadata verification, including missing, wrong, and tampered rejection."
    },
    scenarios: scenarioResults,
    compatibility: {
      rollback: {
        status: mode === "release" ? "proven" : "focused_evidence_only",
        evidence:
          mode === "release"
            ? "The exact v0.3.32 backup was restored byte-for-byte, reopened by the pinned prior runtime with healthy startup and clean shutdown, then upgraded independently through the current migration runner."
            : "The focused synthetic backup was restored byte-for-byte and upgraded independently; focused mode does not claim historical runtime execution."
      },
      oldBinary: {
        status:
          mode === "release"
            ? "exact_pre_upgrade_executable_evidence"
            : "not_executed_in_focused_mode",
        oldStyleWriteOutcome: "rejected_fail_closed_after_094",
        priorDatabaseRestoreOutcome: "byte_exact",
        exactPriorBinaryStartup:
          exactPriorScenario?.priorRuntime?.status ??
          "not_executed_focused_mode",
        exactPriorBinaryRestoredStartup:
          exactPriorScenario?.priorRuntime?.restoredStartup?.status ??
          "not_executed_focused_mode",
        postUpgradePriorBinaryStartup: "not_tested_or_claimed",
        reason:
          mode === "release"
            ? "Rollback compatibility is proven only for restoring the byte-exact 0.3.32 backup before starting the pinned 0.3.32 runtime. Running 0.3.32 directly against a post-094 database is not tested or claimed."
            : "Focused mode intentionally avoids network acquisition and historical runtime claims."
      },
      legacy087: {
        historicalExecutable: "not_available_not_claimed",
        evidence:
          "The separate 087 scenario is a synthetic current-source fixture used only to prove valid-row preservation and malformed legacy authorization quarantine through 088/094."
      },
      dependencyResolution: {
        historicalLockAvailable:
          priorRelease?.report?.dependencyResolution?.historicalLockAvailable ??
          false,
        caveat:
          priorRelease?.report?.dependencyResolution?.caveat ??
          "Focused mode does not resolve prior runtime dependencies."
      }
    },
    externalBlockers: []
  };

  const reportPath = path.join(evidenceRoot, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  if (resolvedOutputPath) {
    const revalidatedOutputPath = assertOutputPathAllowed(
      outputPath,
      protectedRoots
    );
    if (revalidatedOutputPath !== resolvedOutputPath) {
      fail(
        "output_path_changed",
        "Requested JSON output path changed while the harness was running."
      );
    }
    if (existsSync(revalidatedOutputPath)) {
      fail(
        "output_exists",
        "Refusing to overwrite the requested JSON output path."
      );
    }
    const outputParent = path.dirname(revalidatedOutputPath);
    if (!existsSync(outputParent)) {
      fail(
        "output_parent_missing",
        "Requested JSON output parent does not exist."
      );
    }
    await writeFile(
      revalidatedOutputPath,
      `${JSON.stringify(report, null, 2)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      }
    );
  }
  return { report, reportPath };
}

function parseArguments(argv) {
  const parsed = {
    mode: "release",
    requestedEvidenceRoot: undefined,
    outputPath: null,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const readValue = ({ allowStdout = false } = {}) => {
      const value = argv[index + 1];
      if (
        !value ||
        (value.startsWith("-") && !(allowStdout && value === "-"))
      ) {
        fail(
          "argument_value_missing",
          `${argument} requires an explicit value.`
        );
      }
      index += 1;
      return value;
    };
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
    } else if (argument === "--mode") {
      parsed.mode = readValue();
    } else if (argument === "--evidence-root") {
      parsed.requestedEvidenceRoot = readValue();
    } else if (argument === "--output") {
      parsed.outputPath = readValue({ allowStdout: true });
    } else {
      fail("argument_unknown", `Unknown argument: ${argument}`);
    }
  }
  if (
    !parsed.help &&
    (!parsed.mode || !new Set(["focused", "release"]).has(parsed.mode))
  ) {
    fail("mode_invalid", "--mode must be focused or release.");
  }
  return parsed;
}

function usage() {
  return (
    `Usage: node scripts/ci/check-people-upgrade-restore.mjs [options]\n\n` +
    `Options:\n` +
    `  --mode focused|release       Coverage level (default: release)\n` +
    `  --evidence-root PATH         Fresh ${EVIDENCE_ROOT_PREFIX}* directory under OS temp\n` +
    `  --output PATH|-              Additional JSON output path or stdout\n` +
    `  --help                       Show this help\n`
  );
}

export function serializeReportForStdout(report, outputPath) {
  return outputPath === "-" ? `${JSON.stringify(report)}\n` : null;
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      return;
    }
    const { report, reportPath } =
      await runPeopleUpgradeRestoreHarness(options);
    process.stderr.write(
      `People upgrade/restore evidence preserved at ${report.evidenceRoot}\n`
    );
    process.stderr.write(`Machine-readable report: ${reportPath}\n`);
    const stdoutPayload = serializeReportForStdout(report, options.outputPath);
    if (stdoutPayload !== null) process.stdout.write(stdoutPayload);
  } catch (error) {
    const payload = {
      status: "failed",
      code: error?.code ?? "unexpected_error",
      message: error instanceof Error ? error.message : String(error),
      details: error?.details ?? null,
      evidenceRoot: activeEvidenceRoot
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
