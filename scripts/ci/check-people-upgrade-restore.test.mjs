import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EVIDENCE_ROOT_PREFIX,
  HARNESS_MARKER_FILE,
  PEOPLE_MIGRATIONS,
  PRIOR_RELEASE_ARTIFACT,
  assertHarnessPath,
  assertOutputPathAllowed,
  createHarnessEvidenceRoot,
  defaultRepoRoot,
  isCanonicalDatabaseTimestamp,
  observedVolatileEvidenceIsDeclaredSubset,
  runPeopleUpgradeRestoreHarness,
  serializeReportForStdout,
  verifyBackupManifest,
  verifyPriorReleaseArtifactBytes,
  verifyPriorReleaseRegistryMetadata,
  verifySnapshotsEquivalent
} from "./check-people-upgrade-restore.mjs";

const VOLATILE_OWNERSHIP_COLUMNS = Object.freeze({
  user_ownership_defaults: ["created_at", "updated_at"]
});

function digest(bytes, algorithm, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function parseCliFailure(stderr, expectedCode) {
  for (const line of stderr.split(/\r?\n/u)) {
    try {
      const candidate = JSON.parse(line);
      if (candidate?.code === expectedCode) return candidate;
    } catch {
      // Node may emit runtime warnings before or after the machine-readable line.
    }
  }
  return null;
}

function makeRepeatUpgradeSnapshot({
  tableName = "user_ownership_defaults",
  ownerUserId = "user_owner",
  createdAt = "2026-08-19 23:26:08",
  updatedAt = "2026-08-19 23:26:08",
  rowCount = 1
} = {}) {
  const row = {
    subject_user_id: "user_subject",
    owner_user_id: ownerUserId,
    updated_by_actor: null,
    created_at: createdAt,
    updated_at: updatedAt
  };
  return {
    excludedDerivedShadowTables: [],
    tables: {
      [tableName]: {
        rowCount,
        logicalSha256: digest(JSON.stringify(row), "sha256", "hex"),
        columns: Object.keys(row),
        rows: [row]
      }
    },
    migrations: []
  };
}

test("canonical database timestamps accept only exact UTC representations", () => {
  assert.equal(isCanonicalDatabaseTimestamp("2026-08-19T23:26:08.000Z"), true);
  assert.equal(isCanonicalDatabaseTimestamp("2026-08-19 23:26:08"), true);
  for (const value of [
    "2026-08-19T23:26:08+02:00",
    "2026-02-30 23:26:08",
    "not-a-timestamp",
    42,
    null,
    {}
  ]) {
    assert.equal(isCanonicalDatabaseTimestamp(value), false);
  }
});

test("repeat-upgrade comparison permits either declared timestamp to vary or neither", () => {
  const baseline = makeRepeatUpgradeSnapshot();
  const variants = [
    makeRepeatUpgradeSnapshot({ createdAt: "2026-08-19 23:26:09" }),
    makeRepeatUpgradeSnapshot({ updatedAt: "2026-08-19 23:26:09" }),
    makeRepeatUpgradeSnapshot({
      createdAt: "2026-08-19 23:26:09",
      updatedAt: "2026-08-19 23:26:09"
    }),
    makeRepeatUpgradeSnapshot()
  ];
  for (const [index, variant] of variants.entries()) {
    const result = verifySnapshotsEquivalent(baseline, variant, {
      volatileColumnsByTable: VOLATILE_OWNERSHIP_COLUMNS
    });
    assert.deepEqual(
      result.volatileTableEvidence,
      index === variants.length - 1
        ? []
        : [
            {
              tableName: "user_ownership_defaults",
              volatileColumns: ["created_at", "updated_at"]
            }
          ]
    );
  }
});

test("repeat-upgrade comparison rejects malformed declared timestamps", () => {
  const baseline = makeRepeatUpgradeSnapshot();
  for (const createdAt of [
    "2026-08-19T23:26:08+02:00",
    "not-a-timestamp",
    42
  ]) {
    assert.throws(
      () =>
        verifySnapshotsEquivalent(
          baseline,
          makeRepeatUpgradeSnapshot({ createdAt }),
          { volatileColumnsByTable: VOLATILE_OWNERSHIP_COLUMNS }
        ),
      (error) => error.code === "repeat_upgrade_volatile_value_invalid"
    );
  }
});

test("repeat-upgrade comparison validates declared timestamps even when hashes match", () => {
  const baseline = makeRepeatUpgradeSnapshot();
  for (const field of ["createdAt", "updatedAt"]) {
    for (const invalidValue of [null, "not-a-timestamp"]) {
      const invalidSnapshot = makeRepeatUpgradeSnapshot({
        [field]: invalidValue
      });
      assert.throws(
        () =>
          verifySnapshotsEquivalent(baseline, invalidSnapshot, {
            volatileColumnsByTable: VOLATILE_OWNERSHIP_COLUMNS
          }),
        (error) => error.code === "repeat_upgrade_volatile_value_invalid"
      );
      assert.throws(
        () =>
          verifySnapshotsEquivalent(invalidSnapshot, invalidSnapshot, {
            volatileColumnsByTable: VOLATILE_OWNERSHIP_COLUMNS
          }),
        (error) => error.code === "repeat_upgrade_volatile_value_invalid"
      );
    }
  }
});

test("repeat-upgrade comparison rejects structural and nonvolatile differences", () => {
  const baseline = makeRepeatUpgradeSnapshot();
  assert.throws(
    () =>
      verifySnapshotsEquivalent(
        baseline,
        makeRepeatUpgradeSnapshot({ rowCount: 2 }),
        { volatileColumnsByTable: VOLATILE_OWNERSHIP_COLUMNS }
      ),
    (error) => error.code === "repeat_upgrade_hash_mismatch"
  );
  assert.throws(
    () =>
      verifySnapshotsEquivalent(
        makeRepeatUpgradeSnapshot({ tableName: "other_defaults" }),
        makeRepeatUpgradeSnapshot({
          tableName: "other_defaults",
          createdAt: "2026-08-19 23:26:09"
        })
      ),
    (error) => error.code === "repeat_upgrade_hash_mismatch"
  );
  assert.throws(
    () =>
      verifySnapshotsEquivalent(
        baseline,
        makeRepeatUpgradeSnapshot({
          ownerUserId: "user_other_owner",
          updatedAt: "2026-08-19 23:26:09"
        }),
        { volatileColumnsByTable: VOLATILE_OWNERSHIP_COLUMNS }
      ),
    (error) => error.code === "repeat_upgrade_hash_mismatch"
  );
  assert.throws(
    () =>
      verifySnapshotsEquivalent(
        baseline,
        makeRepeatUpgradeSnapshot({ tableName: "other_defaults" }),
        { volatileColumnsByTable: VOLATILE_OWNERSHIP_COLUMNS }
      ),
    (error) => error.code === "repeat_upgrade_table_mismatch"
  );
});

test("release coverage accepts only declared volatile-table evidence subsets", () => {
  const declared = {
    user_ownership_defaults: ["created_at", "updated_at"],
    people_profile_cache: ["updated_at"]
  };
  const ownershipEvidence = {
    tableName: "user_ownership_defaults",
    volatileColumns: ["created_at", "updated_at"]
  };
  const profileEvidence = {
    tableName: "people_profile_cache",
    volatileColumns: ["updated_at"]
  };
  assert.equal(observedVolatileEvidenceIsDeclaredSubset([], declared), true);
  assert.equal(
    observedVolatileEvidenceIsDeclaredSubset([ownershipEvidence], declared),
    true
  );
  assert.equal(
    observedVolatileEvidenceIsDeclaredSubset(
      [ownershipEvidence, profileEvidence],
      declared
    ),
    true
  );
  assert.equal(
    observedVolatileEvidenceIsDeclaredSubset(
      [
        {
          tableName: "undeclared_table",
          volatileColumns: ["updated_at"]
        }
      ],
      declared
    ),
    false
  );
  assert.equal(
    observedVolatileEvidenceIsDeclaredSubset(
      [
        {
          tableName: "user_ownership_defaults",
          volatileColumns: ["created_at"]
        }
      ],
      declared
    ),
    false
  );
  assert.equal(
    observedVolatileEvidenceIsDeclaredSubset(
      [ownershipEvidence, ownershipEvidence],
      declared
    ),
    false
  );
});

test("pinned prior artifact verification rejects missing, wrong, and tampered bytes", () => {
  const bytes = Buffer.from("deterministic-prior-release-fixture", "utf8");
  const expected = {
    ...PRIOR_RELEASE_ARTIFACT,
    tarballSha256: digest(bytes, "sha256", "hex"),
    registryIntegrity: `sha512-${digest(bytes, "sha512", "base64")}`
  };
  assert.deepEqual(verifyPriorReleaseArtifactBytes(bytes, expected), {
    byteSize: bytes.byteLength,
    tarballSha256: expected.tarballSha256,
    registryIntegrity: expected.registryIntegrity
  });
  assert.throws(
    () => verifyPriorReleaseArtifactBytes(null, expected),
    (error) => error.code === "prior_artifact_missing"
  );
  assert.throws(
    () =>
      verifyPriorReleaseArtifactBytes(
        Buffer.from("wrong-prior-release", "utf8"),
        expected
      ),
    (error) => error.code === "prior_artifact_sha256_mismatch"
  );
  const tampered = Buffer.from(bytes);
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(
    () => verifyPriorReleaseArtifactBytes(tampered, expected),
    (error) => error.code === "prior_artifact_sha256_mismatch"
  );
  assert.throws(
    () =>
      verifyPriorReleaseArtifactBytes(bytes, {
        ...expected,
        registryIntegrity: "sha512-invalid"
      }),
    (error) => error.code === "prior_artifact_integrity_mismatch"
  );
});

test("pinned prior registry metadata must match every immutable release field", () => {
  const metadata = {
    name: PRIOR_RELEASE_ARTIFACT.packageName,
    version: PRIOR_RELEASE_ARTIFACT.version,
    gitHead: PRIOR_RELEASE_ARTIFACT.tagCommit,
    "dist.integrity": PRIOR_RELEASE_ARTIFACT.registryIntegrity,
    "dist.tarball": PRIOR_RELEASE_ARTIFACT.tarballUrl
  };
  assert.deepEqual(verifyPriorReleaseRegistryMetadata(metadata), {
    packageName: PRIOR_RELEASE_ARTIFACT.packageName,
    version: PRIOR_RELEASE_ARTIFACT.version,
    tagCommit: PRIOR_RELEASE_ARTIFACT.tagCommit,
    registryIntegrity: PRIOR_RELEASE_ARTIFACT.registryIntegrity,
    tarballUrl: PRIOR_RELEASE_ARTIFACT.tarballUrl
  });
  assert.throws(
    () => verifyPriorReleaseRegistryMetadata(null),
    (error) => error.code === "prior_artifact_registry_metadata_missing"
  );
  assert.throws(
    () =>
      verifyPriorReleaseRegistryMetadata({
        ...metadata,
        version: "0.3.31"
      }),
    (error) => error.code === "prior_artifact_registry_metadata_mismatch"
  );
  assert.throws(
    () =>
      verifyPriorReleaseRegistryMetadata({
        ...metadata,
        gitHead: "0".repeat(40)
      }),
    (error) => error.code === "prior_artifact_registry_metadata_mismatch"
  );
});

test("refuses output paths that overlap protected Forge roots", () => {
  const protectedRoot = defaultRepoRoot;
  assert.throws(
    () =>
      assertOutputPathAllowed(
        path.join(protectedRoot, "forbidden-report.json"),
        [{ root: protectedRoot, labels: ["configured Forge data"] }]
      ),
    (error) => error.code === "protected_data_root"
  );
});

test("harness rejects a protected caller output before creating fixtures", async () => {
  const requestedRoot = path.join(
    os.tmpdir(),
    `${EVIDENCE_ROOT_PREFIX}output-${process.pid}-${Date.now()}`
  );
  const forbiddenOutput = path.join(
    defaultRepoRoot,
    "forbidden-people-evidence.json"
  );
  await assert.rejects(
    runPeopleUpgradeRestoreHarness({
      mode: "focused",
      requestedEvidenceRoot: requestedRoot,
      outputPath: forbiddenOutput
    }),
    (error) => error.code === "protected_data_root"
  );
  assert.equal(existsSync(forbiddenOutput), false);
  assert.equal(existsSync(path.join(requestedRoot, "scenarios")), false);
  assert.equal(existsSync(path.join(requestedRoot, HARNESS_MARKER_FILE)), true);
  process.stderr.write(
    `Preserved output-rejection evidence root: ${requestedRoot}\n`
  );
});

test("CLI failure parsing ignores runtime warnings around the JSON line", () => {
  const payload = {
    status: "failed",
    code: "argument_value_missing",
    evidenceRoot: null
  };
  const stderr = [
    "(node:123) ExperimentalWarning: SQLite is an experimental feature",
    JSON.stringify(payload),
    "(Use `node --trace-warnings ...` to show where the warning was created)"
  ].join("\n");
  assert.deepEqual(parseCliFailure(stderr, "argument_value_missing"), payload);
});

test("CLI flags fail closed when their value is missing", () => {
  for (const option of ["--mode", "--evidence-root", "--output"]) {
    const result = spawnSync(
      process.execPath,
      [
        path.join(
          defaultRepoRoot,
          "scripts/ci/check-people-upgrade-restore.mjs"
        ),
        option
      ],
      { cwd: defaultRepoRoot, encoding: "utf8" }
    );
    assert.equal(result.status, 1);
    const failure = parseCliFailure(result.stderr, "argument_value_missing");
    assert.ok(failure, result.stderr);
    assert.equal(failure.code, "argument_value_missing");
    assert.equal(failure.evidenceRoot, null);
  }
});

test("CLI help keeps file output and stdout output as distinct contracts", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(defaultRepoRoot, "scripts/ci/check-people-upgrade-restore.mjs"),
      "--help"
    ],
    { cwd: defaultRepoRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /--output PATH\|-\s+Additional JSON output path or stdout/
  );
  assert.doesNotMatch(result.stderr, /Machine-readable report/);
});

