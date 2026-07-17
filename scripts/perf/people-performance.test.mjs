import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PEOPLE_PERFORMANCE_SCHEMA_VERSION,
  RELEASE_PROFILE,
  TEST_PROFILE,
  asAdvisoryCheck,
  assertNotProtectedDataRoot,
  assertPrivateEvidencePath,
  canonicalJson,
  evaluateFloor,
  loadBudgets,
  logicalFixtureSha256,
  nearestRankPercentile,
  releaseCompletenessChecks,
  requiredPeoplePerformanceSuiteCheckIds,
  summarizeDurations,
  validatePeoplePerformanceResult
} from "./people-performance-contract.mjs";
import {
  classifyFramePixels,
  normalizeRafToReference,
  positiveFiniteFrameDurations,
  selectMeasuredRafBaseline
} from "./people-performance-browser.mjs";
import {
  createPeoplePerformanceFixture,
  expectedLogicalFixtureRows,
  verifyPeoplePerformanceFixture
} from "./people-performance-fixture.mjs";
import {
  parseCliArguments,
  redactPeoplePerformanceEvidence,
  removeOwnedRunRoot
} from "./people-performance.mjs";
import {
  createPeopleScalePerformanceFixture,
  verifyPeopleScalePerformanceFixture
} from "./people-performance-scale-fixture.mjs";
import { runPeopleScalePerformanceProtocol } from "./people-performance-scale.mjs";
import {
  initializeIsolatedForgeDatabase,
  runCheckedSubprocess
} from "./people-performance-runtime.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

test("nearest-rank summaries use the requested finite sample population", () => {
  const values = Array.from({ length: 20 }, (_, index) => index + 1);
  assert.equal(nearestRankPercentile(values, 0.95), 19);
  assert.deepEqual(summarizeDurations([4, 1, 3, 2]), {
    count: 4,
    p50Ms: 2,
    medianMs: 2,
    p95Ms: 4,
    p99Ms: 4,
    maxMs: 4,
    minMs: 1
  });
  assert.throws(() => nearestRankPercentile([], 0.95), /at least one/u);
  assert.throws(
    () => nearestRankPercentile([1, Number.NaN], 0.95),
    /not finite/u
  );
});

test("scroll timing is normalized to a 60 Hz reference without hiding dropped frames", () => {
  assert.equal(
    selectMeasuredRafBaseline({
      idleFrameDurationMs: 7,
      motionMedianFrameDurationMs: 20
    }),
    20
  );
  assert.equal(
    selectMeasuredRafBaseline({
      idleFrameDurationMs: 7,
      motionMedianFrameDurationMs: 25
    }),
    20
  );
  assert.equal(
    selectMeasuredRafBaseline({
      idleFrameDurationMs: 7,
      motionMedianFrameDurationMs: 10
    }),
    10
  );
  const nativeFiftyHertz = normalizeRafToReference({
    p5Fps: 50,
    p95FrameDurationMs: 20,
    baselineFrameDurationMs: 20
  });
  assert.equal(nativeFiftyHertz.baselineFps, 50);
  assert.equal(nativeFiftyHertz.p5Fps, 60);
  assert.ok(Math.abs(nativeFiftyHertz.p95FrameDurationMs - 50 / 3) < 1e-9);

  const highRefreshDisplay = normalizeRafToReference({
    p5Fps: 100,
    p95FrameDurationMs: 10,
    baselineFrameDurationMs: 1000 / 120
  });
  assert.equal(highRefreshDisplay.effectiveBaselineFps, 60);
  assert.equal(highRefreshDisplay.p5Fps, 100);
  assert.equal(highRefreshDisplay.p95FrameDurationMs, 10);

  const droppedFrames = normalizeRafToReference({
    p5Fps: 40,
    p95FrameDurationMs: 25,
    baselineFrameDurationMs: 20
  });
  assert.equal(droppedFrames.p5Fps, 48);
  assert.ok(droppedFrames.p95FrameDurationMs > 20);
  const severeDropOnFastIdle = normalizeRafToReference({
    p5Fps: 30,
    p95FrameDurationMs: 1000 / 30,
    baselineFrameDurationMs: selectMeasuredRafBaseline({
      idleFrameDurationMs: 7,
      motionMedianFrameDurationMs: 1000 / 30
    })
  });
  assert.equal(severeDropOnFastIdle.p5Fps, 36);
  assert.ok(severeDropOnFastIdle.p95FrameDurationMs > 20);
  assert.throws(
    () =>
      normalizeRafToReference({
        p5Fps: 10,
        p95FrameDurationMs: 100,
        baselineFrameDurationMs: 100
      }),
    /outside the supported/u
  );
});

