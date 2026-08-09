import { spawn } from "node:child_process";
import { gzipSync, brotliCompressSync } from "node:zlib";
import http from "node:http";
import net from "node:net";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import {
  allChecksPass,
  evaluateCeiling,
  sha256,
  summarizeDurations
} from "./people-performance-contract.mjs";
import { PEOPLE_FIXTURE_SUBJECT_ID } from "./people-performance-fixture.mjs";
import { verifyPeopleScalePerformanceFixture } from "./people-performance-scale-fixture.mjs";

const PROCESS_OUTPUT_LIMIT = 40_000;
const PEOPLE_LIST_RATE_WINDOW_MS = 60_000;
const PEOPLE_LIST_SAFE_WINDOW_COUNT = 175;

function unrefDelay(milliseconds) {
  return delay(milliseconds, undefined, { ref: false });
}

function appendBounded(current, next) {
  const combined = current + next;
  return combined.length <= PROCESS_OUTPUT_LIMIT
    ? combined
    : combined.slice(combined.length - PROCESS_OUTPUT_LIMIT);
}

export async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to reserve a loopback port.");
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

async function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return Promise.race([
    new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    unrefDelay(timeoutMs).then(() => null)
  ]);
}

export async function runCheckedSubprocess({
  command,
  args = [],
  cwd,
  env = process.env,
  timeoutMs = 120_000,
  signal = null
}) {
  signal?.throwIfAborted();
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout = appendBounded(stdout, chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk.toString());
  });
  let timedOut = false;
  let aborted = false;
  const terminate = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    if (!(await waitForExit(child, 5_000))) {
      child.kill("SIGKILL");
      await waitForExit(child, 2_000);
    }
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    void terminate();
  }, timeoutMs);
  timeout.unref();
  const onAbort = () => {
    aborted = true;
    void terminate();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const exit = await new Promise((resolve) => {
    child.once("exit", (code, childSignal) =>
      resolve({ code, signal: childSignal })
    );
  });
  clearTimeout(timeout);
  signal?.removeEventListener("abort", onAbort);
  if (timedOut || aborted || exit.code !== 0) {
    const reason = timedOut
      ? `timed out after ${timeoutMs}ms`
      : aborted
        ? "was aborted"
        : `exited with code ${exit.code} and signal ${exit.signal}`;
    throw new Error(
      `Subprocess ${command} ${args.join(" ")} ${reason}.\n${stderr || stdout}`
    );
  }
  return { ...exit, stdout, stderr };
}

