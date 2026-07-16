#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PEOPLE_PACKED_MIGRATIONS } from "../smoke/people-packed-surfaces.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
const markerName = ".forge-people-sharing-release-root.json";
const markerSchema = "forge-people-sharing-release-root/1";
const packedSurfaceArchivePatterns = Object.freeze({
  openclaw: /^forge-openclaw-plugin-.*\.tgz$/,
  hermes: /^forge[_-]hermes[_-]plugin-.*\.whl$/,
  codex: /^forge-codex-runtime-.*\.tgz$/,
  forgeMemory: /^forge-memory-.*\.tgz$/
});
const iosProjectPath = "apps/ios-companion/ForgeCompanion.xcodeproj";
const unsignedIosArchiveName = "ForgeCompanion-unsigned.xcarchive";
const unsignedXcodeSigningOverrides = Object.freeze([
  "CODE_SIGNING_ALLOWED=NO",
  "CODE_SIGNING_REQUIRED=NO",
  "CODE_SIGN_IDENTITY="
]);
export const releaseGroupOrder = Object.freeze([
  "contracts",
  "static",
  "runtimeParity",
  "rust",
  "tests",
  "packages",
  "native",
  "release"
]);

export const protectedReleaseFiles = Object.freeze([
  "package.json",
  "package-lock.json",
  "plugins/openclaw/package.json",
  "plugins/openclaw/package-lock.json",
  "plugins/openclaw/openclaw.plugin.json",
  "plugins/openclaw/scripts/native-source-signing-key.mjs",
  "plugins/codex/runtime/package.json",
  "plugins/hermes/plugin.yaml",
  "plugins/hermes/pyproject.toml",
  "plugins/hermes/forge_hermes/version.py",
  "plugins/hermes/forge_hermes/runtime/package.json",
  "packages/forge-memory/package.json",
  "packages/forge-memory/package-lock.json",
  "packages/forge-memory/lib/native-source-manifest.mjs",
  "packages/forge-connectivity-service/package.json",
  "packages/forge-connectivity-service/package-lock.json",
  "packages/forge-connectivity-service/src/version.ts",
  "packages/forge-connectivity-service/openapi/openapi.json",
  "packages/forge-connectivity-service/Dockerfile",
  "apps/ios-companion/project.yml",
  "apps/ios-companion/ForgeCompanion.xcodeproj/project.pbxproj",
  "apps/ios-companion/fastlane/Appfile",
  "apps/ios-companion/fastlane/Fastfile",
  "apps/ios-companion/ForgeCompanion/Info.plist",
  "apps/ios-companion/ForgeCompanion/ForgeCompanion/Info.plist",
  "apps/ios-companion/ForgeCompanion/ForgeCompanion/ForgeCompanion.entitlements",
  "apps/ios-companion/ForgeCompanion/ForgeScreenTimeReportExtension/Info.plist",
  "apps/ios-companion/ForgeCompanion/ForgeScreenTimeReportExtension/ForgeScreenTimeReportExtension.entitlements",
  "apps/ios-companion/ForgeCompanion/ForgeWatch/Info.plist",
  "apps/ios-companion/ForgeCompanion/ForgeWatchExtension.entitlements",
  "apps/ios-companion/ForgeCompanion/ForgeWatch Watch App/ForgeWatch Watch App.entitlements"
]);

function command(label, executable, args, options = {}) {
  const id =
    options.id ??
    label
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "");
  return { label, executable, args, ...options, id };
}

function internalCommand(label, run, options = {}) {
  return command(label, null, [], { ...options, run });
}