test("file output does not serialize the report a second time", () => {
  const report = {
    toJSON() {
      throw new Error("report should not be serialized for file output");
    }
  };
  assert.equal(serializeReportForStdout(report, "/tmp/report.json"), null);
  assert.equal(
    serializeReportForStdout({ status: "passed" }, "-"),
    '{"status":"passed"}\n'
  );
});

test("refuses configured/default roots before creating or inspecting evidence", async () => {
  const configured = path.join(os.tmpdir(), `${EVIDENCE_ROOT_PREFIX}protected`);
  await assert.rejects(
    createHarnessEvidenceRoot({
      requestedRoot: configured,
      env: { ...process.env, FORGE_DATA_ROOT: configured }
    }),
    (error) => error.code === "protected_data_root"
  );
  assert.equal(existsSync(configured), false);

  const protectedListEntry = path.join(
    os.tmpdir(),
    `${EVIDENCE_ROOT_PREFIX}protected-list-${process.pid}-${Date.now()}`
  );
  await assert.rejects(
    createHarnessEvidenceRoot({
      requestedRoot: protectedListEntry,
      env: {
        ...process.env,
        FORGE_PROTECTED_DATA_ROOTS: protectedListEntry
      }
    }),
    (error) => error.code === "protected_data_root"
  );
  assert.equal(existsSync(protectedListEntry), false);
});