export async function startPeoplePerformanceServer({
  repositoryRoot,
  dataRoot,
  port = null,
  webOrigin = null,
  startupTimeoutMs = 120_000,
  signal = null
}) {
  signal?.throwIfAborted();
  const resolvedPort = port ?? (await reserveLoopbackPort());
  const serverScript = path.join(
    repositoryRoot,
    "scripts",
    "perf",
    "people-performance-server.mjs"
  );
  const child = spawn(
    process.execPath,
    ["--expose-gc", "--import", "tsx", serverScript],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        FORGE_PEOPLE_PERF_DATA_ROOT: dataRoot,
        FORGE_PEOPLE_PERF_PORT: String(resolvedPort),
        FORGE_BASE_PATH: "/forge/",
        FORGE_DEV_WEB_AUTOSTART: "0",
        FORGE_PEER_ENABLED: "0",
        ...(webOrigin ? { FORGE_DEV_WEB_ORIGIN: webOrigin } : {})
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout = appendBounded(stdout, chunk.toString());
  });
  child.stderr?.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk.toString());
  });

  let ready;
  let operatorSessionCookie = null;
  let onStartupAbort = null;
  const abortReadiness = new Promise((_, reject) => {
    if (!signal) return;
    onStartupAbort = () => {
      reject(signal.reason ?? new Error("People server startup was aborted."));
    };
    signal.addEventListener("abort", onStartupAbort, { once: true });
  });
  try {
    ready = await Promise.race([
      new Promise((resolve, reject) => {
        const onExit = (code, signal) => {
          reject(
            new Error(
              `People performance server exited before readiness (code=${code}, signal=${signal}).\n${stderr || stdout}`
            )
          );
        };
        child.once("exit", onExit);
        child.on("message", (message) => {
          if (message?.type === "ready") {
            child.off("exit", onExit);
            const {
              operatorSessionCookie: receivedOperatorSessionCookie,
              ...publicReady
            } = message;
            if (
              typeof receivedOperatorSessionCookie !== "string" ||
              !receivedOperatorSessionCookie.startsWith("forge_session=")
            ) {
              reject(
                new Error(
                  "People performance server did not issue its private operator session."
                )
              );
              return;
            }
            operatorSessionCookie = receivedOperatorSessionCookie;
            resolve(publicReady);
          } else if (message?.type === "fatal") {
            child.off("exit", onExit);
            reject(
              new Error(`People performance server failed: ${message.message}`)
            );
          }
        });
      }),
      unrefDelay(startupTimeoutMs).then(() => {
        throw new Error(
          `People performance server did not start within ${startupTimeoutMs}ms.\n${stderr || stdout}`
        );
      }),
      abortReadiness
    ]);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      if (!(await waitForExit(child, 5_000))) child.kill("SIGKILL");
    }
    throw error;
  } finally {
    if (signal && onStartupAbort) {
      signal.removeEventListener("abort", onStartupAbort);
    }
  }

  let memoryRequestId = 0;
  const sampleMemory = async ({ collect = false } = {}) => {
    memoryRequestId += 1;
    const requestId = memoryRequestId;
    return Promise.race([
      new Promise((resolve, reject) => {
        const onMessage = (message) => {
          if (message?.type === "memory" && message.requestId === requestId) {
            child.off("message", onMessage);
            resolve(message);
          } else if (message?.type === "fatal") {
            child.off("message", onMessage);
            reject(new Error(message.message));
          }
        };
        child.on("message", onMessage);
        child.send({ type: "memory", requestId, collect });
      }),
      unrefDelay(10_000).then(() => {
        throw new Error("Timed out while sampling People server memory.");
      })
    ]);
  };

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.send({ type: "shutdown" });
    let exited = await waitForExit(child, 10_000);
    if (!exited) {
      child.kill("SIGTERM");
      exited = await waitForExit(child, 5_000);
    }
    if (!exited) {
      child.kill("SIGKILL");
      await waitForExit(child, 2_000);
    }
  };

  return {
    child,
    port: resolvedPort,
    origin: `http://127.0.0.1:${resolvedPort}`,
    ready,
    sampleMemory,
    getOperatorSessionCookie() {
      if (!operatorSessionCookie) {
        throw new Error("People performance operator session is unavailable.");
      }
      return operatorSessionCookie;
    },
    stop,
    getOutput: () => ({ stdout, stderr })
  };
}

export async function initializeIsolatedForgeDatabase(
  dataRoot,
  repositoryRoot,
  signal = null
) {
  const server = await startPeoplePerformanceServer({
    repositoryRoot,
    dataRoot,
    signal
  });
  await server.stop();
}

async function waitForHttp(url, child, timeoutMs = 60_000) {
  const deadline = performance.now() + timeoutMs;
  let lastError = null;
  while (performance.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Process exited before ${url} became ready.`);
    }
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500)
        return response.status;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : "no response"}`
  );
}

export async function buildPeoplePerformanceWeb({
  repositoryRoot,
  buildDir,
  signal = null
}) {
  const viteCli = path.join(
    repositoryRoot,
    "node_modules",
    "vite",
    "bin",
    "vite.js"
  );
  const startedAt = performance.now();
  await runCheckedSubprocess({
    command: process.execPath,
    args: [
      viteCli,
      "build",
      "--outDir",
      buildDir,
      "--manifest",
      ".vite/manifest.json",
      "--emptyOutDir"
    ],
    cwd: repositoryRoot,
    env: { ...process.env, FORGE_BASE_PATH: "/forge/" },
    timeoutMs: 180_000,
    signal
  });
  const manifestPath = path.join(buildDir, ".vite", "manifest.json");
  const manifestBytes = await readFile(manifestPath);
  return {
    buildDir,
    manifestPath,
    manifestSha256: sha256(manifestBytes),
    durationMs: performance.now() - startedAt,
    command: `${process.execPath} ${viteCli} build --outDir ${buildDir} --manifest .vite/manifest.json --emptyOutDir`
  };
}

