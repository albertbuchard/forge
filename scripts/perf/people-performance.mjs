#!/usr/bin/env node

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  PERFORMANCE_BUDGET_BASIS,
  PEOPLE_PERFORMANCE_SCHEMA_VERSION,
  allChecksPass,
  assertPrivateEvidencePath,
  evaluateCeiling,
  loadBudgets,
  profileForMode,
  releaseCompletenessChecks,
  validatePeoplePerformanceResult
} from "./people-performance-contract.mjs";
import { createPeoplePerformanceFixture } from "./people-performance-fixture.mjs";
import { createPeopleScalePerformanceFixture } from "./people-performance-scale-fixture.mjs";
import { runPeopleScalePerformanceProtocol } from "./people-performance-scale.mjs";
import {
  accountPeopleRouteChunks,
  buildPeoplePerformanceServer,
  buildPeoplePerformanceWeb,
  initializeIsolatedForgeDatabase,
  runPeopleApiProtocol
} from "./people-performance-runtime.mjs";

const execFileAsync = promisify(execFile);
const VALID_SUITES = new Set(["fixture", "api", "scale", "bundle", "browser"]);
const RUN_MARKER = ".forge-people-performance-owned-run.json";

function canonicalRunMarker(mode) {
  return JSON.stringify({
    schemaVersion: PEOPLE_PERFORMANCE_SCHEMA_VERSION,
    kind: "forge_people_performance_owned_run",
    mode
  });
}

function usage() {
  return `Usage: node scripts/perf/people-performance.mjs [options]

Options:
  --mode <release|test>       Measurement profile (default: release)
  --only <suite,...>          fixture,api,scale,bundle,browser (default: all)
  --evidence <private-path>   Write full JSON outside this public repository
  --budgets <private-path>    Strict JSON budget overrides outside this repository
  --temp-parent <path>        Parent for retained run roots (default: OS temp)
  --retain-temp               Keep the owned temporary run root for debugging
  --timeout-ms <number>       Whole-run timeout (default: 45m release, 10m test)
  --help                      Show this help

Release mode enforces 10,000 browser People plus an isolated backend database
with 100 relationships, 100,000 projections, and 1,000,000 durable outbox rows.
It also requires 20 warmups plus 200 measured API/claim samples, repeated process
restarts, and five scroll runs on desktop and Pixel 7. Logs go to stderr; stdout
and written evidence redact local paths and secrets.`;
}