const groups = Object.freeze({
  contracts: [
    command(
      "release gate self-tests",
      "npm",
      ["run", "test:people-sharing-release-gate"],
      { id: "release-gate-self-tests" }
    ),
    command(
      "generated OpenAPI and agent contracts",
      "npm",
      ["run", "docs:openapi"],
      {
        generatedContracts: true,
        id: "generated-contracts"
      }
    ),
    command(
      "generated contract zero-diff",
      "git",
      [
        "diff",
        "--exit-code",
        "--",
        "plugins/openclaw/docs/openapi.json",
        "plugins/openclaw/docs/api/openapi.json",
        "plugins/openclaw/docs/agent-tools.json"
      ],
      { id: "generated-contract-zero-diff" }
    ),
    command(
      "public release privacy gate",
      "node",
      ["scripts/ci/check-public-release-privacy.mjs"],
      { id: "public-release-privacy" }
    )
  ],
  static: [
    command("server typecheck", "npm", [
      "run",
      "check:server",
      "--",
      "--pretty",
      "false"
    ]),
    command("web typecheck", "npm", [
      "run",
      "check",
      "--",
      "--pretty",
      "false"
    ]),
    command("repository lint", "npm", ["run", "lint"]),
    command("web production build", "npm", ["run", "build"]),
    command("OpenClaw contract tests", "npm", ["run", "check:openclaw-plugin"]),
    command("OpenClaw conversational contract tests", "npm", [
      "--prefix",
      "plugins/openclaw",
      "run",
      "test:contracts"
    ]),
    command(
      "OpenClaw, Codex, and Hermes packaged runtime build",
      "node",
      ["./plugins/hermes/scripts/build-package-runtime.mjs"],
      { id: "plugin-runtime-build" }
    )
  ],
  runtimeParity: [
    command(
      "People package migration parity",
      "npm",
      ["run", "check:people-sharing-migration-parity"],
      { id: "people-migration-parity" }
    )
  ],
  tests: [
    internalCommand(
      "forge-peer release binary admission",
      (context) => assertForgePeerReleaseBinary(context.repoRoot),
      { id: "forge-peer-release-binary-admission" }
    ),
    command(
      "People and peer-sharing API sweep",
      "npm",
      ["run", "test:people-sharing"],
      { id: "people-api-sweep" }
    ),
    command("web/unit suite", "npm", ["run", "test"]),
    command("server suite", "npm", ["run", "test:server"]),
    command("browser suite", "npm", ["run", "test:e2e"]),
    command(
      "People exact prior-release upgrade and restore proof",
      "npm",
      [
        "run",
        "check:people-upgrade-restore",
        "--",
        "--output",
        "{artifactRoot}/people-upgrade-restore.json"
      ],
      { id: "people-upgrade-restore-release" }
    ),
    command(
      "People performance contract self-tests",
      "npm",
      ["run", "test:people-performance"],
      { id: "people-performance-self-tests" }
    ),
    command(
      "People 10,000-record release performance profile",
      "npm",
      [
        "run",
        "check:people-performance",
        "--",
        "--evidence",
        "{artifactRoot}/people-performance.json",
        "--temp-parent",
        "{artifactRoot}"
      ],
      { id: "people-performance-release" }
    )
  ],
  packages: [
    command("Hermes plugin tests", "python3", ["-m", "pytest", "-q", "tests"], {
      cwd: "plugins/hermes"
    }),
    command("Hermes Python compilation", "python3", [
      "-m",
      "compileall",
      "-q",
      "plugins/hermes/__init__.py",
      "plugins/hermes/forge_hermes"
    ]),
    command("Codex MCP bridge tests", "node", [
      "--test",
      "plugins/codex/scripts/mcp-response.test.mjs",
      "plugins/codex/scripts/people-peer-mcp.test.mjs"
    ]),
    command("Forge Memory suite", "npm", ["run", "test:forge-memory"]),
    command("Forge Memory archive", "npm", [
      "pack",
      "./packages/forge-memory",
      "--pack-destination",
      "{artifactRoot}"
    ]),
    command("connectivity service verification", "npm", [
      "run",
      "verify:connectivity-service"
    ]),
    command("connectivity service advisory audit", "npm", [
      "run",
      "audit:connectivity-service"
    ]),
    command("connectivity service archive", "npm", [
      "pack",
      "./packages/forge-connectivity-service",
      "--pack-destination",
      "{artifactRoot}"
    ]),
    command(
      "OpenClaw plugin archive",
      "npm",
      ["pack", "./plugins/openclaw", "--pack-destination", "{artifactRoot}"],
      { id: "openclaw-plugin-archive" }
    ),
    command(
      "Codex runtime archive",
      "npm",
      [
        "pack",
        "./plugins/codex/runtime",
        "--pack-destination",
        "{artifactRoot}"
      ],
      { id: "codex-runtime-archive" }
    ),
    internalCommand(
      "Hermes isolated package-source stage",
      (context) => stageHermesPackageSource(context),
      { id: "hermes-package-source-stage" }
    ),
    command(
      "Hermes plugin wheel archive",
      "python3",
      [
        "-m",
        "build",
        "--wheel",
        "--outdir",
        "{artifactRoot}",
        "{artifactRoot}/hermes-source"
      ],
      { id: "hermes-plugin-archive" }
    ),
    command(
      "People packaged migration archive parity",
      "node",
      [
        "./scripts/ci/check-people-sharing-migration-parity.mjs",
        "--archive-root",
        "{artifactRoot}",
        "--require-archives",
        "openclaw,codex,hermes"
      ],
      { id: "people-migration-archive-parity" }
    ),
    internalCommand(
      "People packed-surface matrix configuration",
      (context) => writePackedSurfaceConfig(context),
      { id: "people-packed-surface-config" }
    ),
    command(
      "People packed OpenClaw, Hermes, Codex, and Forge Memory matrix",
      "node",
      [
        "./scripts/smoke/people-packed-surfaces.mjs",
        "--config",
        "{artifactRoot}/people-packed-surfaces.json",
        "--output",
        "{artifactRoot}/people-packed-surfaces-result.json"
      ],
      { id: "people-packed-surface-matrix" }
    ),
    command("packed OpenClaw runtime smoke", "npm", [
      "run",
      "smoke:packed-openclaw-runtime"
    ])
  ],
  rust: [
    command("companion-iroh format", "cargo", ["fmt", "--", "--check"], {
      cwd: "packages/companion-iroh"
    }),
    command(
      "companion-iroh all-target check",
      "cargo",
      ["check", "--all-targets"],
      { cwd: "packages/companion-iroh" }
    ),
    command(
      "companion-iroh clippy",
      "cargo",
      ["clippy", "--all-targets", "--all-features", "--", "-D", "warnings"],
      { cwd: "packages/companion-iroh" }
    ),
    command("companion-iroh tests", "cargo", ["test", "--all-targets"], {
      cwd: "packages/companion-iroh"
    }),
    command("companion-iroh doc tests", "cargo", ["test", "--doc"], {
      cwd: "packages/companion-iroh"
    }),
    command("companion-iroh release build", "cargo", ["build", "--release"], {
      cwd: "packages/companion-iroh"
    }),
    command("companion-iroh advisory audit", "cargo", ["audit"], {
      cwd: "packages/companion-iroh"
    }),
    command("companion-iroh policy audit", "cargo", [
      "deny",
      "--manifest-path",
      "packages/companion-iroh/Cargo.toml",
      "--config",
      "deny.toml",
      "check"
    ]),
    command("forge-peer format", "cargo", ["fmt", "--", "--check"], {
      cwd: "packages/forge-peer"
    }),
    command(
      "forge-peer all-target check",
      "cargo",
      ["check", "--all-targets"],
      {
        cwd: "packages/forge-peer"
      }
    ),
    command(
      "forge-peer clippy",
      "cargo",
      ["clippy", "--all-targets", "--all-features", "--", "-D", "warnings"],
      { cwd: "packages/forge-peer" }
    ),
    command("forge-peer tests", "cargo", ["test", "--all-targets"], {
      cwd: "packages/forge-peer"
    }),
    command("forge-peer doc tests", "cargo", ["test", "--doc"], {
      cwd: "packages/forge-peer"
    }),
    command("forge-peer release build", "cargo", ["build", "--release"], {
      cwd: "packages/forge-peer",
      id: "forge-peer-release-build"
    }),
    command("forge-peer advisory audit", "sh", ["scripts/audit.sh"], {
      cwd: "packages/forge-peer"
    }),
    command("forge-peer policy audit", "cargo", [
      "deny",
      "--manifest-path",
      "packages/forge-peer/Cargo.toml",
      "--config",
      "deny.toml",
      "check"
    ])
  ],
  native: [
    command(
      "iPhone/watch release audit",
      "npm",
      ["run", "release:ios-companion:audit"],
      { id: "ios-release-contract-audit" }
    ),
    command(
      "iPhone unsigned simulator tests",
      "xcodebuild",
      [
        "-project",
        iosProjectPath,
        "-scheme",
        "ForgeCompanion",
        "-configuration",
        "Debug",
        "-destination",
        "platform=iOS Simulator,name=iPhone 17 Pro,OS=latest",
        "-derivedDataPath",
        "{artifactRoot}/ios-test-derived-data",
        "-resultBundlePath",
        "{artifactRoot}/ForgeCompanionTests.xcresult",
        "-only-testing:ForgeCompanionTests",
        "test",
        ...unsignedXcodeSigningOverrides
      ],
      { id: "ios-iphone-unsigned-tests" }
    ),
    command(
      "watchOS unsigned simulator tests",
      "xcodebuild",
      [
        "-project",
        iosProjectPath,
        "-scheme",
        "ForgeWatch Watch App",
        "-configuration",
        "Debug",
        "-destination",
        "platform=watchOS Simulator,name=Apple Watch Series 11 (46mm),OS=latest",
        "-derivedDataPath",
        "{artifactRoot}/watch-test-derived-data",
        "-resultBundlePath",
        "{artifactRoot}/ForgeWatchTests.xcresult",
        "-only-testing:ForgeWatch Watch AppTests",
        "test",
        ...unsignedXcodeSigningOverrides
      ],
      { id: "ios-watch-unsigned-tests" }
    ),
    command(
      "iPhone/watch unsigned Release archive",
      "xcodebuild",
      [
        "-project",
        iosProjectPath,
        "-scheme",
        "ForgeCompanion",
        "-configuration",
        "Release",
        "-destination",
        "generic/platform=iOS",
        "-derivedDataPath",
        "{artifactRoot}/ios-release-derived-data",
        "-archivePath",
        `{artifactRoot}/${unsignedIosArchiveName}`,
        "archive",
        ...unsignedXcodeSigningOverrides
      ],
      { id: "ios-unsigned-release-archive" }
    ),
    internalCommand(
      "unsigned iPhone/watch archive admission",
      (context) =>
        assertUnsignedIosArchive(
          path.join(context.artifactRoot, unsignedIosArchiveName)
        ),
      { id: "ios-unsigned-archive-admission" }
    ),
    command("watch usability measurement", "npm", ["run", "measure:watchos"], {
      id: "watch-usability-measurement"
    })
  ],
  release: [
    command("release guard", "bash", [
      "./scripts/release/audit-release-guard.sh"
    ])
  ]
});