export async function startPeoplePerformancePreview({
  repositoryRoot,
  buildDir,
  port = null
}) {
  const resolvedPort = port ?? (await reserveLoopbackPort());
  const viteCli = path.join(
    repositoryRoot,
    "node_modules",
    "vite",
    "bin",
    "vite.js"
  );
  const child = spawn(
    process.execPath,
    [
      viteCli,
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(resolvedPort),
      "--strictPort",
      "--outDir",
      buildDir
    ],
    {
      cwd: repositoryRoot,
      env: { ...process.env, FORGE_BASE_PATH: "/forge/" },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout = appendBounded(stdout, chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk.toString());
  });
  await waitForHttp(
    `http://127.0.0.1:${resolvedPort}/forge/`,
    child,
    60_000
  ).catch((error) => {
    child.kill("SIGTERM");
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${stderr || stdout}`
    );
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    if (!(await waitForExit(child, 5_000))) {
      child.kill("SIGKILL");
      await waitForExit(child, 2_000);
    }
  };
  return {
    child,
    port: resolvedPort,
    origin: `http://127.0.0.1:${resolvedPort}/forge/`,
    stop,
    getOutput: () => ({ stdout, stderr })
  };
}

export function requestJson(
  agent,
  origin,
  requestPath,
  headers = {},
  signal = null
) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const startedAt = process.hrtime.bigint();
    const request = http.request(
      new URL(requestPath, origin),
      {
        method: "GET",
        agent,
        signal: signal ?? undefined,
        headers: {
          accept: "application/json",
          connection: "keep-alive",
          "x-forge-source": "people-performance",
          ...headers
        }
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
          const bodyText = Buffer.concat(chunks).toString("utf8");
          let body;
          try {
            body = JSON.parse(bodyText);
          } catch {
            reject(
              new Error(
                `People API returned non-JSON status ${response.statusCode}: ${bodyText.slice(0, 500)}`
              )
            );
            return;
          }
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
            durationMs
          });
        });
      }
    );
    request.once("error", reject);
    request.end();
  });
}

export function isExactPublicForgeHealthIdentity(response) {
  const body = response?.body;
  return (
    response?.status === 200 &&
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body).sort().join(",") === "app,ok,security" &&
    body.ok === true &&
    body.app === "forge" &&
    body.security === "credential-required"
  );
}

async function honorPeopleListRateWindow(timestamps, signal = null) {
  const now = performance.now();
  while (
    timestamps.length > 0 &&
    now - timestamps[0] >= PEOPLE_LIST_RATE_WINDOW_MS
  ) {
    timestamps.shift();
  }
  if (timestamps.length < PEOPLE_LIST_SAFE_WINDOW_COUNT) return;
  const waitMs = Math.max(
    0,
    PEOPLE_LIST_RATE_WINDOW_MS - (now - timestamps[0]) + 100
  );
  await delay(waitMs, undefined, { signal: signal ?? undefined });
  const resumedAt = performance.now();
  while (
    timestamps.length > 0 &&
    resumedAt - timestamps[0] >= PEOPLE_LIST_RATE_WINDOW_MS
  ) {
    timestamps.shift();
  }
}

async function runApiScenario({
  name,
  path: requestPath,
  agent,
  origin,
  protocol,
  validate,
  rateTimestamps = null,
  cookie,
  signal = null
}) {
  const total = protocol.warmups + protocol.samples;
  const durations = [];
  for (let index = 0; index < total; index += 1) {
    signal?.throwIfAborted();
    if (rateTimestamps) {
      await honorPeopleListRateWindow(rateTimestamps, signal);
      rateTimestamps.push(performance.now());
    }
    const response = await requestJson(
      agent,
      origin,
      requestPath,
      { cookie },
      signal
    );
    if (response.status !== 200) {
      throw new Error(
        `${name} API sample ${index + 1}/${total} returned ${response.status}: ${JSON.stringify(response.body).slice(0, 1_000)}`
      );
    }
    validate(response.body);
    if (index >= protocol.warmups) durations.push(response.durationMs);
  }
  return {
    protocol: {
      warmups: protocol.warmups,
      measuredRequests: protocol.samples,
      percentileMethod: "nearest_rank",
      client:
        "one sequential node:http loopback client with one keep-alive socket"
    },
    summary: summarizeDurations(durations),
    samplesMs: durations
  };
}