test("requires a fresh harness-created marker and rejects paths outside it", async () => {
  const unmarked = await mkdtemp(
    path.join(os.tmpdir(), `${EVIDENCE_ROOT_PREFIX}unmarked-`)
  );
  assert.throws(
    () => assertHarnessPath(unmarked, path.join(unmarked, "forge.sqlite")),
    (error) => error.code === "harness_marker_missing"
  );

  const requestedRoot = path.join(
    os.tmpdir(),
    `${EVIDENCE_ROOT_PREFIX}marker-${process.pid}-${Date.now()}`
  );
  const { evidenceRoot } = await createHarnessEvidenceRoot({ requestedRoot });
  assert.equal(existsSync(path.join(evidenceRoot, HARNESS_MARKER_FILE)), true);
  assert.throws(
    () =>
      assertHarnessPath(evidenceRoot, path.join(os.tmpdir(), "outside.sqlite")),
    (error) => error.code === "path_outside_harness"
  );
  process.stderr.write(
    `Preserved marker-test evidence root: ${evidenceRoot}\n`
  );
});

test("backup verification fails closed on changed bytes", async () => {
  const requestedRoot = path.join(
    os.tmpdir(),
    `${EVIDENCE_ROOT_PREFIX}manifest-${process.pid}-${Date.now()}`
  );
  const { evidenceRoot } = await createHarnessEvidenceRoot({ requestedRoot });
  const backup = path.join(evidenceRoot, "backup.sqlite");
  mkdirSync(path.dirname(backup), { recursive: true });
  const bytes = Buffer.from("isolated-backup-fixture", "utf8");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(backup, bytes)
  );
  const digest = await import("node:crypto").then(({ createHash }) =>
    createHash("sha256").update(bytes).digest("hex")
  );
  const manifest = { backupByteSize: bytes.length, backupFileSha256: digest };
  assert.deepEqual(verifyBackupManifest(evidenceRoot, backup, manifest), {
    byteSize: bytes.length,
    fileSha256: digest
  });
  await import("node:fs/promises").then(({ appendFile }) =>
    appendFile(backup, "tamper")
  );
  assert.throws(
    () => verifyBackupManifest(evidenceRoot, backup, manifest),
    (error) => error.code === "backup_tampered"
  );
  process.stderr.write(
    `Preserved manifest-test evidence root: ${evidenceRoot}\n`
  );
});

