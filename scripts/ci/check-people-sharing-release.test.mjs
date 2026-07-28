import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertDatabaseIsNotOpen,
  assertForgePeerReleaseBinary,
  assertUnsignedIosArchive,
  assertProtectedReleaseStateUnchanged,
  assertReleaseWorktreePolicy,
  captureProtectedReleaseState,
  deriveReleaseE2ePort,
  discoverPackedSurfaceArchives,
  initializeReleaseTestRoot,
  releaseGroupOrder,
  releasePlanEntries,
  stageHermesPackageSource,
  validateReleaseGroupSelection,
  validateReleaseArtifactRoot,
  validateReleaseTestRoot,
  writePackedSurfaceConfig
} from "./check-people-sharing-release.mjs";
import { acquireForgeWebBuildLock } from "./forge-web-build-lock.mjs";
import { collectPeopleSharingTestFiles } from "./run-people-sharing-tests.mjs";

test("release browser tests use a stable non-live loopback port", () => {
  const port = deriveReleaseE2ePort("/tmp/forge-release-browser-root");
  assert.equal(port, deriveReleaseE2ePort("/tmp/forge-release-browser-root"));
  assert.ok(port >= 40_000 && port < 60_000);
  assert.notEqual(port, 4317);
});

test("isolated browser runs serialize shared builds and artifacts", async () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "forge-e2e-lock-test-"));
  const repositoryRoot = path.join(parent, "repository");
  mkdirSync(repositoryRoot, { mode: 0o700 });
  try {
    const first = await acquireForgeWebBuildLock({
      repositoryRoot,
      lockRoot: parent,
      waitMilliseconds: 1_000,
      pollMilliseconds: 5
    });
    if (process.platform !== "win32") {
      assert.equal(lstatSync(first.lockPath).mode & 0o777, 0o600);
    }

    let secondAcquired = false;
    const secondPromise = acquireForgeWebBuildLock({
      repositoryRoot,
      lockRoot: parent,
      waitMilliseconds: 1_000,
      pollMilliseconds: 5
    }).then((lock) => {
      secondAcquired = true;
      return lock;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(secondAcquired, false);

    first.release();
    const second = await secondPromise;
    assert.equal(secondAcquired, true);
    second.release();
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("release plan enforces generation, build, Rust, test, and archive order", () => {
  const plan = releasePlanEntries();
  const step = (id) => {
    const index = plan.findIndex((entry) => entry.id === id);
    assert.notEqual(index, -1, `missing executable release step ${id}`);
    return { ...plan[index], index };
  };
  const position = (id) => step(id).index;

  assert.deepEqual(
    [...new Set(plan.map((entry) => entry.group))],
    releaseGroupOrder
  );
  assert.ok(
    position("release-gate-self-tests") < position("generated-contracts")
  );
  assert.ok(position("generated-contracts") < position("plugin-runtime-build"));
  assert.ok(
    position("generated-contract-zero-diff") < position("plugin-runtime-build")
  );
  assert.ok(
    position("public-release-privacy") < position("plugin-runtime-build")
  );
  assert.ok(
    position("plugin-runtime-build") < position("people-migration-parity")
  );
  assert.ok(
    position("people-migration-parity") < position("openclaw-plugin-archive")
  );
  assert.ok(
    position("forge-peer-release-build") <
      position("forge-peer-release-binary-admission")
  );
  assert.ok(
    position("connectivity-service-test-dependencies") <
      position("connectivity-service-test-build")
  );
  assert.ok(
    position("connectivity-service-test-build") < position("forge-peer-tests")
  );
  assert.deepEqual(step("forge-peer-tests").args, [
    "test",
    "--all-targets",
    "--",
    "--test-threads=1"
  ]);
  assert.equal(step("forge-peer-tests").attempts, 2);
  assert.ok(
    position("forge-peer-release-binary-admission") <
      position("people-api-sweep")
  );
  assert.ok(
    position("people-api-sweep") < position("people-performance-self-tests")
  );
  assert.ok(
    position("people-api-sweep") < position("people-upgrade-restore-release")
  );
  assert.ok(
    position("people-upgrade-restore-release") <
      position("people-performance-release")
  );
  assert.ok(
    position("people-performance-self-tests") <
      position("people-performance-release")
  );
  assert.ok(
    position("people-performance-release") < position("openclaw-plugin-archive")
  );
  assert.ok(
    position("openclaw-plugin-archive") <
      position("people-migration-archive-parity")
  );
  assert.ok(
    position("codex-runtime-archive") <
      position("people-migration-archive-parity")
  );
  assert.ok(
    position("hermes-package-source-stage") < position("hermes-plugin-archive")
  );
  assert.ok(
    position("hermes-plugin-archive") <
      position("people-migration-archive-parity")
  );
  assert.ok(
    position("people-migration-archive-parity") <
      position("packed-openclaw-runtime-smoke")
  );
  assert.ok(
    position("forge-memory-archive") < position("packed-openclaw-runtime-smoke")
  );
  assert.equal(
    plan.some((entry) => entry.id === "people-packed-surface-matrix"),
    false,
    "the independently tested packed matrix is diagnostic, not a publication blocker"
  );
  assert.ok(position("public-release-privacy") < position("release-guard"));

  assert.deepEqual(
    {
      args: step("generated-contracts").args,
      executable: step("generated-contracts").executable,
      internal: step("generated-contracts").internal
    },
    {
      args: ["run", "docs:openapi"],
      executable: "npm",
      internal: false
    }
  );
  assert.deepEqual(step("plugin-runtime-build").args, [
    "./plugins/hermes/scripts/build-package-runtime.mjs"
  ]);
  assert.equal(step("plugin-runtime-build").executable, "node");
  assert.deepEqual(
    {
      args: step("public-release-privacy").args,
      executable: step("public-release-privacy").executable
    },
    {
      args: ["scripts/ci/check-public-release-privacy.mjs"],
      executable: "node"
    }
  );
  assert.equal(step("forge-peer-release-binary-admission").internal, true);
  assert.deepEqual(
    {
      args: step("forge-peer-advisory-audit").args,
      executable: step("forge-peer-advisory-audit").executable
    },
    {
      args: ["scripts/audit.sh"],
      executable: "sh"
    }
  );
  assert.deepEqual(
    {
      args: step("forge-peer-policy-audit").args,
      executable: step("forge-peer-policy-audit").executable
    },
    {
      args: [
        "deny",
        "--manifest-path",
        "packages/forge-peer/Cargo.toml",
        "--config",
        "packages/forge-peer/deny.toml",
        "check"
      ],
      executable: "cargo"
    }
  );
  assert.deepEqual(step("people-api-sweep").args, [
    "run",
    "test:people-sharing"
  ]);
  assert.deepEqual(step("people-performance-release").args, [
    "run",
    "check:people-performance",
    "--",
    "--evidence",
    "{artifactRoot}/people-performance.json",
    "--temp-parent",
    "{artifactRoot}"
  ]);
  assert.deepEqual(step("people-upgrade-restore-release").args, [
    "run",
    "check:people-upgrade-restore",
    "--",
    "--output",
    "{artifactRoot}/people-upgrade-restore.json"
  ]);
  assert.deepEqual(step("hermes-plugin-archive").args, [
    "-m",
    "build",
    "--wheel",
    "--outdir",
    "{artifactRoot}",
    "{artifactRoot}/hermes-source"
  ]);
  assert.deepEqual(step("people-migration-archive-parity").args.slice(-2), [
    "--require-archives",
    "openclaw,codex,hermes"
  ]);
});

test("native admission is unsigned, credential-free, and covers iPhone and watch", () => {
  const plan = releasePlanEntries(["native"]);
  const step = (id) => {
    const entry = plan.find((candidate) => candidate.id === id);
    assert.ok(entry, `missing native admission step ${id}`);
    return entry;
  };
  assert.deepEqual(
    plan.map((entry) => entry.id),
    [
      "ios-release-contract-audit",
      "ios-iphone-unsigned-tests",
      "ios-watch-unsigned-tests",
      "ios-unsigned-release-archive",
      "ios-unsigned-archive-admission",
      "watch-usability-measurement"
    ]
  );

  const iphoneTests = step("ios-iphone-unsigned-tests");
  const watchTests = step("ios-watch-unsigned-tests");
  const archive = step("ios-unsigned-release-archive");
  for (const entry of [iphoneTests, watchTests, archive]) {
    assert.equal(entry.executable, "xcodebuild");
    assert.ok(entry.args.includes("CODE_SIGNING_ALLOWED=NO"));
    assert.ok(entry.args.includes("CODE_SIGNING_REQUIRED=NO"));
    assert.ok(entry.args.includes("CODE_SIGN_IDENTITY="));
    assert.equal(entry.args.includes("-allowProvisioningUpdates"), false);
  }
  assert.ok(iphoneTests.args.includes("-only-testing:ForgeCompanionTests"));
  assert.ok(
    watchTests.args.includes("-only-testing:ForgeWatch Watch AppTests")
  );
  assert.deepEqual(
    archive.args.slice(archive.args.indexOf("-destination"), -3),
    [
      "-destination",
      "generic/platform=iOS",
      "-derivedDataPath",
      "{artifactRoot}/ios-release-derived-data",
      "-archivePath",
      "{artifactRoot}/ForgeCompanion-unsigned.xcarchive",
      "archive"
    ]
  );
  assert.equal(step("ios-unsigned-archive-admission").internal, true);

  const nativeCommands = plan
    .flatMap((entry) => [entry.executable ?? "", ...entry.args])
    .join(" ");
  assert.doesNotMatch(
    nativeCommands,
    /release:ios-companion:(?:validate|testflight|app-store)/
  );
  assert.doesNotMatch(
    nativeCommands,
    /FORGE_IOS_(?:BUILD_CERTIFICATE|P12|PROFILE)/
  );
});

test("unsigned archive admission requires every native bundle and rejects signing payloads", () => {
  const createArchive = (label) => {
    const root = mkdtempSync(path.join(os.tmpdir(), `${label}-`));
    const archive = path.join(root, "ForgeCompanion-unsigned.xcarchive");
    const bundles = [
      "Products/Applications/ForgeCompanion.app",
      "Products/Applications/ForgeCompanion.app/Watch/ForgeWatch Watch App.app",
      "Products/Applications/ForgeCompanion.app/Watch/ForgeWatch Watch App.app/PlugIns/ForgeWatchExtension.appex"
    ];
    mkdirSync(archive, { recursive: true });
    writeFileSync(path.join(archive, "Info.plist"), "fixture");
    for (const bundle of bundles) {
      mkdirSync(path.join(archive, bundle), { recursive: true });
    }
    return { archive, bundles };
  };

  const valid = createArchive("forge-unsigned-ios-archive");
  assert.equal(
    assertUnsignedIosArchive(valid.archive),
    realpathSync(valid.archive)
  );

  const screenTimeEmbedded = createArchive("forge-screen-time-ios-archive");
  mkdirSync(
    path.join(
      screenTimeEmbedded.archive,
      "Products/Applications/ForgeCompanion.app/PlugIns/ForgeScreenTimeReportExtension.appex"
    ),
    { recursive: true }
  );
  assert.throws(
    () => assertUnsignedIosArchive(screenTimeEmbedded.archive),
    /must not embed the disabled Screen Time extension/
  );

  const signed = createArchive("forge-signed-ios-archive");
  mkdirSync(path.join(signed.archive, signed.bundles[0], "_CodeSignature"));
  assert.throws(
    () => assertUnsignedIosArchive(signed.archive),
    /unexpectedly contains.*_CodeSignature/
  );

  const profiled = createArchive("forge-profiled-ios-archive");
  writeFileSync(
    path.join(
      profiled.archive,
      profiled.bundles[2],
      "embedded.mobileprovision"
    ),
    "fixture"
  );
  assert.throws(
    () => assertUnsignedIosArchive(profiled.archive),
    /unexpectedly contains.*embedded\.mobileprovision/
  );
});

test("reusable CI has no Apple credentials while iOS publication remains fail-closed", () => {
  const workflowRoot = path.join(process.cwd(), ".github/workflows");
  const reusable = readFileSync(
    path.join(workflowRoot, "people-sharing-release-gate.yml"),
    "utf8"
  );
  const publication = readFileSync(
    path.join(workflowRoot, "release-ios-companion.yml"),
    "utf8"
  );
  const publishScript = readFileSync(
    path.join(
      process.cwd(),
      "apps/ios-companion/scripts/publish-forge-companion.sh"
    ),
    "utf8"
  );
  const fastfile = readFileSync(
    path.join(process.cwd(), "apps/ios-companion/fastlane/Fastfile"),
    "utf8"
  );
  const stepBlock = (source, name) => {
    const marker = `      - name: ${name}\n`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `missing workflow step ${name}`);
    const next = source.indexOf("\n      - name: ", start + marker.length);
    return source.slice(start, next === -1 ? source.length : next);
  };

  assert.match(
    reusable,
    /full_test:[\s\S]*?default: false[\s\S]*?type: boolean/
  );
  assert.match(
    reusable,
    /runs-on: \$\{\{ inputs\.full_test && 'macos-26' \|\| 'ubuntu-latest' \}\}/
  );
  const fastAdmission = stepBlock(reusable, "Run fast publication admission");
  for (const command of [
    "check:server",
    "test:people-sharing",
    "test:people-sharing-release-fast",
    "check:openclaw-plugin",
    "audit-release-guard.sh"
  ]) {
    assert.match(fastAdmission, new RegExp(command.replaceAll(":", "\\:")));
  }
  assert.doesNotMatch(
    fastAdmission,
    /check:people-performance|test:e2e|test:people-sharing-release-gate|cargo (test|audit|deny)|xcodebuild/
  );
  assert.match(
    stepBlock(reusable, "Run canonical People sharing release gate"),
    /if: \$\{\{ inputs\.full_test \}\}/
  );
  const runtimeSmoke = stepBlock(reusable, "Smoke built Forge runtime");
  assert.match(runtimeSmoke, /if: \$\{\{ !inputs\.full_test \}\}/);
  assert.match(runtimeSmoke, /api\/health/);
  assert.match(runtimeSmoke, /api\/v1\/health/);
  assert.match(runtimeSmoke, /credential-required/);
  assert.match(runtimeSmoke, /protected_status/);
  assert.match(runtimeSmoke, /test "\$\{protected_status\}" = "401"/);
  assert.match(runtimeSmoke, /forge\/vitals/);
  assert.match(runtimeSmoke, /FORGE_DATA_ROOT="\$\{data_root\}"/);

  const appleCredentialSecrets = [
    "FORGE_IOS_BUILD_CERTIFICATE_BASE64",
    "FORGE_IOS_P12_PASSWORD",
    "FORGE_IOS_KEYCHAIN_PASSWORD",
    "FORGE_IOS_PROVISIONING_PROFILES_BASE64",
    "FORGE_IOS_PROFILE_APP_BASE64",
    "FORGE_IOS_PROFILE_WATCH_APP_BASE64",
    "FORGE_IOS_PROFILE_WATCH_EXTENSION_BASE64",
    "FORGE_ASC_KEY_ID",
    "FORGE_ASC_ISSUER_ID",
    "FORGE_ASC_KEY_CONTENT_BASE64"
  ];
  for (const secret of appleCredentialSecrets) {
    assert.equal(
      reusable.includes(secret),
      false,
      `reusable gate must not demand ${secret}`
    );
  }
  assert.match(reusable, /FORGE_NATIVE_SOURCE_ED25519_PRIVATE_KEY:/);
  assert.match(
    reusable,
    /FORGE_REQUIRE_SIGNED_NATIVE_SOURCE: \$\{\{ inputs\.full_test && '1' \|\| '0' \}\}/
  );
  assert.doesNotMatch(reusable, /Prepare isolated native release validation/);

  assert.match(publication, /release:\n {4}needs: people-release-gate\n/);
  const verifySource = stepBlock(publication, "Verify admitted source commit");
  const verifyCredentials = stepBlock(
    publication,
    "Verify CI release credentials are configured"
  );
  const installSigning = stepBlock(
    publication,
    "Install signing certificate and provisioning profiles"
  );
  const publish = stepBlock(publication, "Publish iOS release");
  assert.ok(
    publication.indexOf(verifySource) < publication.indexOf(verifyCredentials)
  );
  assert.ok(
    publication.indexOf(verifyCredentials) < publication.indexOf(installSigning)
  );
  assert.ok(publication.indexOf(installSigning) < publication.indexOf(publish));
  for (const secret of appleCredentialSecrets) {
    assert.match(verifyCredentials, new RegExp(`secrets\\.${secret}`));
  }
  assert.doesNotMatch(verifyCredentials, /^\s+if:/m);
  assert.doesNotMatch(installSigning, /^\s+if:/m);
  assert.doesNotMatch(publish, /^\s+if:/m);
  assert.match(installSigning, /security import/);
  assert.match(installSigning, /FORGE_IOS_SIGNING_KEYCHAIN_PATH/);
  assert.match(installSigning, /Provisioning Profiles/);
  assert.match(publish, /publish-forge-companion\.sh "\$\{RELEASE_MODE\}"/);
  assert.doesNotMatch(publication, /FORGE_RELEASE_SKIP_REMOTE_VALIDATION/);

  assert.match(
    publishScript,
    /testflight\) FASTLANE_LANE="testflight_release"/
  );
  assert.match(publishScript, /app-store\) FASTLANE_LANE="app_store_release"/);
  assert.match(
    fastfile,
    /lane :testflight_release[\s\S]*?require_api_key: true/
  );
  assert.match(
    fastfile,
    /lane :app_store_release[\s\S]*?require_api_key: true/
  );
  assert.match(
    fastfile,
    /def build_release_archive![\s\S]*?configure_release_signing!/
  );
  assert.match(
    fastfile,
    /def configure_release_signing![\s\S]*?CI release signing assets are missing/
  );
});