async function runPeopleCursorTraversal({
  agent,
  origin,
  cookie,
  expectedPeople,
  rateTimestamps,
  signal = null
}) {
  const seen = new Set();
  const durations = [];
  let cursor = null;
  let pages = 0;
  let previous = null;
  const maximumPages = Math.ceil(expectedPeople / 100) + 1;
  do {
    signal?.throwIfAborted();
    if (pages >= maximumPages) {
      throw new Error(
        `People cursor traversal exceeded ${maximumPages} bounded pages.`
      );
    }
    await honorPeopleListRateWindow(rateTimestamps, signal);
    rateTimestamps.push(performance.now());
    const query = new URLSearchParams({
      limit: "100",
      sort: "display_name",
      direction: "asc"
    });
    if (cursor) query.set("cursor", cursor);
    const response = await requestJson(
      agent,
      origin,
      `/api/v1/people?${query.toString()}`,
      { cookie },
      signal
    );
    if (response.status !== 200) {
      throw new Error(
        `People cursor page ${pages + 1} returned ${response.status}: ${JSON.stringify(response.body).slice(0, 1_000)}`
      );
    }
    const people = response.body.people;
    if (!Array.isArray(people) || people.length < 1 || people.length > 100) {
      throw new Error(
        `People cursor page ${pages + 1} returned an invalid page size.`
      );
    }
    for (const person of people) {
      if (
        typeof person.id !== "string" ||
        typeof person.displayName !== "string"
      ) {
        throw new Error("People cursor traversal returned a malformed Person.");
      }
      const sortKey = `${person.displayName.toLocaleLowerCase("und")}\u0000${person.id}`;
      if (previous !== null && sortKey <= previous) {
        throw new Error("People cursor traversal was not strictly ordered.");
      }
      previous = sortKey;
      if (seen.has(person.id)) {
        throw new Error(`People cursor traversal duplicated ${person.id}.`);
      }
      seen.add(person.id);
    }
    pages += 1;
    durations.push(response.durationMs);
    cursor = response.body.page?.nextCursor ?? null;
    if (cursor !== null && typeof cursor !== "string") {
      throw new Error("People cursor traversal returned a malformed cursor.");
    }
  } while (cursor !== null);
  if (seen.size !== expectedPeople) {
    throw new Error(
      `People cursor traversal saw ${seen.size}/${expectedPeople} unique rows.`
    );
  }
  return {
    status: "pass",
    protocol: {
      pageLimit: 100,
      pages,
      expectedPeople,
      uniquePeople: seen.size,
      ordering: "normalized display name then id, ascending",
      client: "one sequential node:http keep-alive client"
    },
    summary: summarizeDurations(durations),
    samplesMs: durations
  };
}