function valueAfter(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function parseCliArguments(args) {
  const options = {
    mode: "release",
    suites: new Set(VALID_SUITES),
    evidencePath: null,
    budgetPath: null,
    tempParent: os.tmpdir(),
    retainTemp: false,
    timeoutMs: null,
    help: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--mode") {
      options.mode = valueAfter(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--only") {
      const raw = valueAfter(args, index, argument);
      const suites = raw === "all" ? [...VALID_SUITES] : raw.split(",");
      if (
        suites.length === 0 ||
        suites.some((suite) => !VALID_SUITES.has(suite))
      ) {
        throw new Error(`--only accepts: ${[...VALID_SUITES].join(", ")}`);
      }
      options.suites = new Set(suites);
      index += 1;
      continue;
    }
    if (argument === "--evidence") {
      options.evidencePath = path.resolve(valueAfter(args, index, argument));
      index += 1;
      continue;
    }
    if (argument === "--budgets") {
      options.budgetPath = path.resolve(valueAfter(args, index, argument));
      index += 1;
      continue;
    }
    if (argument === "--temp-parent") {
      options.tempParent = path.resolve(valueAfter(args, index, argument));
      index += 1;
      continue;
    }
    if (argument === "--retain-temp") {
      options.retainTemp = true;
      continue;
    }
    if (argument === "--timeout-ms") {
      const value = Number.parseInt(valueAfter(args, index, argument), 10);
      if (!Number.isInteger(value) || value < 1_000) {
        throw new Error("--timeout-ms must be an integer of at least 1000.");
      }
      options.timeoutMs = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown People performance option: ${argument}`);
  }
  profileForMode(options.mode);
  return options;
}

async function packageVersion(repositoryRoot, packagePath) {
  const parsed = JSON.parse(
    await readFile(path.join(repositoryRoot, packagePath), "utf8")
  );
  return parsed.version ?? null;
}

async function gitMetadata(repositoryRoot) {
  const run = async (args) =>
    (await execFileAsync("git", args, { cwd: repositoryRoot })).stdout.trim();
  const [branch, commit, status] = await Promise.all([
    run(["branch", "--show-current"]),
    run(["rev-parse", "HEAD"]),
    run(["status", "--porcelain=v1", "--untracked-files=all"])
  ]);
  return {
    branch,
    commit,
    dirty: status.length > 0,
    changedPathCount: status ? status.split("\n").length : 0
  };
}

async function environmentMetadata(repositoryRoot) {
  return {
    capturedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    osType: os.type(),
    osRelease: os.release(),
    osVersion: os.version(),
    hostname: os.hostname(),
    cpuModel: os.cpus()[0]?.model ?? null,
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
    viteVersion: await packageVersion(
      repositoryRoot,
      "node_modules/vite/package.json"
    ),
    playwrightVersion: await packageVersion(
      repositoryRoot,
      "node_modules/@playwright/test/package.json"
    ),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    git: await gitMetadata(repositoryRoot)
  };
}

async function runBrowserSpec({
  repositoryRoot,
  runRoot,
  dataRoot,
  buildDir,
  compiledServer,
  mode,
  budgets,
  signal = null
}) {
  signal?.throwIfAborted();
  const configPath = path.join(
    runRoot,
    "people-performance-browser-config.json"
  );
  const resultPath = path.join(
    runRoot,
    "people-performance-browser-result.json"
  );
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        mode,
        repositoryRoot,
        dataRoot,
        buildDir,
        compiledServer,
        runRoot,
        budgets
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const playwrightCli = path.join(
    repositoryRoot,
    "node_modules",
    "@playwright",
    "test",
    "cli.js"
  );
  const config = path.join(
    repositoryRoot,
    "scripts",
    "perf",
    "people-performance.playwright.config.mjs"
  );
  const spec = path.join(
    repositoryRoot,
    "tests",
    "e2e",
    "people-performance.spec.ts"
  );
  const command = [playwrightCli, "test", "--config", config, spec];
  signal?.throwIfAborted();
  const detached = process.platform !== "win32";
  const child = spawn(process.execPath, command, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      FORGE_PEOPLE_PERF_BROWSER_CONFIG: configPath,
      FORGE_PEOPLE_PERF_BROWSER_RESULT: resultPath
    },
    detached,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      const text = chunk.toString();
      output = (output + text).slice(-80_000);
      process.stderr.write(text);
    });
  }
  let timedOut = false;
  let aborted = false;
  const signalProcessTree = (signal) => {
    if (detached && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    child.kill(signal);
  };
  const terminate = () => {
    if (child.exitCode === null && child.signalCode === null) {
      signalProcessTree("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          signalProcessTree("SIGKILL");
        }
      }, 5_000).unref();
    }
  };
  const timer = setTimeout(
    () => {
      timedOut = true;
      terminate();
    },
    mode === "release" ? 30 * 60_000 : 10 * 60_000
  );
  timer.unref();
  const onAbort = () => {
    aborted = true;
    terminate();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const exit = await new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  signal?.removeEventListener("abort", onAbort);
  if (timedOut || aborted) {
    throw new Error(
      timedOut
        ? "People browser E2E timed out."
        : "People browser E2E was aborted."
    );
  }
  let browserResult;
  try {
    browserResult = JSON.parse(await readFile(resultPath, "utf8"));
  } catch (error) {
    throw new Error(
      `People browser E2E produced no result (code=${exit.code}, signal=${exit.signal}).\n${output}\n${error instanceof Error ? error.message : String(error)}`
    );
  }
  const runnerCheck = evaluateCeiling({
    id: "browser.runner.exit_code",
    actual: exit.code === 0 ? 0 : 1,
    ceiling: 0,
    unit: "boolean"
  });
  const checks = [...(browserResult.checks ?? []), runnerCheck];
  return {
    ...browserResult,
    status: allChecksPass(checks) ? "pass" : "fail",
    checks,
    runner: {
      command: `${process.execPath} ${command.join(" ")}`,
      exitCode: exit.code,
      signal: exit.signal,
      configPath,
      resultPath
    }
  };
}

function selectedSuiteNeedsFixture(suites) {
  return suites.has("fixture") || suites.has("browser");
}

function selectedSuiteNeedsScaleFixture(suites) {
  return suites.has("fixture") || suites.has("api") || suites.has("scale");
}

function selectedSuiteNeedsBuild(suites) {
  return suites.has("bundle") || suites.has("browser");
}

function selectedSuiteNeedsCompiledServer(suites) {
  return (
    suites.has("fixture") ||
    suites.has("api") ||
    suites.has("scale") ||
    suites.has("browser")
  );
}

function replacePath(value, root, replacement) {
  if (!root || typeof value !== "string") return value;
  return value.split(path.resolve(root)).join(replacement);
}

export function redactPeoplePerformanceEvidence(result, roots) {
  const visit = (value, key = "") => {
    if (Array.isArray(value)) return value.map((item) => visit(item, key));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, childValue]) => [
          childKey,
          visit(childValue, childKey)
        ])
      );
    }
    if (typeof value !== "string") return value;
    if (/(?:password|secret|bearer|private[_-]?key|ciphertext)/iu.test(key)) {
      return "<redacted>";
    }
    let redacted = value;
    redacted = redacted.split(process.execPath).join("<node>");
    redacted = replacePath(redacted, roots.repositoryRoot, "<repository-root>");
    redacted = replacePath(redacted, roots.runRoot, "<run-root>");
    redacted = replacePath(redacted, roots.evidencePath, "<evidence-path>");
    redacted = replacePath(redacted, roots.budgetPath, "<budget-path>");
    redacted = replacePath(redacted, os.homedir(), "<home>");
    return redacted;
  };
  const redacted = visit(result);
  if (redacted.environment) redacted.environment.hostname = "<redacted>";
  const serialized = JSON.stringify(redacted);
  for (const forbidden of [
    roots.repositoryRoot,
    roots.runRoot,
    roots.evidencePath,
    roots.budgetPath,
    os.homedir()
  ].filter(Boolean)) {
    if (serialized.includes(path.resolve(forbidden))) {
      throw new Error(
        "People performance evidence contains an unredacted path."
      );
    }
  }
  return redacted;
}

async function emitResult(result, evidencePath, roots) {
  const evidence = redactPeoplePerformanceEvidence(result, roots);
  const json = `${JSON.stringify(evidence, null, 2)}\n`;
  if (!evidencePath) {
    process.stdout.write(json);
    return;
  }
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, json, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  process.stderr.write(`[people-performance] evidence: ${evidencePath}\n`);
  process.stdout.write(
    `${JSON.stringify({
      status: result.status,
      evidencePath: "<private-evidence-path>",
      temporaryRootPolicy: result.temporaryRoots?.deletionPolicy ?? null
    })}\n`
  );
}

export async function removeOwnedRunRoot(runRoot, tempParent) {
  const resolvedRunRoot = path.resolve(runRoot);
  const resolvedParent = path.resolve(tempParent);
  if (
    path.dirname(resolvedRunRoot) !== resolvedParent ||
    !path.basename(resolvedRunRoot).startsWith("forge-people-performance-")
  ) {
    throw new Error(
      `Refusing to remove a non-owned People performance root: ${resolvedRunRoot}`
    );
  }
  const marker = JSON.parse(
    await readFile(path.join(resolvedRunRoot, RUN_MARKER), "utf8")
  );
  if (marker.kind !== "forge_people_performance_owned_run") {
    throw new Error(
      `Refusing to remove People performance root without its marker: ${resolvedRunRoot}`
    );
  }
  await rm(resolvedRunRoot, { recursive: true, force: false, maxRetries: 3 });
}

export async function runPeoplePerformanceCli(args = process.argv.slice(2)) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    ".."
  );
  const options = parseCliArguments(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return { status: "help", exitCode: 0 };
  }
  assertPrivateEvidencePath(options.evidencePath, repositoryRoot);
  assertPrivateEvidencePath(options.budgetPath, repositoryRoot);
  await mkdir(options.tempParent, { recursive: true });
  const runRoot = await mkdtemp(
    path.join(options.tempParent, "forge-people-performance-")
  );
  await writeFile(
    path.join(runRoot, RUN_MARKER),
    `${canonicalRunMarker(options.mode)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 }
  );
  const browserDataRoot = path.join(runRoot, "browser-fixture");
  const scaleDataRoot = path.join(runRoot, "scale-fixture");
  const buildDir = path.join(runRoot, "web-dist");
  const compiledServerRuntimeRoot = path.join(
    runRoot,
    "compiled-server-runtime"
  );
  const profile = profileForMode(options.mode);
  const budgets = await loadBudgets(options.budgetPath);
  const abortController = new AbortController();
  const timeoutMs =
    options.timeoutMs ??
    (options.mode === "release" ? 45 * 60_000 : 10 * 60_000);
  const timeout = setTimeout(() => {
    abortController.abort(
      new Error(`People performance run timed out after ${timeoutMs}ms.`)
    );
  }, timeoutMs);
  timeout.unref();
  const onSignal = (signal) => {
    abortController.abort(
      new Error(`People performance run interrupted by ${signal}.`)
    );
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  const startedAt = performance.now();
  const result = {
    schemaVersion: PEOPLE_PERFORMANCE_SCHEMA_VERSION,
    kind: "forge_people_performance",
    mode: options.mode,
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: null,
    invocation:
      `${process.execPath} ${process.argv[1]} ${args.join(" ")}`.trim(),
    selectedSuites: [...options.suites],
    repositoryRoot,
    environment: await environmentMetadata(repositoryRoot),
    budgets,
    budgetBasis: PERFORMANCE_BUDGET_BASIS,
    timeoutMs,
    temporaryRoots: {
      runRoot,
      browserDataRoot: selectedSuiteNeedsFixture(options.suites)
        ? browserDataRoot
        : null,
      scaleDataRoot: selectedSuiteNeedsScaleFixture(options.suites)
        ? scaleDataRoot
        : null,
      buildDir: selectedSuiteNeedsBuild(options.suites) ? buildDir : null,
      compiledServerRuntimeRoot: selectedSuiteNeedsCompiledServer(
        options.suites
      )
        ? compiledServerRuntimeRoot
        : null,
      browserProfileRoot: options.suites.has("browser")
        ? path.join(runRoot, "browser-profiles")
        : null,
      deletionPolicy: options.retainTemp
        ? "retained by explicit --retain-temp"
        : "removed after measurement using the exact owned-run marker"
    }
  };
  process.stderr.write(`[people-performance] owned run root: ${runRoot}\n`);
  try {
    const checkpoint = () => abortController.signal.throwIfAborted();
    let compiledServer = null;
    if (selectedSuiteNeedsCompiledServer(options.suites)) {
      checkpoint();
      process.stderr.write(
        "[people-performance] building isolated compiled server runtime\n"
      );
      compiledServer = await buildPeoplePerformanceServer({
        repositoryRoot,
        runRoot,
        signal: abortController.signal
      });
      result.compiledServer = compiledServer;
    }
    result.fixtures = {};
    if (selectedSuiteNeedsFixture(options.suites)) {
      checkpoint();
      process.stderr.write(
        `[people-performance] creating isolated browser fixture (${profile.fixture.people} People)\n`
      );
      result.fixtures.browser = await createPeoplePerformanceFixture({
        dataRoot: browserDataRoot,
        repositoryRoot,
        profile,
        initializeDatabase: (root, signal) =>
          initializeIsolatedForgeDatabase(
            root,
            repositoryRoot,
            compiledServer,
            signal
          ),
        signal: abortController.signal
      });
    }
    if (selectedSuiteNeedsScaleFixture(options.suites)) {
      checkpoint();
      process.stderr.write(
        `[people-performance] creating isolated scale fixture (${profile.scale.relationships} relationships, ${profile.scale.projections} projections, ${profile.scale.outbox} outbox rows)\n`
      );
      result.fixtures.scale = await createPeopleScalePerformanceFixture({
        dataRoot: scaleDataRoot,
        repositoryRoot,
        profile,
        initializeDatabase: (root, signal) =>
          initializeIsolatedForgeDatabase(
            root,
            repositoryRoot,
            compiledServer,
            signal
          ),
        signal: abortController.signal
      });
    }
    if (selectedSuiteNeedsBuild(options.suites)) {
      checkpoint();
      process.stderr.write(
        "[people-performance] building temporary production UI\n"
      );
      result.build = await buildPeoplePerformanceWeb({
        repositoryRoot,
        buildDir,
        signal: abortController.signal
      });
    }
    if (options.suites.has("api")) {
      checkpoint();
      process.stderr.write(
        "[people-performance] running serialized API protocol\n"
      );
      result.api = await runPeopleApiProtocol({
        repositoryRoot,
        dataRoot: scaleDataRoot,
        compiledServer,
        profile,
        budgets,
        signal: abortController.signal
      });
    }
    if (options.suites.has("scale")) {
      checkpoint();
      process.stderr.write(
        "[people-performance] running restart, query-plan, and million-row claim protocol\n"
      );
      result.scale = await runPeopleScalePerformanceProtocol({
        repositoryRoot,
        dataRoot: scaleDataRoot,
        compiledServer,
        runRoot,
        profile,
        budgets,
        signal: abortController.signal
      });
    }
    if (options.suites.has("bundle")) {
      checkpoint();
      process.stderr.write("[people-performance] accounting route chunks\n");
      result.bundle = await accountPeopleRouteChunks({
        buildDir,
        manifestPath: result.build.manifestPath,
        budgets
      });
    }
    if (options.suites.has("browser")) {
      checkpoint();
      process.stderr.write(
        "[people-performance] running browser E2E protocol\n"
      );
      result.browser = await runBrowserSpec({
        repositoryRoot,
        runRoot,
        dataRoot: browserDataRoot,
        buildDir,
        compiledServer,
        mode: options.mode,
        budgets,
        signal: abortController.signal
      });
    }

    const fixtureChecks = Object.entries(result.fixtures ?? {}).map(
      ([name, fixture]) => ({
        id: `fixture.${name}.verified`,
        status:
          fixture?.sqliteIntegrity === undefined ||
          fixture.sqliteIntegrity === "ok"
            ? "pass"
            : "fail",
        actual: 1,
        floor: 1,
        unit: "boolean"
      })
    );
    const suiteChecks = [
      result.api,
      result.scale,
      result.bundle,
      result.browser
    ]
      .filter(Boolean)
      .flatMap((suite) => suite.checks ?? []);
    const completenessChecks = releaseCompletenessChecks(profile, result);
    result.checks = [...fixtureChecks, ...suiteChecks, ...completenessChecks];
    result.failures = result.checks.filter((check) => check.status !== "pass");
    result.status = allChecksPass(result.checks) ? "pass" : "fail";
    validatePeoplePerformanceResult(result, profile);
  } catch (error) {
    result.status = "error";
    result.error = {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack ?? null) : null
    };
  } finally {
    clearTimeout(timeout);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    if (options.retainTemp) {
      result.cleanup = { status: "retained", runRoot };
      process.stderr.write(
        `[people-performance] temporary root retained by request: ${runRoot}\n`
      );
    } else {
      try {
        await removeOwnedRunRoot(runRoot, options.tempParent);
        result.cleanup = { status: "removed", runRoot: "<removed>" };
      } catch (cleanupError) {
        result.status = "error";
        result.cleanup = {
          status: "error",
          message:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError)
        };
        result.error ??= {
          name: cleanupError instanceof Error ? cleanupError.name : "Error",
          message:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
          stack:
            cleanupError instanceof Error ? (cleanupError.stack ?? null) : null
        };
      }
    }
  }
  result.completedAt = new Date().toISOString();
  result.durationMs = performance.now() - startedAt;
  await emitResult(result, options.evidencePath, {
    repositoryRoot,
    runRoot,
    evidencePath: options.evidencePath,
    budgetPath: options.budgetPath
  });
  return {
    status: result.status,
    exitCode: result.status === "pass" ? 0 : result.status === "fail" ? 1 : 2
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const outcome = await runPeoplePerformanceCli();
    process.exitCode = outcome.exitCode;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        status: "error",
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error)
        }
      })}\n`
    );
    process.exitCode = 2;
  }
}