function fail(message) {
  throw new Error(message);
}

function readPackageVersion(root, relativePath) {
  const payload = JSON.parse(
    readFileSync(path.join(root, relativePath), "utf8")
  );
  if (typeof payload.version !== "string" || payload.version.length === 0) {
    fail(`${relativePath} has no package version.`);
  }
  return payload.version;
}

function alignedPackedSurfaceVersion(root) {
  const hermesVersionSource = readFileSync(
    path.join(root, "plugins/hermes/forge_hermes/version.py"),
    "utf8"
  );
  const hermesVersion = hermesVersionSource.match(
    /^__version__ = "([^"]+)"$/m
  )?.[1];
  if (!hermesVersion) {
    fail("plugins/hermes/forge_hermes/version.py has no package version.");
  }
  const versions = Object.freeze({
    openclaw: readPackageVersion(root, "plugins/openclaw/package.json"),
    hermes: hermesVersion,
    codex: readPackageVersion(root, "plugins/codex/runtime/package.json"),
    forgeMemory: readPackageVersion(root, "packages/forge-memory/package.json")
  });
  const uniqueVersions = [...new Set(Object.values(versions))];
  if (uniqueVersions.length !== 1) {
    fail(
      `Packed surface versions are not aligned: ${Object.entries(versions)
        .map(([surface, version]) => `${surface}=${version}`)
        .join(", ")}`
    );
  }
  return uniqueVersions[0];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertPackedArchiveVersions(archives, expectedVersion) {
  const version = escapeRegExp(expectedVersion);
  const patterns = {
    openclaw: new RegExp(`^forge-openclaw-plugin-${version}\\.tgz$`),
    hermes: new RegExp(`^forge[_-]hermes[_-]plugin-${version}-[^/]+\\.whl$`),
    codex: new RegExp(`^forge-codex-runtime-${version}\\.tgz$`),
    forgeMemory: new RegExp(`^forge-memory-${version}\\.tgz$`)
  };
  for (const [surface, archive] of Object.entries(archives)) {
    if (!patterns[surface].test(path.basename(archive))) {
      fail(
        `${surface} release archive does not match aligned version ${expectedVersion}.`
      );
    }
  }
}