export async function runPeopleApiProtocol({
  repositoryRoot,
  dataRoot,
  profile,
  budgets,
  signal = null
}) {
  await verifyPeopleScalePerformanceFixture({
    dataRoot,
    repositoryRoot,
    profile,
    signal
  });
  const server = await startPeoplePerformanceServer({
    repositoryRoot,
    dataRoot,
    signal
  });
  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: 1,
    maxTotalSockets: 1,
    scheduling: "fifo"
  });
  const listRateTimestamps = [];
  try {
    const publicHealth = await requestJson(
      agent,
      server.origin,
      "/api/health",
      {},
      signal
    );
    if (!isExactPublicForgeHealthIdentity(publicHealth)) {
      throw new Error(
        `Public Forge health identity failed with ${publicHealth.status}: ${JSON.stringify(publicHealth.body)}`
      );
    }
    const anonymousProtectedHealth = await requestJson(
      agent,
      server.origin,
      "/api/v1/health",
      {},
      signal
    );
    if (anonymousProtectedHealth.status !== 401) {
      throw new Error(
        `Protected Forge health admitted an anonymous request with ${anonymousProtectedHealth.status}.`
      );
    }
    const anonymousOperatorSession = await requestJson(
      agent,
      server.origin,
      "/api/v1/auth/operator-session",
      {},
      signal
    );
    if (anonymousOperatorSession.status !== 401) {
      throw new Error(
        `Forge operator session admitted an anonymous request with ${anonymousOperatorSession.status}.`
      );
    }
    const cookie = server.getOperatorSessionCookie();
    const sessionResponse = await requestJson(
      agent,
      server.origin,
      "/api/v1/auth/operator-session",
      { cookie },
      signal
    );
    if (sessionResponse.status !== 200) {
      throw new Error(
        `Private operator session verification returned ${sessionResponse.status}: ${JSON.stringify(sessionResponse.body)}`
      );
    }
    if (
      sessionResponse.body.session?.principalKind !== "operator_session" ||
      sessionResponse.body.session?.localOwner !== true
    ) {
      throw new Error(
        "Private operator session verification returned the wrong authority."
      );
    }
    const list = await runApiScenario({
      name: "list",
      path: "/api/v1/people?limit=100&sort=display_name&direction=asc",
      agent,
      origin: server.origin,
      protocol: profile.api,
      cookie,
      signal,
      rateTimestamps: listRateTimestamps,
      validate(body) {
        if (!Array.isArray(body.people) || body.people.length !== 100) {
          throw new Error(
            "People list sample did not return exactly 100 rows."
          );
        }
        if (typeof body.page?.nextCursor !== "string") {
          throw new Error(
            "People list sample did not return a continuation cursor."
          );
        }
      }
    });
    const search = await runApiScenario({
      name: "search",
      path: "/api/v1/people?query=Benchmark%20Person%2000&limit=100&sort=display_name&direction=asc",
      agent,
      origin: server.origin,
      protocol: profile.api,
      cookie,
      signal,
      rateTimestamps: listRateTimestamps,
      validate(body) {
        if (!Array.isArray(body.people) || body.people.length !== 100) {
          throw new Error(
            "People search sample did not return exactly 100 rows."
          );
        }
        if (
          body.people.some(
            (person) =>
              typeof person.displayName !== "string" ||
              !person.displayName.includes("Benchmark Person 00")
          )
        ) {
          throw new Error(
            "People search sample returned an unexpected Person."
          );
        }
      }
    });
    const expectedLinks = Math.min(profile.scale.links, 200);
    const expectedProjections = Math.min(
      profile.scale.projections,
      new Set(
        Array.from(
          { length: profile.scale.projections },
          (_, index) => index % 8
        )
      ).size
    );
    const context = await runApiScenario({
      name: "context",
      path: `/api/v1/people/${PEOPLE_FIXTURE_SUBJECT_ID}/context?linkLimit=200&projectionLimit=8&includeShared=true`,
      agent,
      origin: server.origin,
      protocol: profile.api,
      cookie,
      signal,
      validate(body) {
        if (body.context?.person?.id !== PEOPLE_FIXTURE_SUBJECT_ID) {
          throw new Error("Person context sample returned the wrong Person.");
        }
        if (body.context.links?.length !== expectedLinks) {
          throw new Error(
            `Person context sample returned ${body.context.links?.length} links; expected ${expectedLinks}.`
          );
        }
        if (body.context.sharedProjections?.length !== expectedProjections) {
          throw new Error(
            `Person context sample returned ${body.context.sharedProjections?.length} projections; expected ${expectedProjections}.`
          );
        }
      }
    });
    const cursorTraversal = await runPeopleCursorTraversal({
      agent,
      origin: server.origin,
      cookie,
      expectedPeople: profile.scale.people,
      rateTimestamps: listRateTimestamps,
      signal
    });
    const checks = [
      evaluateCeiling({
        id: "api.list.p95",
        actual: list.summary.p95Ms,
        ceiling: budgets.api.listP95Ms,
        unit: "ms"
      }),
      evaluateCeiling({
        id: "api.search.p95",
        actual: search.summary.p95Ms,
        ceiling: budgets.api.searchP95Ms,
        unit: "ms"
      }),
      evaluateCeiling({
        id: "api.context.p95",
        actual: context.summary.p95Ms,
        ceiling: budgets.api.contextP95Ms,
        unit: "ms"
      }),
      evaluateCeiling({
        id: "api.cursor_page.p95",
        actual: cursorTraversal.summary.p95Ms,
        ceiling: budgets.api.listP95Ms,
        unit: "ms"
      })
    ];
    return {
      status: allChecksPass(checks) ? "pass" : "fail",
      serverStartupMs: server.ready.startupMs,
      accessContract: {
        publicHealthStatus: publicHealth.status,
        anonymousProtectedHealthStatus: anonymousProtectedHealth.status,
        anonymousOperatorSessionStatus: anonymousOperatorSession.status,
        authenticatedOperatorSessionStatus: sessionResponse.status
      },
      scenarios: { list, search, context },
      cursorTraversal,
      checks
    };
  } finally {
    agent.destroy();
    await server.stop();
    await verifyPeopleScalePerformanceFixture({
      dataRoot,
      repositoryRoot,
      profile,
      signal
    });
  }
}

function findManifestKey(manifest, sourceSuffix) {
  const normalized = sourceSuffix.replaceAll(path.sep, "/");
  const matches = Object.entries(manifest)
    .filter(([key, entry]) => {
      const source = typeof entry.src === "string" ? entry.src : "";
      return [key, source].some(
        (candidate) =>
          candidate === normalized || candidate.endsWith(`/${normalized}`)
      );
    })
    .map(([key]) => key);
  if (matches.length !== 1) {
    throw new Error(
      `Expected one Vite manifest entry ending in ${normalized}; found ${matches.length}.`
    );
  }
  return matches[0];
}