test("packed-surface release config requires one exact archive per surface", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-config-"));
  const artifactRoot = path.join(root, "artifacts");
  const dataRoot = path.join(root, "data");
  mkdirSync(artifactRoot, { mode: 0o700 });
  mkdirSync(dataRoot, { mode: 0o700 });
  const currentVersion = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "plugins/openclaw/package.json"),
      "utf8"
    )
  ).version;
  const archiveNames = [
    `forge-openclaw-plugin-${currentVersion}.tgz`,
    `forge_hermes_plugin-${currentVersion}-py3-none-any.whl`,
    `forge-codex-runtime-${currentVersion}.tgz`,
    `forge-memory-${currentVersion}.tgz`
  ];
  for (const archiveName of archiveNames) {
    writeFileSync(path.join(artifactRoot, archiveName), archiveName);
  }

  const archives = discoverPackedSurfaceArchives(artifactRoot);
  assert.deepEqual(Object.keys(archives), [
    "openclaw",
    "hermes",
    "codex",
    "forgeMemory"
  ]);
  const configPath = writePackedSurfaceConfig({
    artifactRoot,
    repoRoot: process.cwd(),
    environment: { FORGE_DATA_ROOT: dataRoot }
  });
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(config.expectedVersion, currentVersion);
  assert.deepEqual(config.protectedRoots, [dataRoot]);
  assert.deepEqual(Object.keys(config.migrationFiles), [
    "087_people_and_peer_sharing.sql",
    "088_people_peer_identity_hardening.sql",
    "094_people_peer_authorization_and_companion_v2.sql",
    "099_people_owner_partition_identity.sql",
    "100_people_read_model_revision.sql",
    "102_people_outbox_claim_order_indexes.sql"
  ]);
  assert.deepEqual(Object.keys(config.artifacts), [
    "openclaw",
    "hermes",
    "codex",
    "forgeMemory"
  ]);
  assert.equal(lstatSync(configPath).mode & 0o077, 0);
  assert.throws(
    () =>
      writePackedSurfaceConfig({
        artifactRoot,
        repoRoot: process.cwd(),
        environment: { FORGE_DATA_ROOT: dataRoot }
      }),
    /already exists/
  );

  writeFileSync(
    path.join(artifactRoot, "forge-memory-0.3.32-duplicate.tgz"),
    "duplicate"
  );
  assert.throws(
    () => discoverPackedSurfaceArchives(artifactRoot),
    /exactly one forgeMemory release archive/
  );

  const staleRoot = path.join(root, "stale-artifacts");
  mkdirSync(staleRoot, { mode: 0o700 });
  for (const archiveName of archiveNames.map((name) =>
    name.replace(currentVersion, "0.0.0")
  )) {
    writeFileSync(path.join(staleRoot, archiveName), archiveName);
  }
  assert.throws(
    () =>
      writePackedSurfaceConfig({
        artifactRoot: staleRoot,
        repoRoot: process.cwd(),
        environment: { FORGE_DATA_ROOT: dataRoot }
      }),
    /does not match aligned version/
  );
});