export function discoverPackedSurfaceArchives(artifactRoot) {
  const entries = readdirSync(artifactRoot).sort();
  return Object.fromEntries(
    Object.entries(packedSurfaceArchivePatterns).map(([surface, pattern]) => {
      const matches = entries.filter((entry) => pattern.test(entry));
      if (matches.length !== 1) {
        fail(
          `Expected exactly one ${surface} release archive, found ${matches.length}.`
        );
      }
      const archivePath = path.join(artifactRoot, matches[0]);
      const metadata = lstatSync(archivePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        fail(`${surface} release archive must be a regular file.`);
      }
      return [surface, realpathSync(archivePath)];
    })
  );
}

export function stageHermesPackageSource(context) {
  const sourceRoot = path.join(context.repoRoot, "plugins/hermes");
  const targetRoot = path.join(context.artifactRoot, "hermes-source");
  if (existsSync(targetRoot)) {
    fail("Hermes package-source stage already exists.");
  }
  const excludedNames = new Set([
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".venv",
    "__pycache__",
    "build",
    "node_modules",
    "python-dist"
  ]);
  cpSync(sourceRoot, targetRoot, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    filter(sourcePath) {
      const relativePath = path.relative(sourceRoot, sourcePath);
      if (relativePath) {
        const segments = relativePath.split(path.sep);
        if (
          segments.some(
            (segment) =>
              excludedNames.has(segment) || segment.endsWith(".egg-info")
          ) ||
          relativePath.endsWith(".pyc")
        ) {
          return false;
        }
      }
      const metadata = lstatSync(sourcePath);
      if (
        metadata.isSymbolicLink() ||
        (!metadata.isDirectory() && !metadata.isFile())
      ) {
        fail(`Hermes package source contains an unsafe entry: ${sourcePath}`);
      }
      return true;
    }
  });
  return targetRoot;
}