test("scroll timing ignores duplicate and invalid animation timestamps", () => {
  assert.deepEqual(
    positiveFiniteFrameDurations([16.7, 0, Number.NaN, -1, 20]),
    [16.7, 20]
  );
  assert.throws(() => positiveFiniteFrameDurations(null), /must be an array/u);
});

test("shared-runner timing remains truthful when it is advisory", () => {
  const measured = evaluateFloor({
    id: "scroll.desktop.run_1.fps",
    actual: 49,
    floor: 55,
    unit: "fps"
  });
  const advisory = asAdvisoryCheck(measured, "shared runner timing");
  assert.equal(advisory.status, "pass");
  assert.equal(advisory.measuredStatus, "fail");
  assert.equal(advisory.actual, 49);
  assert.equal(advisory.floor, 55);
  assert.throws(() => asAdvisoryCheck(measured, ""), /requires a reason/u);
});

test("budget overrides are strict, partial, and reject unknown keys", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "people-perf-budget-test-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const validPath = path.join(root, "valid.json");
  await writeFile(validPath, '{"api":{"listP95Ms":123}}\n', "utf8");
  const budgets = await loadBudgets(validPath);
  assert.equal(budgets.api.listP95Ms, 123);
  assert.equal(budgets.api.contextP95Ms, 250);

  const invalidPath = path.join(root, "invalid.json");
  await writeFile(invalidPath, '{"api":{"invented":1}}\n', "utf8");
  await assert.rejects(() => loadBudgets(invalidPath), /unknown keys/u);
});

test("private evidence paths cannot point into the public Forge repository", () => {
  assert.throws(
    () =>
      assertPrivateEvidencePath(
        path.join(repositoryRoot, "people-performance.json"),
        repositoryRoot
      ),
    /outside the public Forge repository/u
  );
  assert.doesNotThrow(() =>
    assertPrivateEvidencePath(
      path.join(os.tmpdir(), "people-performance-private.json"),
      repositoryRoot
    )
  );
});

test("fixture roots reject configured live data and backup boundaries", () => {
  const configuredRoot = path.join(os.tmpdir(), "forge-configured-live-data");
  const additionalRoot = path.join(
    os.tmpdir(),
    "forge-additional-protected-data"
  );
  const environment = {
    FORGE_DATA_ROOT: configuredRoot,
    FORGE_PROTECTED_DATA_ROOTS: additionalRoot
  };
  assert.throws(
    () =>
      assertNotProtectedDataRoot(
        path.join(configuredRoot, "people-performance-run"),
        repositoryRoot,
        environment
      ),
    /refuses protected Forge data root/u
  );
  assert.throws(
    () =>
      assertNotProtectedDataRoot(
        path.dirname(additionalRoot),
        repositoryRoot,
        environment
      ),
    /refuses protected Forge data root/u
  );
});

test("CLI profiles reject underspecified suites and default release closed", () => {
  const defaults = parseCliArguments([]);
  assert.equal(defaults.mode, "release");
  assert.deepEqual(
    [...defaults.suites],
    ["fixture", "api", "scale", "bundle", "browser"]
  );
  assert.deepEqual(
    [...parseCliArguments(["--only", "api,bundle"]).suites],
    ["api", "bundle"]
  );
  assert.equal(parseCliArguments(["--timeout-ms", "5000"]).timeoutMs, 5000);
  assert.throws(
    () => parseCliArguments(["--timeout-ms", "999"]),
    /at least 1000/u
  );
  assert.throws(() => parseCliArguments(["--only", "unknown"]), /accepts/u);
});