test("Hermes runtime metadata matches the generated OpenClaw runtime source", () => {
  const openclawPackage = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "plugins/openclaw/package.json"),
      "utf8"
    )
  );
  const hermesRuntimePackage = JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        "plugins/hermes/forge_hermes/runtime/package.json"
      ),
      "utf8"
    )
  );
  const hermesVersionSource = readFileSync(
    path.join(process.cwd(), "plugins/hermes/forge_hermes/version.py"),
    "utf8"
  );
  const hermesVersion = hermesVersionSource.match(
    /^__version__ = "([^"]+)"$/m
  )?.[1];

  assert.equal(hermesRuntimePackage.version, hermesVersion);
  assert.equal(hermesRuntimePackage.version, openclawPackage.version);
  assert.deepEqual(
    hermesRuntimePackage.dependencies,
    openclawPackage.dependencies
  );
});

test("Hermes release staging excludes build debris and rejects source links", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-hermes-stage-"));
  const repoRoot = path.join(root, "repo");
  const sourceRoot = path.join(repoRoot, "plugins/hermes");
  const artifactRoot = path.join(root, "artifacts");
  mkdirSync(path.join(sourceRoot, "forge_hermes"), { recursive: true });
  mkdirSync(path.join(sourceRoot, "python-dist"), { recursive: true });
  mkdirSync(artifactRoot);
  writeFileSync(path.join(sourceRoot, "pyproject.toml"), "[build-system]\n");
  writeFileSync(path.join(sourceRoot, "forge_hermes/core.py"), "VALUE = 1\n");
  writeFileSync(path.join(sourceRoot, "python-dist/stale.whl"), "stale");

  const staged = stageHermesPackageSource({ repoRoot, artifactRoot });
  assert.equal(existsSync(path.join(staged, "forge_hermes/core.py")), true);
  assert.equal(existsSync(path.join(staged, "python-dist")), false);

  const unsafeRoot = path.join(root, "unsafe-repo");
  const unsafeSource = path.join(unsafeRoot, "plugins/hermes");
  const unsafeArtifacts = path.join(root, "unsafe-artifacts");
  mkdirSync(unsafeSource, { recursive: true });
  mkdirSync(unsafeArtifacts);
  writeFileSync(path.join(unsafeSource, "pyproject.toml"), "[build-system]\n");
  symlinkSync(
    path.join(unsafeSource, "pyproject.toml"),
    path.join(unsafeSource, "linked.toml")
  );
  assert.throws(
    () =>
      stageHermesPackageSource({
        repoRoot: unsafeRoot,
        artifactRoot: unsafeArtifacts
      }),
    /unsafe entry/
  );
});