export function writePackedSurfaceConfig(context) {
  const configPath = path.join(
    context.artifactRoot,
    "people-packed-surfaces.json"
  );
  if (existsSync(configPath)) {
    fail("Packed-surface matrix configuration already exists.");
  }
  const dataRoot = context.environment.FORGE_DATA_ROOT;
  if (typeof dataRoot !== "string" || !path.isAbsolute(dataRoot)) {
    fail("Packed-surface matrix requires an absolute isolated data root.");
  }
  const archives = discoverPackedSurfaceArchives(context.artifactRoot);
  const expectedVersion = alignedPackedSurfaceVersion(context.repoRoot);
  assertPackedArchiveVersions(archives, expectedVersion);
  const config = {
    schemaVersion: 1,
    expectedVersion,
    evidenceRoot: path.join(
      context.artifactRoot,
      "people-packed-surfaces-evidence"
    ),
    protectedRoots: [dataRoot],
    migrationFiles: Object.fromEntries(
      PEOPLE_PACKED_MIGRATIONS.map((migration) => [
        migration,
        path.join(context.repoRoot, "apps/api/migrations", migration)
      ])
    ),
    artifacts: Object.fromEntries(
      Object.entries(archives).map(([surface, archive]) => [
        surface,
        { archive }
      ])
    ),
    timeouts: {
      commandMs: 10 * 60_000,
      runtimeMs: 120_000,
      stopMs: 5_000
    }
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  return configPath;
}

function isWithin(candidate, boundary) {
  const relative = path.relative(boundary, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function knownProtectedRoots(environment = process.env) {
  const home = os.homedir();
  const configured = (environment.FORGE_PROTECTED_DATA_ROOTS ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const configuredDataRoots = [
    environment.FORGE_DATA_ROOT,
    environment.FORGE_E2E_DATA_ROOT
  ]
    .map((entry) => entry?.trim())
    .filter(Boolean);
  return [
    home,
    path.resolve(repoRoot, "../../data/forge"),
    path.join(home, ".forge"),
    path.join(home, ".openclaw", "forge"),
    path.join(home, ".local", "share", "forge"),
    path.join(home, "Library", "Application Support", "Forge"),
    path.resolve(repoRoot, "../../private/forge-backups"),
    ...configuredDataRoots.map((entry) => path.resolve(entry)),
    ...configured.map((entry) => path.resolve(entry))
  ];
}

function assertUnprotectedRoot(candidate, environment = process.env) {
  if (!path.isAbsolute(candidate)) {
    fail("The release test root must be an absolute path.");
  }
  const resolved = path.resolve(candidate);
  for (const protectedRoot of knownProtectedRoots(environment)) {
    if (
      isWithin(resolved, protectedRoot) ||
      isWithin(protectedRoot, resolved)
    ) {
      fail(`Refusing protected or canonical Forge data root: ${resolved}`);
    }
  }
  return resolved;
}

export function initializeReleaseTestRoot(
  candidate,
  environment = process.env
) {
  const resolved = assertUnprotectedRoot(candidate, environment);
  if (existsSync(resolved) && readdirSync(resolved).length > 0) {
    fail("Release test root initialization requires an empty directory.");
  }
  mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const canonicalRoot = realpathSync(resolved);
  const marker = {
    schema: markerSchema,
    purpose: "isolated Forge People sharing release verification",
    root: canonicalRoot,
    allowMutation: true
  };
  writeFileSync(
    path.join(canonicalRoot, markerName),
    `${JSON.stringify(marker, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" }
  );
  return canonicalRoot;
}

export function assertDatabaseIsNotOpen(root, spawn = spawnSync) {
  const databasePath = path.join(root, "forge.sqlite");
  if (!existsSync(databasePath)) return;
  const probe = spawn("lsof", ["-Fn", "--", databasePath], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (probe.error?.code === "ENOENT") {
    fail("lsof is required to prove the release test database is closed.");
  }
  if (probe.status !== 0 && probe.status !== 1) {
    fail(
      `Could not prove the release test database is closed: ${probe.stderr.trim()}`
    );
  }
  if (probe.status === 0 && probe.stdout.trim()) {
    fail("Release test database is open by another process.");
  }
}

export function validateReleaseTestRoot(candidate, environment = process.env) {
  const resolved = assertUnprotectedRoot(candidate, environment);
  if (!existsSync(resolved)) fail("Release test root does not exist.");
  const canonicalRoot = realpathSync(resolved);
  assertUnprotectedRoot(canonicalRoot, environment);
  const markerPath = path.join(canonicalRoot, markerName);
  if (!existsSync(markerPath)) {
    fail(`Release test root is missing ${markerName}.`);
  }
  const markerMetadata = lstatSync(markerPath);
  const insecureUnixMetadata =
    process.platform !== "win32" &&
    ((typeof process.getuid === "function" &&
      markerMetadata.uid !== process.getuid()) ||
      (markerMetadata.mode & 0o077) !== 0);
  if (
    !markerMetadata.isFile() ||
    markerMetadata.isSymbolicLink() ||
    insecureUnixMetadata
  ) {
    fail("Release test root marker must be an owner-only regular file.");
  }
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  if (
    marker.schema !== markerSchema ||
    marker.purpose !== "isolated Forge People sharing release verification" ||
    marker.root !== canonicalRoot ||
    marker.allowMutation !== true
  ) {
    fail(
      "Release test root marker does not match the exact isolated-root contract."
    );
  }
  assertDatabaseIsNotOpen(canonicalRoot);
  return canonicalRoot;
}

export function validateReleaseArtifactRoot(
  candidate,
  environment = process.env
) {
  if (!candidate || !path.isAbsolute(candidate)) {
    fail("FORGE_PEOPLE_RELEASE_ARTIFACT_ROOT must be an absolute path.");
  }
  const resolved = assertUnprotectedRoot(candidate, environment);
  if (isWithin(resolved, repoRoot)) {
    fail("Release artifacts must be written outside the Forge repository.");
  }
  if (existsSync(resolved)) {
    const metadata = lstatSync(resolved);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      fail("Release artifact root must be a real owner-only directory.");
    }
    if (readdirSync(resolved).length > 0) {
      fail("Release artifact root must be empty to prevent stale packages.");
    }
  } else {
    mkdirSync(resolved, { recursive: true, mode: 0o700 });
  }
  const canonicalRoot = realpathSync(resolved);
  assertUnprotectedRoot(canonicalRoot, environment);
  if (isWithin(canonicalRoot, repoRoot)) {
    fail("Release artifacts must resolve outside the Forge repository.");
  }
  const metadata = lstatSync(canonicalRoot);
  const insecureUnixMetadata =
    process.platform !== "win32" &&
    ((typeof process.getuid === "function" &&
      metadata.uid !== process.getuid()) ||
      (metadata.mode & 0o077) !== 0);
  if (!metadata.isDirectory() || insecureUnixMetadata) {
    fail("Release artifact root must be a real owner-only directory.");
  }
  return canonicalRoot;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function captureProtectedReleaseState(
  root = repoRoot,
  relativePaths = protectedReleaseFiles
) {
  const state = {};
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(root, relativePath);
    let metadata;
    try {
      metadata = lstatSync(absolutePath);
    } catch (error) {
      fail(
        `Protected release file is missing: ${relativePath} (${error.message})`
      );
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`Protected release path must be a regular file: ${relativePath}`);
    }
    state[relativePath] = Object.freeze({
      mode: metadata.mode & 0o777,
      sha256: sha256(readFileSync(absolutePath)),
      size: metadata.size
    });
  }
  return Object.freeze(state);
}

export function assertProtectedReleaseStateUnchanged(
  baseline,
  root = repoRoot
) {
  const current = captureProtectedReleaseState(root, Object.keys(baseline));
  const changed = Object.keys(baseline).filter((relativePath) => {
    const before = baseline[relativePath];
    const after = current[relativePath];
    return (
      before.mode !== after.mode ||
      before.size !== after.size ||
      before.sha256 !== after.sha256
    );
  });
  if (changed.length > 0) {
    fail(
      `Release validation changed protected version/signing state: ${changed.join(", ")}`
    );
  }
}

export function assertUnsignedIosArchive(candidate) {
  const requiredDirectories = [
    "Products/Applications/ForgeCompanion.app",
    "Products/Applications/ForgeCompanion.app/PlugIns/ForgeScreenTimeReportExtension.appex",
    "Products/Applications/ForgeCompanion.app/Watch/ForgeWatch Watch App.app",
    "Products/Applications/ForgeCompanion.app/Watch/ForgeWatch Watch App.app/PlugIns/ForgeWatchExtension.appex"
  ];
  const archiveMetadata = lstatSync(candidate);
  if (!archiveMetadata.isDirectory() || archiveMetadata.isSymbolicLink()) {
    fail("Unsigned iOS admission output must be a real xcarchive directory.");
  }
  const canonicalArchive = realpathSync(candidate);
  const archivePlist = path.join(canonicalArchive, "Info.plist");
  const plistMetadata = lstatSync(archivePlist);
  if (!plistMetadata.isFile() || plistMetadata.isSymbolicLink()) {
    fail("Unsigned iOS admission archive must contain a real Info.plist.");
  }

  for (const relativePath of requiredDirectories) {
    const bundlePath = path.join(canonicalArchive, relativePath);
    const metadata = lstatSync(bundlePath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      fail(`Unsigned iOS admission archive is missing ${relativePath}.`);
    }
    for (const signingPayload of [
      "_CodeSignature",
      "embedded.mobileprovision"
    ]) {
      if (existsSync(path.join(bundlePath, signingPayload))) {
        fail(
          `Unsigned iOS admission archive unexpectedly contains ${relativePath}/${signingPayload}.`
        );
      }
    }
  }
  return canonicalArchive;
}

function isTruthyEnvironmentValue(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function hasReleaseWorkflowSignal(environment) {
  const githubRef = String(environment.GITHUB_REF ?? "");
  const githubRefType = String(environment.GITHUB_REF_TYPE ?? "").toLowerCase();
  const githubEvent = String(environment.GITHUB_EVENT_NAME ?? "").toLowerCase();
  const releaseMode = String(environment.FORGE_RELEASE_MODE ?? "")
    .trim()
    .toLowerCase();
  return (
    githubRef.startsWith("refs/tags/") ||
    githubRefType === "tag" ||
    githubEvent === "release" ||
    releaseMode === "full" ||
    releaseMode === "prepare" ||
    releaseMode === "publish-from-tag"
  );
}

export function assertReleaseWorktreePolicy({
  status,
  integrationDirtyWorktree = false,
  environment = process.env,
  headTags = ""
}) {
  if (integrationDirtyWorktree) {
    if (environment.FORGE_PEOPLE_RELEASE_CONTEXT !== "integration") {
      fail(
        "--integration-dirty-worktree requires FORGE_PEOPLE_RELEASE_CONTEXT=integration."
      );
    }
    if (
      isTruthyEnvironmentValue(environment.CI) ||
      hasReleaseWorkflowSignal(environment) ||
      headTags.trim()
    ) {
      fail(
        "The dirty-worktree integration escape is forbidden in CI, on tagged commits, and in release workflows."
      );
    }
    return "integration";
  }
  if (status.trim()) {
    fail(`People release checks require a clean worktree:\n${status.trim()}`);
  }
  return "release";
}

export function validateReleaseGroupSelection({
  selectedGroups,
  integrationDirtyWorktree = false
}) {
  const duplicates = selectedGroups.filter(
    (group, index) => selectedGroups.indexOf(group) !== index
  );
  if (duplicates.length > 0) {
    fail(
      `Duplicate release-check groups: ${[...new Set(duplicates)].join(", ")}`
    );
  }
  if (!integrationDirtyWorktree) {
    const exactReleasePlan =
      selectedGroups.length === releaseGroupOrder.length &&
      selectedGroups.every(
        (group, index) => group === releaseGroupOrder[index]
      );
    if (!exactReleasePlan) {
      fail(
        "True release mode must execute every release-check group in canonical order. Use the local integration escape only for bounded dirty-worktree diagnosis."
      );
    }
  }
}

function currentWorktreeStatus() {
  return execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );
}

function currentHeadTags() {
  return execFileSync("git", ["tag", "--points-at", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

export function assertForgePeerReleaseBinary(root = repoRoot) {
  const binaryPath = path.join(
    root,
    "packages/forge-peer/target/release/forge-peer"
  );
  let metadata;
  try {
    metadata = lstatSync(binaryPath);
    accessSync(binaryPath, fsConstants.R_OK | fsConstants.X_OK);
  } catch (error) {
    fail(
      `The real forge-peer release binary is required before Node/Rust integration tests: ${binaryPath} (${error.message})`
    );
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(
      `forge-peer release binary must be a regular executable: ${binaryPath}`
    );
  }
  return binaryPath;
}

function parseArguments(argv) {
  const options = {
    integrationDirtyWorktree: false,
    plan: false,
    selectedGroups: [...releaseGroupOrder]
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--plan") options.plan = true;
    else if (argument === "--integration-dirty-worktree") {
      options.integrationDirtyWorktree = true;
    } else if (argument === "--groups") {
      const value = argv[++index];
      if (!value) fail("--groups requires a comma-separated value.");
      options.selectedGroups = value.split(",").filter(Boolean);
    } else if (argument.startsWith("--groups=")) {
      options.selectedGroups = argument
        .slice("--groups=".length)
        .split(",")
        .filter(Boolean);
    } else if (argument === "--initialize-root") {
      const value = argv[++index];
      if (!value) fail("--initialize-root requires an absolute path.");
      options.initializeRoot = value;
    } else {
      fail(`Unknown argument: ${argument}`);
    }
  }
  for (const group of options.selectedGroups) {
    if (!(group in groups)) fail(`Unknown release-check group: ${group}`);
  }
  return options;
}

function currentBranch() {
  return execFileSync("git", ["branch", "--show-current"], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim();
}

function contractTimestamp() {
  const payload = JSON.parse(
    readFileSync(
      path.join(repoRoot, "plugins/openclaw/docs/agent-tools.json"),
      "utf8"
    )
  );
  if (typeof payload.generatedAt !== "string") {
    fail("The existing agent-tools contract has no generatedAt timestamp.");
  }
  return payload.generatedAt;
}

function materialize(entry, context) {
  return {
    ...entry,
    cwd: path.resolve(context.repoRoot, entry.cwd ?? "."),
    args: entry.args.map((argument) =>
      argument.replaceAll("{artifactRoot}", context.artifactRoot)
    ),
    environment: {
      ...(entry.environment ?? {}),
      ...(entry.generatedContracts
        ? { FORGE_DOCS_GENERATED_AT: contractTimestamp() }
        : {})
    }
  };
}

function runEntry(entry, context) {
  const resolved = materialize(entry, context);
  process.stdout.write(`\n==> ${resolved.label}\n`);
  if (resolved.run) {
    resolved.run(context);
    return;
  }
  const child = spawnSync(resolved.executable, resolved.args, {
    cwd: resolved.cwd,
    env: { ...process.env, ...context.environment, ...resolved.environment },
    stdio: "inherit"
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    fail(`${resolved.label} failed with exit code ${child.status}.`);
  }
}

export function releasePlanEntries(selectedGroups = releaseGroupOrder) {
  return selectedGroups.flatMap((group) =>
    groups[group].map((entry) => ({
      args: [...entry.args],
      executable: entry.executable,
      group,
      id: entry.id,
      internal: typeof entry.run === "function",
      label: entry.label
    }))
  );
}

export function releasePlan(selectedGroups = releaseGroupOrder) {
  return releasePlanEntries(selectedGroups).map(
    (entry) => `${entry.group}: ${entry.label}`
  );
}

function runGroup(group, context, protectedBaseline) {
  let commandError;
  try {
    for (const entry of groups[group]) runEntry(entry, context);
  } catch (error) {
    commandError = error;
  }

  let protectionError;
  try {
    assertProtectedReleaseStateUnchanged(protectedBaseline, context.repoRoot);
  } catch (error) {
    protectionError = error;
  }

  if (commandError && protectionError) {
    throw new AggregateError(
      [commandError, protectionError],
      `${group} failed and changed protected release state.`
    );
  }
  if (protectionError) throw protectionError;
  if (commandError) throw commandError;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.initializeRoot) {
    process.stdout.write(
      `${initializeReleaseTestRoot(options.initializeRoot)}\n`
    );
    return;
  }
  if (currentBranch() !== "main")
    fail("People release checks must run on main.");
  if (options.plan) {
    process.stdout.write(`${releasePlan(options.selectedGroups).join("\n")}\n`);
    return;
  }

  validateReleaseGroupSelection(options);
  const initialStatus = currentWorktreeStatus();
  const releaseMode = assertReleaseWorktreePolicy({
    status: initialStatus,
    integrationDirtyWorktree: options.integrationDirtyWorktree,
    headTags: currentHeadTags()
  });

  const dataRoot = validateReleaseTestRoot(
    process.env.FORGE_PEOPLE_RELEASE_DATA_ROOT ?? ""
  );
  const canonicalArtifactRoot = validateReleaseArtifactRoot(
    process.env.FORGE_PEOPLE_RELEASE_ARTIFACT_ROOT
  );

  const context = {
    artifactRoot: canonicalArtifactRoot,
    repoRoot,
    environment: {
      FORGE_DATA_ROOT: dataRoot,
      FORGE_E2E_DATA_ROOT: dataRoot,
      FORGE_PEOPLE_RELEASE_DATA_ROOT: dataRoot,
      FORGE_PEOPLE_RELEASE_GATE_MODE: releaseMode,
      FORGE_PEER_BINARY_PATH: path.join(
        repoRoot,
        "packages/forge-peer/target/release/forge-peer"
      )
    }
  };
  const protectedBaseline = captureProtectedReleaseState();
  for (const group of options.selectedGroups) {
    runGroup(group, context, protectedBaseline);
  }
  if (releaseMode === "release") {
    assertReleaseWorktreePolicy({ status: currentWorktreeStatus() });
  }
  process.stdout.write("\nForge People sharing release checks passed.\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `ERROR: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