test("captured-frame classification detects blank and full-blue paint", () => {
  const white = Buffer.alloc(4 * 4 * 3, 255);
  assert.equal(classifyFramePixels(white, 4, 4).blank, true);
  const blue = Buffer.alloc(4 * 4 * 3);
  for (let offset = 0; offset < blue.length; offset += 3) {
    blue[offset] = 10;
    blue[offset + 1] = 20;
    blue[offset + 2] = 220;
  }
  assert.equal(classifyFramePixels(blue, 4, 4).blueFlash, true);
  const varied = Buffer.from(
    Array.from({ length: 4 * 4 * 3 }, (_, index) => (index * 47) % 255)
  );
  assert.equal(classifyFramePixels(varied, 4, 4).blank, false);
});

test("release completeness fails closed on every missing release suite", () => {
  const checks = releaseCompletenessChecks(RELEASE_PROFILE, {
    selectedSuites: ["browser"],
    browser: {
      firstUsefulContent: {
        cold: { summary: { count: 9 } },
        warm: { summary: { count: 19 } }
      },
      memory: { summary: { traversals: 19 } },
      scroll: {
        desktop: { runs: Array.from({ length: 4 }) },
        pixel7: { runs: Array.from({ length: 4 }) }
      }
    }
  });
  assert.equal(
    checks.find((check) => check.id === "release.browser.cold_samples")?.status,
    "fail"
  );
  assert.equal(
    checks.find((check) => check.id === "release.scale_fixture.outbox.exact")
      ?.status,
    "fail"
  );
  assert.equal(
    checks.find((check) => check.id === "release.suite.scale.selected")?.status,
    "fail"
  );
});

function passingCheck(id) {
  return {
    id,
    status: "pass",
    actual: 0,
    ceiling: 1,
    unit: "test"
  };
}

function rebuildReleaseEvidenceChecks(result) {
  result.checks = [
    passingCheck("fixture.browser.verified"),
    passingCheck("fixture.scale.verified"),
    ...result.api.checks,
    ...result.scale.checks,
    ...result.bundle.checks,
    ...result.browser.checks,
    ...releaseCompletenessChecks(RELEASE_PROFILE, result)
  ];
  result.status = result.checks.every((check) => check.status === "pass")
    ? "pass"
    : "fail";
  return result;
}

function completeReleaseEvidence() {
  const result = {
    schemaVersion: PEOPLE_PERFORMANCE_SCHEMA_VERSION,
    kind: "forge_people_performance",
    mode: "release",
    status: "running",
    selectedSuites: ["fixture", "api", "scale", "bundle", "browser"],
    fixtures: {
      browser: { counts: { ...RELEASE_PROFILE.fixture } },
      scale: {
        counts: {
          people: RELEASE_PROFILE.scale.people,
          links: RELEASE_PROFILE.scale.links,
          relationships: RELEASE_PROFILE.scale.relationships,
          projections: RELEASE_PROFILE.scale.projections,
          outbox: RELEASE_PROFILE.scale.outbox
        },
        sqliteIntegrity: "ok",
        foreignKeyViolations: 0
      }
    },
    api: {
      scenarios: Object.fromEntries(
        ["list", "search", "context"].map((name) => [
          name,
          {
            protocol: { warmups: RELEASE_PROFILE.api.warmups },
            summary: {
              count: RELEASE_PROFILE.api.samples,
              p50Ms: 1,
              p95Ms: 2,
              p99Ms: 3
            }
          }
        ])
      ),
      cursorTraversal: {
        protocol: { uniquePeople: RELEASE_PROFILE.scale.people },
        summary: { p99Ms: 3 }
      }
    },
    scale: {
      restart: {
        summary: { count: RELEASE_PROFILE.scale.restartSamples, p99Ms: 3 }
      },
      outboxClaim: {
        protocol: { warmups: RELEASE_PROFILE.scale.claimWarmups },
        summary: { count: RELEASE_PROFILE.scale.claimSamples, p99Ms: 3 }
      },
      queryPlans: Array.from({ length: 5 }, (_, index) => ({
        id: `plan_${index}`,
        status: "pass"
      }))
    },
    bundle: { status: "pass" },
    browser: {
      firstUsefulContent: {
        cold: { summary: { count: RELEASE_PROFILE.browser.coldSamples } },
        warm: { summary: { count: RELEASE_PROFILE.browser.warmSamples } }
      },
      memory: { summary: { traversals: RELEASE_PROFILE.memory.traversals } },
      scroll: {
        desktop: {
          runs: Array.from({ length: RELEASE_PROFILE.scroll.runsPerDevice })
        },
        pixel7: {
          runs: Array.from({ length: RELEASE_PROFILE.scroll.runsPerDevice })
        }
      }
    }
  };
  for (const suiteName of ["api", "scale", "bundle", "browser"]) {
    result[suiteName].checks = requiredPeoplePerformanceSuiteCheckIds(
      RELEASE_PROFILE,
      suiteName
    ).map(passingCheck);
    result[suiteName].status = "pass";
  }
  return rebuildReleaseEvidenceChecks(result);
}