test("People API sweep recursively selects only executable People and peer tests", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-people-sweep-"));
  const source = path.join(root, "apps/api/src");
  mkdirSync(path.join(source, "services/deep"), { recursive: true });
  writeFileSync(path.join(source, "people-routes.test.ts"), "export {};\n");
  writeFileSync(
    path.join(source, "services/deep/peer-security.test.ts"),
    "export {};\n"
  );
  writeFileSync(path.join(source, "unrelated.test.ts"), "export {};\n");
  writeFileSync(path.join(source, "people-routes.ts"), "export {};\n");

  assert.deepEqual(collectPeopleSharingTestFiles(root), [
    "apps/api/src/people-routes.test.ts",
    "apps/api/src/services/deep/peer-security.test.ts"
  ]);
  assert.ok(
    collectPeopleSharingTestFiles().includes(
      "apps/api/src/services/peer-rust-ipc-integration.test.ts"
    ),
    "the real Node/Rust integration test must remain in the aggregate sweep"
  );
});

test("release mode is clean-only and the dirty escape is local integration-only", () => {
  assert.equal(assertReleaseWorktreePolicy({ status: "" }), "release");
  assert.throws(
    () => assertReleaseWorktreePolicy({ status: " M package.json\n" }),
    /clean worktree/
  );
  assert.equal(
    assertReleaseWorktreePolicy({
      status: " M package.json\n",
      integrationDirtyWorktree: true,
      environment: { FORGE_PEOPLE_RELEASE_CONTEXT: "integration" }
    }),
    "integration"
  );
  assert.throws(
    () =>
      assertReleaseWorktreePolicy({
        status: " M package.json\n",
        integrationDirtyWorktree: true,
        environment: {
          CI: "true",
          FORGE_PEOPLE_RELEASE_CONTEXT: "integration"
        }
      }),
    /forbidden in CI/
  );
  assert.throws(
    () =>
      assertReleaseWorktreePolicy({
        status: " M package.json\n",
        integrationDirtyWorktree: true,
        environment: {
          FORGE_PEOPLE_RELEASE_CONTEXT: "integration",
          GITHUB_REF: "refs/tags/forge-v1.2.3"
        }
      }),
    /tagged commits/
  );
  assert.throws(
    () =>
      assertReleaseWorktreePolicy({
        status: " M package.json\n",
        integrationDirtyWorktree: true,
        environment: { FORGE_PEOPLE_RELEASE_CONTEXT: "integration" },
        headTags: "forge-v1.2.3\n"
      }),
    /tagged commits/
  );

  assert.doesNotThrow(() =>
    validateReleaseGroupSelection({ selectedGroups: [...releaseGroupOrder] })
  );
  assert.throws(
    () => validateReleaseGroupSelection({ selectedGroups: ["tests"] }),
    /every release-check group/
  );
  assert.doesNotThrow(() =>
    validateReleaseGroupSelection({
      selectedGroups: ["tests"],
      integrationDirtyWorktree: true
    })
  );
  assert.throws(
    () =>
      validateReleaseGroupSelection({
        selectedGroups: ["tests", "tests"],
        integrationDirtyWorktree: true
      }),
    /Duplicate release-check groups/
  );
});