function staticChunkClosure(manifest, entryKey) {
  const visitedKeys = new Set();
  const files = new Set();
  const visit = (key) => {
    if (visitedKeys.has(key)) return;
    const entry = manifest[key];
    if (!entry) throw new Error(`Vite manifest import is missing: ${key}`);
    visitedKeys.add(key);
    if (entry.file?.endsWith(".js")) files.add(entry.file);
    for (const importedKey of entry.imports ?? []) visit(importedKey);
  };
  visit(entryKey);
  return files;
}

async function fileMetrics(buildDir, files) {
  const metrics = [];
  for (const file of [...files].sort()) {
    const filePath = path.join(buildDir, file);
    const bytes = await readFile(filePath);
    const fileStat = await stat(filePath);
    metrics.push({
      file,
      rawBytes: fileStat.size,
      gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
      brotliBytes: brotliCompressSync(bytes).byteLength,
      sha256: sha256(bytes)
    });
  }
  return metrics;
}

function subtractFiles(left, right) {
  return new Set([...left].filter((file) => !right.has(file)));
}

function unionFiles(...sets) {
  return new Set(sets.flatMap((set) => [...set]));
}

function summarizeFiles(files) {
  return {
    fileCount: files.length,
    rawBytes: files.reduce((sum, file) => sum + file.rawBytes, 0),
    gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
    brotliBytes: files.reduce((sum, file) => sum + file.brotliBytes, 0),
    files
  };
}

export async function accountPeopleRouteChunks({
  buildDir,
  manifestPath,
  budgets
}) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const mainKey = findManifestKey(manifest, "index.html");
  const overviewKey = findManifestKey(manifest, "src/pages/overview-page.tsx");
  const peopleKey = findManifestKey(manifest, "src/pages/people-page.tsx");
  const personDetailKey = findManifestKey(
    manifest,
    "src/pages/person-detail-page.tsx"
  );
  const shell = staticChunkClosure(manifest, mainKey);
  const overview = staticChunkClosure(manifest, overviewKey);
  const people = staticChunkClosure(manifest, peopleKey);
  const personDetail = staticChunkClosure(manifest, personDetailKey);
  const peopleCombined = unionFiles(people, personDetail);
  const groups = {
    shellInitial: shell,
    unrelatedOverviewLazy: subtractFiles(overview, shell),
    unrelatedOverviewTotal: unionFiles(shell, overview),
    peopleListLazy: subtractFiles(people, shell),
    personDetailLazy: subtractFiles(personDetail, shell),
    peopleCombinedLazy: subtractFiles(peopleCombined, shell),
    peopleListTotal: unionFiles(shell, people),
    personDetailTotal: unionFiles(shell, personDetail)
  };
  const metricCache = new Map(
    (await fileMetrics(buildDir, unionFiles(...Object.values(groups)))).map(
      (metric) => [metric.file, metric]
    )
  );
  const accounted = {};
  for (const [name, files] of Object.entries(groups)) {
    accounted[name] = summarizeFiles(
      [...files].sort().map((file) => {
        const metric = metricCache.get(file);
        if (!metric) {
          throw new Error(`Bundle metric is missing for ${file}.`);
        }
        return metric;
      })
    );
  }
  const checks = [
    evaluateCeiling({
      id: "bundle.people_combined_lazy.gzip",
      actual: accounted.peopleCombinedLazy.gzipBytes / 1024,
      ceiling: budgets.bundle.peopleLazyGzipKiB,
      unit: "KiB"
    }),
    evaluateCeiling({
      id: "bundle.people_list_total.gzip",
      actual: accounted.peopleListTotal.gzipBytes / 1024,
      ceiling: budgets.bundle.peopleRouteTotalGzipKiB,
      unit: "KiB"
    })
  ];
  return {
    status: allChecksPass(checks) ? "pass" : "fail",
    manifestPath,
    manifestSha256: sha256(await readFile(manifestPath)),
    entries: { mainKey, overviewKey, peopleKey, personDetailKey },
    accounting: accounted,
    comparisons: {
      peopleListTotalVsUnrelatedInitialGzipBytes:
        accounted.peopleListTotal.gzipBytes -
        accounted.unrelatedOverviewTotal.gzipBytes,
      peopleCombinedLazyVsUnrelatedLazyGzipBytes:
        accounted.peopleCombinedLazy.gzipBytes -
        accounted.unrelatedOverviewLazy.gzipBytes
    },
    checks
  };
}