test("release evidence rejects reduced scale fixtures and skipped scenarios", () => {
  const reduced = completeReleaseEvidence();
  reduced.fixtures.scale.counts.outbox -= 1;
  rebuildReleaseEvidenceChecks(reduced);
  assert.equal(
    reduced.checks.find(
      (check) => check.id === "release.scale_fixture.outbox.exact"
    )?.status,
    "fail"
  );
  assert.throws(
    () => validatePeoplePerformanceResult(reduced, RELEASE_PROFILE),
    /incomplete/u
  );

  const skipped = completeReleaseEvidence();
  delete skipped.api.scenarios.search;
  rebuildReleaseEvidenceChecks(skipped);
  assert.throws(
    () => validatePeoplePerformanceResult(skipped, RELEASE_PROFILE),
    /release evidence is incomplete/u
  );
});

test("evidence validation rejects fake success and malformed documents", () => {
  assert.throws(
    () => validatePeoplePerformanceResult(null, TEST_PROFILE),
    /must be an object/u
  );
  assert.throws(
    () =>
      validatePeoplePerformanceResult(
        {
          schemaVersion: PEOPLE_PERFORMANCE_SCHEMA_VERSION,
          kind: "forge_people_performance",
          mode: "test",
          status: "pass",
          checks: [
            {
              id: "forged_success",
              status: "pass",
              actual: 1,
              ceiling: 0,
              unit: "count"
            }
          ]
        },
        TEST_PROFILE
      ),
    /not derived/u
  );
  assert.doesNotThrow(() =>
    validatePeoplePerformanceResult(completeReleaseEvidence(), RELEASE_PROFILE)
  );

  const advisoryEvidence = completeReleaseEvidence();
  const timingIndex = advisoryEvidence.browser.checks.findIndex(
    (check) => check.id === "scroll.desktop.run_1.fps"
  );
  advisoryEvidence.browser.checks[timingIndex] = asAdvisoryCheck(
    evaluateFloor({
      id: "scroll.desktop.run_1.fps",
      actual: 49,
      floor: 55,
      unit: "fps"
    }),
    "shared runner timing"
  );
  rebuildReleaseEvidenceChecks(advisoryEvidence);
  assert.doesNotThrow(() =>
    validatePeoplePerformanceResult(advisoryEvidence, RELEASE_PROFILE)
  );
  advisoryEvidence.browser.checks[timingIndex].measuredStatus = "pass";
  rebuildReleaseEvidenceChecks(advisoryEvidence);
  assert.throws(
    () => validatePeoplePerformanceResult(advisoryEvidence, RELEASE_PROFILE),
    /advisory check is malformed/u
  );

  const missingMetric = completeReleaseEvidence();
  missingMetric.scale.checks = missingMetric.scale.checks.filter(
    (check) => check.id !== "scale.outbox_claim.p95"
  );
  missingMetric.checks = missingMetric.checks.filter(
    (check) => check.id !== "scale.outbox_claim.p95"
  );
  assert.throws(
    () => validatePeoplePerformanceResult(missingMetric, RELEASE_PROFILE),
    /missing required checks: scale\.outbox_claim\.p95/u
  );
});

