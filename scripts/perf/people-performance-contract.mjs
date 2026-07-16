import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const PEOPLE_PERFORMANCE_SCHEMA_VERSION = 2;
export const PEOPLE_FIXTURE_ID = "forge-people-performance-v2";
export const PEOPLE_FIXTURE_MARKER = ".forge-people-performance-root.json";
export const PEOPLE_FIXTURE_MANIFEST = "people-performance-fixture.json";
export const PEOPLE_SCALE_FIXTURE_ID = "forge-people-scale-performance-v1";
export const PEOPLE_SCALE_FIXTURE_MARKER =
  ".forge-people-scale-performance-root.json";
export const PEOPLE_SCALE_FIXTURE_MANIFEST =
  "people-scale-performance-fixture.json";

export const RELEASE_PROFILE = Object.freeze({
  mode: "release",
  fixture: Object.freeze({ people: 10_000, links: 500, projections: 1_000 }),
  scale: Object.freeze({
    people: 10_000,
    links: 500,
    relationships: 100,
    projections: 100_000,
    outbox: 1_000_000,
    insertBatchSize: 25_000,
    restartSamples: 3,
    claimWarmups: 20,
    claimSamples: 200,
    claimBatchSize: 50
  }),
  api: Object.freeze({ warmups: 20, samples: 200 }),
  browser: Object.freeze({ coldSamples: 10, warmSamples: 20 }),
  memory: Object.freeze({ traversals: 20, sampleEvery: 5 }),
  scroll: Object.freeze({ runsPerDevice: 5, phaseDurationMs: 15_000 })
});

export const TEST_PROFILE = Object.freeze({
  mode: "test",
  fixture: Object.freeze({ people: 120, links: 20, projections: 40 }),
  scale: Object.freeze({
    people: 120,
    links: 20,
    relationships: 4,
    projections: 400,
    outbox: 2_000,
    insertBatchSize: 500,
    restartSamples: 2,
    claimWarmups: 1,
    claimSamples: 3,
    claimBatchSize: 10
  }),
  api: Object.freeze({ warmups: 2, samples: 8 }),
  browser: Object.freeze({ coldSamples: 1, warmSamples: 2 }),
  memory: Object.freeze({ traversals: 2, sampleEvery: 1 }),
  scroll: Object.freeze({ runsPerDevice: 1, phaseDurationMs: 350 })
});

export const DEFAULT_BUDGETS = Object.freeze({
  api: Object.freeze({
    listP95Ms: 150,
    searchP95Ms: 150,
    contextP95Ms: 250
  }),
  scale: Object.freeze({
    outboxClaimP95Ms: 200,
    startupP95Ms: 5_000,
    restartP95Ms: 5_000
  }),
  browser: Object.freeze({
    coldFirstUsefulContentP95Ms: 2_000,
    warmFirstUsefulContentP95Ms: 1_000
  }),
  memory: Object.freeze({
    serverRssMaxMiB: 650,
    serverRssRetainedMiB: 64,
    serverHeapMaxMiB: 256,
    serverHeapRetainedMiB: 32,
    browserJsHeapMaxMiB: 256,
    browserJsHeapRetainedMiB: 25.6
  }),
  scroll: Object.freeze({
    desktopMinimumFps: 55,
    desktopP95FrameDurationMs: 18.2,
    mobileMinimumFps: 50,
    mobileP95FrameDurationMs: 20,
    maximumBlankFrames: 0,
    maximumContentLossSamples: 0,
    maximumBlueFlashFrames: 0
  }),
  bundle: Object.freeze({
    peopleLazyGzipKiB: 300,
    peopleRouteTotalGzipKiB: 900
  })
});

export const PERFORMANCE_BUDGET_BASIS = Object.freeze({
  api: "Binding People goal: search p95 <= 150 ms and context p95 <= 250 ms; list and cursor pages use the stricter 150 ms ceiling.",
  outbox:
    "Binding People goal: due-message claim p95 <= 200 ms at one million durable outbox rows.",
  browser:
    "Binding People goal: first useful content <= 1.0 s warm and <= 2.0 s cold.",
  scroll:
    "Binding People goal: desktop p5 FPS >= 55/p95 frame <= 18.2 ms and phone p5 FPS >= 50/p95 frame <= 20 ms on a 60 Hz reference cadence; raw runner cadence remains recorded; zero blank, blue, or content-loss frames.",
  memory:
    "Binding People goal: API RSS <= 650 MiB, V8 heap <= 256 MiB, retained RSS <= 64 MiB, renderer heap <= 256 MiB and retained growth <= 10%.",
  startup:
    "Operational five-second startup/restart ceiling; actual p50/p95/p99 remain visible for later tightening."
});