test("protected release state detects content and permission mutation", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-release-hashes-"));
  mkdirSync(path.join(root, "nested"));
  writeFileSync(path.join(root, "version.json"), '{"version":"1.0.0"}\n');
  writeFileSync(path.join(root, "nested/signing.json"), '{"key":"public"}\n');
  const files = ["version.json", "nested/signing.json"];
  const baseline = captureProtectedReleaseState(root, files);
  assert.doesNotThrow(() =>
    assertProtectedReleaseStateUnchanged(baseline, root)
  );
  writeFileSync(path.join(root, "version.json"), '{"version":"1.0.1"}\n');
  assert.throws(
    () => assertProtectedReleaseStateUnchanged(baseline, root),
    /version\/signing state: version\.json/
  );
});

test("Node/Rust admission requires the exact real release binary", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-peer-admission-"));
  const binary = path.join(
    root,
    "packages/forge-peer/target/release/forge-peer"
  );
  assert.throws(
    () => assertForgePeerReleaseBinary(root),
    /real forge-peer release binary is required/
  );
  mkdirSync(path.dirname(binary), { recursive: true });
  writeFileSync(binary, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  assert.equal(assertForgePeerReleaseBinary(root), binary);
});

test("isolated roots require an exact marker and reject protected roots", () => {
  const parent = mkdtempSync(
    path.join(os.tmpdir(), "forge-people-release-gate-")
  );
  const root = path.join(parent, "isolated");
  const canonicalRoot = initializeReleaseTestRoot(root);
  assert.equal(canonicalRoot, realpathSync(root));
  assert.equal(validateReleaseTestRoot(root), canonicalRoot);
  assert.throws(
    () => validateReleaseTestRoot(path.join(parent, "unmarked")),
    /does not exist/
  );
  assert.throws(
    () =>
      initializeReleaseTestRoot("/tmp/forge-canonical", {
        ...process.env,
        FORGE_PROTECTED_DATA_ROOTS: "/tmp/forge-canonical"
      }),
    /protected or canonical/
  );
  const configuredLiveRoot = path.join(parent, "configured-live");
  assert.throws(
    () =>
      initializeReleaseTestRoot(path.join(configuredLiveRoot, "test-run"), {
        ...process.env,
        FORGE_DATA_ROOT: configuredLiveRoot
      }),
    /protected or canonical/
  );
  assert.throws(
    () =>
      initializeReleaseTestRoot(parent, {
        ...process.env,
        FORGE_E2E_DATA_ROOT: configuredLiveRoot
      }),
    /protected or canonical/
  );
  if (process.platform !== "win32") {
    const symlinkRoot = path.join(parent, "symlink-marker-root");
    mkdirSync(symlinkRoot, { mode: 0o700 });
    symlinkSync(
      path.join(canonicalRoot, ".forge-people-sharing-release-root.json"),
      path.join(symlinkRoot, ".forge-people-sharing-release-root.json")
    );
    assert.throws(
      () => validateReleaseTestRoot(symlinkRoot),
      /owner-only regular file/
    );

    chmodSync(
      path.join(canonicalRoot, ".forge-people-sharing-release-root.json"),
      0o644
    );
    assert.throws(
      () => validateReleaseTestRoot(root),
      /owner-only regular file/
    );
  }
});