test(
  "focused executable proof preserves rows across backup, upgrade, restore, and rerun",
  { timeout: 180_000 },
  async () => {
    const requestedRoot = path.join(
      os.tmpdir(),
      `${EVIDENCE_ROOT_PREFIX}focused-${process.pid}-${Date.now()}`
    );
    const callerOutputPath = path.join(requestedRoot, "caller-report.json");
    const { report, reportPath } = await runPeopleUpgradeRestoreHarness({
      mode: "focused",
      requestedEvidenceRoot: requestedRoot,
      repoRoot: defaultRepoRoot,
      outputPath: callerOutputPath
    });
    assert.equal(report.status, "passed");
    assert.equal(report.mode, "focused");
    assert.equal(report.canonicalDataAccess, "forbidden_and_not_attempted");
    assert.equal(
      report.priorReleaseArtifact.status,
      "not_acquired_focused_mode"
    );
    assert.deepEqual(
      report.migrationSource.peopleMigrations,
      PEOPLE_MIGRATIONS
    );
    assert.equal(report.scenarios.length, 1);
    const scenario = report.scenarios[0];
    assert.equal(scenario.id, "focused-pre-people-085");
    assert.equal(scenario.baselineKind, "focused_synthetic_fixture");
    assert.equal(
      scenario.priorRuntime.status,
      "focused_fixture_not_historical"
    );
    assert.equal(scenario.priorRuntime.historicalExecutableClaim, false);
    assert.equal(scenario.sourceUpgrade.contract.oldBinaryWriteRejected, true);
    assert.equal(
      scenario.restoredUpgrade.contract.oldBinaryWriteRejected,
      true
    );
    assert.equal(scenario.sourceUpgrade.operations.listMatched, true);
    assert.equal(
      scenario.sourceUpgrade.operations.relationshipAfterRevoke,
      "revoked"
    );
    assert.equal(scenario.adversarial.tamperedRejected, true);
    assert.equal(scenario.adversarial.interruptedRejected, true);
    assert.equal(scenario.adversarial.corruptRejected, true);
    assert.equal(scenario.adversarial.wrongRootRejected, true);
    assert.equal(
      scenario.sourceUpgrade.idempotent.migrationTimestampsCompared,
      true
    );
    assert.equal(
      scenario.restoredUpgrade.repeatable.migrationTimestampsCompared,
      false
    );
    assert.deepEqual(
      scenario.preservationContract.volatileColumnsByTable
        .user_ownership_defaults,
      ["created_at", "updated_at"]
    );
    assert.ok(scenario.sourceUpgrade.preservation.checkedTableCount > 20);
    assert.ok(scenario.sourceUpgrade.preservation.checkedRowCount > 0);
    assert.equal(scenario.sourceUpgrade.preservation.additiveRowCount, 14);
    assert.equal(
      scenario.sourceUpgrade.preservation.strictTableCount,
      scenario.sourceUpgrade.preservation.checkedTableCount - 2
    );
    assert.ok(
      scenario.baseline.excludedDerivedShadowTables.includes(
        "artifact_search_data"
      )
    );
    assert.ok(
      scenario.sourceUpgrade.idempotent.excludedDerivedShadowTableCount > 0
    );
    assert.match(scenario.sourceUpgrade.fileSha256AfterRerun, /^[a-f0-9]{64}$/);
    assert.match(
      scenario.restoredUpgrade.fileSha256AfterUpgrade,
      /^[a-f0-9]{64}$/
    );
    assert.equal(existsSync(reportPath), true);
    assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).status, "passed");
    assert.equal(existsSync(callerOutputPath), true);
    assert.deepEqual(
      JSON.parse(readFileSync(callerOutputPath, "utf8")),
      JSON.parse(readFileSync(reportPath, "utf8"))
    );
    process.stderr.write(
      `Preserved focused evidence root: ${report.evidenceRoot}\n`
    );
  }
);