const REQUIRED_SUITE_CHECK_IDS = Object.freeze({
  api: Object.freeze([
    "api.list.p95",
    "api.search.p95",
    "api.context.p95",
    "api.cursor_page.p95"
  ]),
  scale: Object.freeze([
    "scale.startup.first",
    "scale.restart.p95",
    "scale.outbox_claim.p95",
    "scale.outbox_claim.row_accounting",
    "scale.server.rss_max",
    "scale.server.heap_max",
    "scale.claim_worker.rss_max",
    "scale.claim_worker.rss_retained",
    "scale.claim_worker.heap_max",
    "scale.claim_worker.heap_retained",
    "scale.sqlite_integrity",
    "scale.sqlite_foreign_keys",
    "scale.query_plan.people_owner_cursor_page",
    "scale.query_plan.peer_relationship_owner_state",
    "scale.query_plan.remote_projection_exact_query",
    "scale.query_plan.production_outbox_due_candidates",
    "scale.query_plan.production_outbox_in_flight_candidates"
  ]),
  bundle: Object.freeze([
    "bundle.people_combined_lazy.gzip",
    "bundle.people_list_total.gzip"
  ])
});

export function requiredPeoplePerformanceSuiteCheckIds(profile, suiteName) {
  if (suiteName !== "browser") {
    const ids = REQUIRED_SUITE_CHECK_IDS[suiteName];
    if (!ids) throw new Error(`Unknown People performance suite: ${suiteName}`);
    return [...ids];
  }
  const ids = [
    "browser.cold_first_useful_content.p95",
    "browser.warm_first_useful_content.p95",
    "memory.server.rss_max",
    "memory.server.rss_retained",
    "memory.server.heap_max",
    "memory.server.heap_retained",
    "memory.browser.js_heap_max",
    "memory.browser.js_heap_retained"
  ];
  const scrollMetrics = [
    "fps",
    "p95_frame",
    "blank_frames",
    "blue_flash_frames",
    "content_loss",
    "height_stability",
    "return_to_top"
  ];
  for (const device of ["desktop", "pixel_7"]) {
    for (let run = 1; run <= profile.scroll.runsPerDevice; run += 1) {
      for (const metric of scrollMetrics) {
        ids.push(`scroll.${device}.run_${run}.${metric}`);
      }
    }
  }
  return ids;
}

export function profileForMode(mode) {
  if (mode === "release") return RELEASE_PROFILE;
  if (mode === "test") return TEST_PROFILE;
  throw new Error(`Unsupported People performance mode: ${String(mode)}`);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function logicalFixtureSha256(rows) {
  const hash = createHash("sha256");
  for (const row of rows) {
    hash.update(canonicalJson(row));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function nearestRankPercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("A percentile requires at least one finite sample.");
  }
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new Error("A percentile must be greater than zero and at most one.");
  }
  const sorted = values.map((value) => {
    if (!Number.isFinite(value)) {
      throw new Error("A percentile sample is not finite.");
    }
    return value;
  });
  sorted.sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
}