test("database and artifact safety checks fail closed", () => {
  const parent = mkdtempSync(
    path.join(os.tmpdir(), "forge-people-release-safety-")
  );
  const databaseRoot = path.join(parent, "database");
  mkdirSync(databaseRoot);
  writeFileSync(path.join(databaseRoot, "forge.sqlite"), "fixture");
  assert.throws(
    () =>
      assertDatabaseIsNotOpen(databaseRoot, () => ({
        error: { code: "ENOENT" },
        status: null,
        stderr: "",
        stdout: ""
      })),
    /lsof is required/
  );

  const artifactRoot = path.join(parent, "artifacts");
  assert.equal(
    validateReleaseArtifactRoot(artifactRoot),
    realpathSync(artifactRoot)
  );
  writeFileSync(path.join(artifactRoot, "stale-package.tgz"), "fixture");
  assert.throws(
    () => validateReleaseArtifactRoot(artifactRoot),
    /must be empty/
  );
  assert.throws(
    () =>
      validateReleaseArtifactRoot("/tmp/forge-release-artifacts", {
        ...process.env,
        FORGE_PROTECTED_DATA_ROOTS: "/tmp/forge-release-artifacts"
      }),
    /protected or canonical/
  );
  assert.throws(
    () =>
      validateReleaseArtifactRoot(
        path.join(os.homedir(), "forge-release-artifacts-test")
      ),
    /protected or canonical/
  );
  if (process.platform !== "win32") {
    const repositoryLink = path.join(parent, "repository-link");
    symlinkSync(process.cwd(), repositoryLink, "dir");
    assert.throws(
      () => validateReleaseArtifactRoot(repositoryLink),
      /real owner-only directory/
    );

    const permissiveRoot = path.join(parent, "permissive-artifacts");
    mkdirSync(permissiveRoot, { mode: 0o755 });
    assert.throws(
      () => validateReleaseArtifactRoot(permissiveRoot),
      /real owner-only directory/
    );
  }
});