test("evidence redaction removes local paths, hostnames, and secret values", () => {
  const runRoot = path.join(os.tmpdir(), "forge-people-performance-redaction");
  const redacted = redactPeoplePerformanceEvidence(
    {
      repositoryRoot,
      command: `${process.execPath} ${path.join(repositoryRoot, "script.mjs")}`,
      runRoot,
      environment: { hostname: "private-host" },
      capabilitySecret: "must-not-leak"
    },
    { repositoryRoot, runRoot }
  );
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes(repositoryRoot), false);
  assert.equal(serialized.includes(runRoot), false);
  assert.equal(serialized.includes("private-host"), false);
  assert.equal(serialized.includes("must-not-leak"), false);
  assert.equal(redacted.capabilitySecret, "<redacted>");
});

test("checked subprocesses reject a nonzero exit", async () => {
  await assert.rejects(
    () =>
      runCheckedSubprocess({
        command: process.execPath,
        args: ["-e", "process.exit(7)"],
        cwd: repositoryRoot,
        timeoutMs: 5_000
      }),
    /exited with code 7/u
  );
});

test("checked subprocesses terminate on timeout and abort", async () => {
  const preAborted = new AbortController();
  preAborted.abort(new Error("already aborted"));
  await assert.rejects(
    () =>
      runCheckedSubprocess({
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: repositoryRoot,
        timeoutMs: 5_000,
        signal: preAborted.signal
      }),
    /already aborted/u
  );
  await assert.rejects(
    () =>
      runCheckedSubprocess({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: repositoryRoot,
        timeoutMs: 1_000
      }),
    /timed out/u
  );
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 50);
  await assert.rejects(
    () =>
      runCheckedSubprocess({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: repositoryRoot,
        timeoutMs: 5_000,
        signal: controller.signal
      }),
    /was aborted/u
  );
  clearTimeout(abortTimer);
});

test("CLI SIGINT fails closed, emits evidence, and removes its owned root", async (t) => {
  const tempParent = await mkdtemp(
    path.join(os.tmpdir(), "forge-people-sigint-test-")
  );
  const evidencePath = path.join(tempParent, "interrupted-evidence.json");
  const cliPath = path.join(
    repositoryRoot,
    "scripts/perf/people-performance.mjs"
  );
  const child = spawn(
    process.execPath,
    [
      cliPath,
      "--mode",
      "test",
      "--only",
      "api",
      "--evidence",
      evidencePath,
      "--temp-parent",
      tempParent,
      "--timeout-ms",
      "60000"
    ],
    {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await rm(tempParent, { recursive: true, force: true });
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  const ownedRootReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`CLI did not create its owned root.\n${stderr}`)),
      20_000
    );
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.includes("[people-performance] owned run root:")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `CLI exited before SIGINT injection (code=${code}, signal=${signal}).\n${stderr}\n${stdout}`
        )
      );
    });
  });
  await ownedRootReady;
  assert.equal(child.kill("SIGINT"), true);
  const exit = await new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(exit, { code: 2, signal: null }, `${stderr}\n${stdout}`);
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  assert.equal(evidence.status, "error");
  assert.match(evidence.error.message, /interrupted by SIGINT/u);
  assert.equal(evidence.cleanup.status, "removed");
  if (process.platform !== "win32") {
    assert.equal((await stat(evidencePath)).mode & 0o777, 0o600);
  }
  const leftovers = (await readdir(tempParent)).filter((entry) =>
    entry.startsWith("forge-people-performance-")
  );
  assert.deepEqual(leftovers, []);
});

test("temporary cleanup removes only an exactly marked owned run root", async (t) => {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), "forge-people-cleanup-parent-")
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const owned = await mkdtemp(path.join(parent, "forge-people-performance-"));
  await writeFile(
    path.join(owned, ".forge-people-performance-owned-run.json"),
    JSON.stringify({ kind: "forge_people_performance_owned_run" }),
    "utf8"
  );
  await writeFile(path.join(owned, "owned.txt"), "fixture", "utf8");
  await removeOwnedRunRoot(owned, parent);
  await assert.rejects(() => access(owned));

  const unowned = path.join(parent, "unowned-root");
  await mkdir(unowned);
  await writeFile(path.join(unowned, "preserve.txt"), "preserve", "utf8");
  await assert.rejects(
    () => removeOwnedRunRoot(unowned, parent),
    /Refusing to remove/u
  );
  await assert.doesNotReject(() => access(path.join(unowned, "preserve.txt")));
});