export function summarizeDurations(values) {
  if (values.length === 0) {
    throw new Error("Duration summary requires at least one sample.");
  }
  return {
    count: values.length,
    p50Ms: nearestRankPercentile(values, 0.5),
    medianMs: nearestRankPercentile(values, 0.5),
    p95Ms: nearestRankPercentile(values, 0.95),
    p99Ms: nearestRankPercentile(values, 0.99),
    maxMs: Math.max(...values),
    minMs: Math.min(...values)
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeBudgetObject(defaults, override, prefix = "budgets") {
  if (!isPlainObject(override)) {
    throw new Error(`${prefix} must be a JSON object.`);
  }
  const unknown = Object.keys(override).filter((key) => !(key in defaults));
  if (unknown.length > 0) {
    throw new Error(`${prefix} contains unknown keys: ${unknown.join(", ")}`);
  }
  const result = {};
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const candidate = override[key];
    if (isPlainObject(defaultValue)) {
      result[key] = mergeBudgetObject(
        defaultValue,
        candidate === undefined ? {} : candidate,
        `${prefix}.${key}`
      );
      continue;
    }
    const value = candidate === undefined ? defaultValue : candidate;
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${prefix}.${key} must be a finite nonnegative number.`);
    }
    result[key] = value;
  }
  return result;
}

export async function loadBudgets(budgetPath) {
  if (!budgetPath) return structuredClone(DEFAULT_BUDGETS);
  const parsed = JSON.parse(await readFile(budgetPath, "utf8"));
  return mergeBudgetObject(DEFAULT_BUDGETS, parsed);
}

export function evaluateCeiling({ id, actual, ceiling, unit }) {
  if (!Number.isFinite(actual) || !Number.isFinite(ceiling)) {
    return {
      id,
      status: "fail",
      actual,
      ceiling,
      unit,
      reason: "non_finite_measurement"
    };
  }
  return {
    id,
    status: actual <= ceiling ? "pass" : "fail",
    actual,
    ceiling,
    unit
  };
}

export function evaluateFloor({ id, actual, floor, unit }) {
  if (!Number.isFinite(actual) || !Number.isFinite(floor)) {
    return {
      id,
      status: "fail",
      actual,
      floor,
      unit,
      reason: "non_finite_measurement"
    };
  }
  return {
    id,
    status: actual >= floor ? "pass" : "fail",
    actual,
    floor,
    unit
  };
}

export function allChecksPass(checks) {
  return checks.every((check) => check.status === "pass");
}

function pathIsInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function assertPrivateEvidencePath(evidencePath, repositoryRoot) {
  if (!evidencePath) return;
  if (pathIsInside(evidencePath, repositoryRoot)) {
    throw new Error(
      `Private performance evidence must stay outside the public Forge repository: ${evidencePath}`
    );
  }
}

export function protectedForgeDataRoots(
  repositoryRoot,
  environment = process.env
) {
  const monorepoRoot = path.resolve(repositoryRoot, "..", "..");
  const configured = [
    environment.FORGE_DATA_ROOT,
    ...(environment.FORGE_PROTECTED_DATA_ROOTS ?? "").split(path.delimiter)
  ]
    .map((entry) => entry?.trim())
    .filter(Boolean);
  return [
    path.join(monorepoRoot, "data", "forge"),
    path.join(monorepoRoot, "private", "forge-backups"),
    path.join(os.homedir(), ".forge"),
    path.join(os.homedir(), ".openclaw", "forge"),
    path.join(os.homedir(), ".openclaw", "extensions", "forge-openclaw-plugin"),
    path.join(os.homedir(), ".local", "share", "forge"),
    path.join(os.homedir(), "Library", "Application Support", "Forge"),
    ...configured.map((entry) => path.resolve(entry))
  ];
}

export function assertNotProtectedDataRoot(
  candidate,
  repositoryRoot,
  environment = process.env
) {
  const resolved = path.resolve(candidate);
  for (const protectedRoot of protectedForgeDataRoots(
    repositoryRoot,
    environment
  )) {
    if (
      pathIsInside(resolved, protectedRoot) ||
      pathIsInside(protectedRoot, resolved)
    ) {
      throw new Error(
        `People performance tooling refuses protected Forge data root: ${resolved}`
      );
    }
  }
}

export function releaseCompletenessChecks(profile, result) {
  if (profile.mode !== "release") return [];
  const checks = [];
  const selected = new Set(result.selectedSuites ?? []);
  for (const suite of ["fixture", "api", "scale", "bundle", "browser"]) {
    checks.push(
      evaluateFloor({
        id: `release.suite.${suite}.selected`,
        actual: selected.has(suite) ? 1 : 0,
        floor: 1,
        unit: "boolean"
      })
    );
  }
  for (const key of ["people", "links", "projections"]) {
    checks.push(
      evaluateCeiling({
        id: `release.fixture.${key}.exact`,
        actual: Math.abs(
          (result.fixtures?.browser?.counts?.[key] ?? 0) -
            RELEASE_PROFILE.fixture[key]
        ),
        ceiling: 0,
        unit: "row_difference"
      })
    );
  }
  for (const key of [
    "people",
    "links",
    "relationships",
    "projections",
    "outbox"
  ]) {
    checks.push(
      evaluateCeiling({
        id: `release.scale_fixture.${key}.exact`,
        actual: Math.abs(
          (result.fixtures?.scale?.counts?.[key] ?? 0) -
            RELEASE_PROFILE.scale[key]
        ),
        ceiling: 0,
        unit: "row_difference"
      })
    );
  }
  for (const name of ["list", "search", "context"]) {
    const metric = result.api?.scenarios?.[name];
    checks.push(
      evaluateFloor({
        id: `release.api.${name}.warmups`,
        actual: metric?.protocol?.warmups ?? 0,
        floor: RELEASE_PROFILE.api.warmups,
        unit: "request"
      }),
      evaluateFloor({
        id: `release.api.${name}.samples`,
        actual: metric?.summary?.count ?? 0,
        floor: RELEASE_PROFILE.api.samples,
        unit: "request"
      })
    );
    for (const percentile of ["p50Ms", "p95Ms", "p99Ms"]) {
      checks.push(
        evaluateFloor({
          id: `release.api.${name}.${percentile}.finite`,
          actual: Number.isFinite(metric?.summary?.[percentile]) ? 1 : 0,
          floor: 1,
          unit: "boolean"
        })
      );
    }
  }
  checks.push(
    evaluateCeiling({
      id: "release.api.cursor.unique_people",
      actual: Math.abs(
        (result.api?.cursorTraversal?.protocol?.uniquePeople ?? 0) -
          RELEASE_PROFILE.scale.people
      ),
      ceiling: 0,
      unit: "row_difference"
    }),
    evaluateFloor({
      id: "release.api.cursor.p99.finite",
      actual: Number.isFinite(result.api?.cursorTraversal?.summary?.p99Ms)
        ? 1
        : 0,
      floor: 1,
      unit: "boolean"
    }),
    evaluateFloor({
      id: "release.bundle.present",
      actual: result.bundle ? 1 : 0,
      floor: 1,
      unit: "boolean"
    }),
    evaluateFloor({
      id: "release.browser.cold_samples",
      actual: result.browser?.firstUsefulContent?.cold?.summary?.count ?? 0,
      floor: RELEASE_PROFILE.browser.coldSamples,
      unit: "sample"
    }),
    evaluateFloor({
      id: "release.browser.warm_samples",
      actual: result.browser?.firstUsefulContent?.warm?.summary?.count ?? 0,
      floor: RELEASE_PROFILE.browser.warmSamples,
      unit: "sample"
    }),
    evaluateFloor({
      id: "release.browser.memory_traversals",
      actual: result.browser?.memory?.summary?.traversals ?? 0,
      floor: RELEASE_PROFILE.memory.traversals,
      unit: "traversal"
    }),
    evaluateFloor({
      id: "release.browser.scroll.desktop_runs",
      actual: result.browser?.scroll?.desktop?.runs?.length ?? 0,
      floor: RELEASE_PROFILE.scroll.runsPerDevice,
      unit: "run"
    }),
    evaluateFloor({
      id: "release.browser.scroll.pixel_7_runs",
      actual: result.browser?.scroll?.pixel7?.runs?.length ?? 0,
      floor: RELEASE_PROFILE.scroll.runsPerDevice,
      unit: "run"
    }),
    evaluateFloor({
      id: "release.scale.restart_samples",
      actual: result.scale?.restart?.summary?.count ?? 0,
      floor: RELEASE_PROFILE.scale.restartSamples,
      unit: "restart"
    }),
    evaluateFloor({
      id: "release.scale.claim_warmups",
      actual: result.scale?.outboxClaim?.protocol?.warmups ?? 0,
      floor: RELEASE_PROFILE.scale.claimWarmups,
      unit: "claim"
    }),
    evaluateFloor({
      id: "release.scale.claim_samples",
      actual: result.scale?.outboxClaim?.summary?.count ?? 0,
      floor: RELEASE_PROFILE.scale.claimSamples,
      unit: "claim"
    }),
    evaluateFloor({
      id: "release.scale.query_plans",
      actual: result.scale?.queryPlans?.length ?? 0,
      floor: 5,
      unit: "plan"
    }),
    evaluateFloor({
      id: "release.scale.claim_p99.finite",
      actual: Number.isFinite(result.scale?.outboxClaim?.summary?.p99Ms)
        ? 1
        : 0,
      floor: 1,
      unit: "boolean"
    }),
    evaluateFloor({
      id: "release.scale.restart_p99.finite",
      actual: Number.isFinite(result.scale?.restart?.summary?.p99Ms) ? 1 : 0,
      floor: 1,
      unit: "boolean"
    }),
    evaluateFloor({
      id: "release.scale.sqlite_integrity",
      actual:
        result.fixtures?.scale?.sqliteIntegrity === "ok" &&
        result.fixtures?.scale?.foreignKeyViolations === 0
          ? 1
          : 0,
      floor: 1,
      unit: "boolean"
    })
  );
  return checks;
}

export function validatePeoplePerformanceResult(result, profile) {
  if (!isPlainObject(result)) {
    throw new Error("People performance evidence must be an object.");
  }
  if (
    result.schemaVersion !== PEOPLE_PERFORMANCE_SCHEMA_VERSION ||
    result.kind !== "forge_people_performance" ||
    result.mode !== profile.mode
  ) {
    throw new Error("People performance evidence header is malformed.");
  }
  if (!Array.isArray(result.checks) || result.checks.length === 0) {
    throw new Error("People performance evidence contains no checks.");
  }
  const ids = new Set();
  for (const check of result.checks) {
    if (!isPlainObject(check) || typeof check.id !== "string") {
      throw new Error(
        "People performance evidence contains a malformed check."
      );
    }
    if (ids.has(check.id)) {
      throw new Error(`People performance check is duplicated: ${check.id}`);
    }
    ids.add(check.id);
    if (!new Set(["pass", "fail"]).has(check.status)) {
      throw new Error(
        `People performance check has invalid status: ${check.id}`
      );
    }
    if (!Number.isFinite(check.actual)) {
      throw new Error(
        `People performance check has no finite measurement: ${check.id}`
      );
    }
    if (!Number.isFinite(check.ceiling) && !Number.isFinite(check.floor)) {
      throw new Error(
        `People performance check has no finite bound: ${check.id}`
      );
    }
    const computedCheckStatus =
      Number.isFinite(check.ceiling) && check.actual > check.ceiling
        ? "fail"
        : Number.isFinite(check.floor) && check.actual < check.floor
          ? "fail"
          : "pass";
    if (check.status !== computedCheckStatus) {
      throw new Error(
        `People performance check status is not derived from its measurement: ${check.id}`
      );
    }
  }
  const computedStatus = allChecksPass(result.checks) ? "pass" : "fail";
  if (result.status !== computedStatus) {
    throw new Error(
      `People performance status is not derived from its checks: declared ${result.status}, computed ${computedStatus}.`
    );
  }
  const selectedSuites = new Set(result.selectedSuites ?? []);
  const topLevelChecks = new Map(
    result.checks.map((check) => [check.id, check])
  );
  for (const suiteName of ["api", "scale", "bundle", "browser"]) {
    if (!selectedSuites.has(suiteName)) continue;
    const suite = result[suiteName];
    if (!isPlainObject(suite) || !Array.isArray(suite.checks)) {
      throw new Error(`People performance ${suiteName} suite has no checks.`);
    }
    const suiteIds = new Set();
    for (const check of suite.checks) {
      if (!isPlainObject(check) || typeof check.id !== "string") {
        throw new Error(
          `People performance ${suiteName} suite contains a malformed check.`
        );
      }
      if (suiteIds.has(check.id)) {
        throw new Error(
          `People performance ${suiteName} check is duplicated: ${check.id}`
        );
      }
      suiteIds.add(check.id);
      const topLevel = topLevelChecks.get(check.id);
      if (!topLevel || canonicalJson(topLevel) !== canonicalJson(check)) {
        throw new Error(
          `People performance ${suiteName} check is missing or differs at the top level: ${check.id}`
        );
      }
    }
    const missing = requiredPeoplePerformanceSuiteCheckIds(
      profile,
      suiteName
    ).filter((id) => !suiteIds.has(id));
    if (missing.length > 0) {
      throw new Error(
        `People performance ${suiteName} suite is missing required checks: ${missing.join(", ")}`
      );
    }
    const computedSuiteStatus = allChecksPass(suite.checks) ? "pass" : "fail";
    if (suite.status !== computedSuiteStatus) {
      throw new Error(
        `People performance ${suiteName} status is not derived from its checks.`
      );
    }
  }
  if (profile.mode === "release") {
    const required = releaseCompletenessChecks(profile, result);
    const missingOrFailed = required.filter((check) => check.status !== "pass");
    if (missingOrFailed.length > 0) {
      throw new Error(
        `People release evidence is incomplete: ${missingOrFailed.map((check) => check.id).join(", ")}`
      );
    }
  }
  return result;
}