test("small fixtures are deterministic, exact, and independently verifiable", async (t) => {
  const runRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-people-performance-test-")
  );
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const dataRoot = path.join(runRoot, "fixture");
  const expectedHash = logicalFixtureSha256(
    expectedLogicalFixtureRows(TEST_PROFILE)
  );
  const fixture = await createPeoplePerformanceFixture({
    dataRoot,
    repositoryRoot,
    profile: TEST_PROFILE,
    initializeDatabase: (root) =>
      initializeIsolatedForgeDatabase(root, repositoryRoot)
  });
  assert.deepEqual(fixture.counts, {
    people: TEST_PROFILE.fixture.people,
    personOwners: TEST_PROFILE.fixture.people,
    links: TEST_PROFILE.fixture.links,
    projections: TEST_PROFILE.fixture.projections,
    relationships: 1
  });
  assert.equal(fixture.logicalSha256, expectedHash);
  const verified = await verifyPeoplePerformanceFixture({
    dataRoot,
    repositoryRoot,
    profile: TEST_PROFILE
  });
  assert.equal(verified.logicalSha256, expectedHash);
  assert.equal(canonicalJson(verified.counts), canonicalJson(fixture.counts));
  await assert.rejects(
    () =>
      createPeoplePerformanceFixture({
        dataRoot,
        repositoryRoot,
        profile: TEST_PROFILE,
        initializeDatabase: (root) =>
          initializeIsolatedForgeDatabase(root, repositoryRoot)
      }),
    /unexpectedly contains/u
  );
});

test("small scale fixtures exercise production claims, restarts, plans, and integrity", async (t) => {
  const runRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-people-scale-performance-test-")
  );
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const dataRoot = path.join(runRoot, "scale-fixture");
  const fixture = await createPeopleScalePerformanceFixture({
    dataRoot,
    repositoryRoot,
    profile: TEST_PROFILE,
    initializeDatabase: (root) =>
      initializeIsolatedForgeDatabase(root, repositoryRoot)
  });
  assert.deepEqual(fixture.counts, {
    people: TEST_PROFILE.scale.people,
    personOwners: TEST_PROFILE.scale.people,
    links: TEST_PROFILE.scale.links,
    relationships: TEST_PROFILE.scale.relationships,
    relationshipDevices: TEST_PROFILE.scale.relationships,
    projections: TEST_PROFILE.scale.projections,
    outbox: TEST_PROFILE.scale.outbox
  });
  const verified = await verifyPeopleScalePerformanceFixture({
    dataRoot,
    repositoryRoot,
    profile: TEST_PROFILE
  });
  assert.equal(verified.sqliteIntegrity, "ok");
  assert.equal(verified.foreignKeyViolations, 0);
  const protocol = await runPeopleScalePerformanceProtocol({
    repositoryRoot,
    dataRoot,
    runRoot,
    profile: TEST_PROFILE,
    budgets: await loadBudgets(null)
  });
  assert.equal(
    protocol.status,
    "pass",
    JSON.stringify(protocol.checks, null, 2)
  );
  assert.equal(protocol.queryPlans.length, 5);
  const productionPlans = protocol.queryPlans.filter((plan) =>
    plan.id.startsWith("production_outbox_")
  );
  assert.deepEqual(
    productionPlans.map((plan) => plan.id),
    [
      "production_outbox_due_candidates",
      "production_outbox_in_flight_candidates"
    ]
  );
  assert.ok(
    productionPlans.every(
      (plan) =>
        plan.source.includes("PEER_OUTBOX_CANDIDATE_STATEMENTS") &&
        plan.status === "pass" &&
        plan.missingIndexes.length === 0 &&
        plan.fullTableScans.length === 0 &&
        plan.temporaryOrder.length === 0
    ),
    JSON.stringify(productionPlans, null, 2)
  );
  assert.ok(protocol.queryPlans.every((plan) => plan.status === "pass"));
  assert.equal(
    protocol.outboxClaim.claimedRows,
    (TEST_PROFILE.scale.claimWarmups + TEST_PROFILE.scale.claimSamples) *
      TEST_PROFILE.scale.claimBatchSize
  );
});
