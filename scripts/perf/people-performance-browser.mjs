import { mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, devices } from "@playwright/test";
import sharp from "sharp";
import {
  allChecksPass,
  asAdvisoryCheck,
  evaluateCeiling,
  evaluateFloor,
  nearestRankPercentile,
  summarizeDurations
} from "./people-performance-contract.mjs";
import {
  startPeoplePerformancePreview,
  startPeoplePerformanceServer
} from "./people-performance-runtime.mjs";
import { verifyPeoplePerformanceFixture } from "./people-performance-fixture.mjs";

const MEBIBYTE = 1024 * 1024;
const FIRST_USEFUL_SELECTOR = "[data-person-id] button";
const SCROLL_SELECTOR = '[data-testid="people-virtual-scroll"]';

function desktopContextOptions() {
  return {
    headless: true,
    viewport: { width: 1280, height: 720 },
    colorScheme: "light",
    reducedMotion: "no-preference",
    locale: "en-US"
  };
}

function pixel7ContextOptions() {
  const pixel7 = { ...devices["Pixel 7"] };
  Reflect.deleteProperty(pixel7, "defaultBrowserType");
  return {
    ...pixel7,
    headless: true,
    colorScheme: "light",
    reducedMotion: "no-preference",
    locale: "en-US"
  };
}

async function installFirstUsefulContentProbe(context) {
  await context.addInitScript((selector) => {
    globalThis.__forgePeopleFirstUsefulContentMs = null;
    const inspect = () => {
      if (globalThis.__forgePeopleFirstUsefulContentMs !== null) return;
      const candidate = globalThis.document.querySelector(selector);
      if (!(candidate instanceof globalThis.HTMLElement)) return;
      const bounds = candidate.getBoundingClientRect();
      if (
        bounds.width > 0 &&
        bounds.height > 0 &&
        candidate.textContent?.trim()
      ) {
        globalThis.__forgePeopleFirstUsefulContentMs = performance.now();
      }
    };
    const observer = new globalThis.MutationObserver(inspect);
    observer.observe(globalThis.document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    });
    globalThis.document.addEventListener("DOMContentLoaded", inspect, {
      once: true
    });
  }, FIRST_USEFUL_SELECTOR);
}

async function measureFirstUsefulContent(page, peopleUrl) {
  const response = await page.goto(peopleUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });
  if (!response || response.status() !== 200) {
    throw new Error(
      `People navigation returned ${response?.status() ?? "no response"}.`
    );
  }
  const firstPerson = page.locator(FIRST_USEFUL_SELECTOR).first();
  await firstPerson.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    () => Number.isFinite(globalThis.__forgePeopleFirstUsefulContentMs),
    undefined,
    { timeout: 30_000 }
  );
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    return {
      firstUsefulContentMs: globalThis.__forgePeopleFirstUsefulContentMs,
      responseEndMs: navigation?.responseEnd ?? null,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      loadEventMs: navigation?.loadEventEnd ?? null,
      transferSize: navigation?.transferSize ?? null,
      encodedBodySize: navigation?.encodedBodySize ?? null
    };
  });
}

async function startWebStack({ repositoryRoot, dataRoot, buildDir }) {
  const preview = await startPeoplePerformancePreview({
    repositoryRoot,
    buildDir
  });
  try {
    const server = await startPeoplePerformanceServer({
      repositoryRoot,
      dataRoot,
      webOrigin: preview.origin
    });
    return {
      preview,
      server,
      peopleUrl: `${server.origin}/forge/people`,
      overviewUrl: `${server.origin}/forge/overview`,
      stop: async () => {
        await server.stop();
        await preview.stop();
      }
    };
  } catch (error) {
    await preview.stop();
    throw error;
  }
}

async function runColdSamples({
  repositoryRoot,
  dataRoot,
  buildDir,
  profileRoot,
  sampleCount
}) {
  const samples = [];
  let browserVersion = null;
  for (let index = 0; index < sampleCount; index += 1) {
    const profilePath = path.join(
      profileRoot,
      `cold-${String(index + 1).padStart(2, "0")}`
    );
    await mkdir(profilePath, { recursive: true });
    const stack = await startWebStack({ repositoryRoot, dataRoot, buildDir });
    const context = await chromium.launchPersistentContext(
      profilePath,
      desktopContextOptions()
    );
    try {
      browserVersion ??= context.browser()?.version() ?? "unknown";
      await installFirstUsefulContentProbe(context);
      const page = context.pages()[0] ?? (await context.newPage());
      const navigation = await measureFirstUsefulContent(page, stack.peopleUrl);
      samples.push({
        sample: index + 1,
        profilePath,
        serverPid: stack.server.ready.pid,
        serverStartupMs: stack.server.ready.startupMs,
        ...navigation
      });
    } finally {
      await context.close();
      await stack.stop();
    }
  }
  return { samples, browserVersion };
}

async function runWarmSamples({
  repositoryRoot,
  dataRoot,
  buildDir,
  profileRoot,
  sampleCount
}) {
  const profilePath = path.join(profileRoot, "warm");
  await mkdir(profilePath, { recursive: true });
  const stack = await startWebStack({ repositoryRoot, dataRoot, buildDir });
  const context = await chromium.launchPersistentContext(
    profilePath,
    desktopContextOptions()
  );
  const samples = [];
  try {
    await installFirstUsefulContentProbe(context);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(stack.peopleUrl, { waitUntil: "domcontentloaded" });
    await page
      .locator(FIRST_USEFUL_SELECTOR)
      .first()
      .waitFor({ state: "visible" });
    for (let index = 0; index < sampleCount; index += 1) {
      await page.goto(stack.overviewUrl, { waitUntil: "domcontentloaded" });
      await page.locator("main").first().waitFor({ state: "visible" });
      samples.push({
        sample: index + 1,
        profilePath,
        ...(await measureFirstUsefulContent(page, stack.peopleUrl))
      });
    }
    return { samples, profilePath };
  } finally {
    await context.close();
    await stack.stop();
  }
}

async function collectBrowserHeap(cdp, collect = false) {
  if (collect) await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const byName = new Map(metrics.map((metric) => [metric.name, metric.value]));
  const jsHeapUsedBytes = byName.get("JSHeapUsedSize");
  const jsHeapTotalBytes = byName.get("JSHeapTotalSize");
  if (!Number.isFinite(jsHeapUsedBytes) || !Number.isFinite(jsHeapTotalBytes)) {
    throw new Error("Chromium did not expose JavaScript heap metrics.");
  }
  return { jsHeapUsedBytes, jsHeapTotalBytes };
}

function memoryPoint(label, serverSample, browserSample) {
  return {
    label,
    sampledAt: new Date().toISOString(),
    server: {
      rssBytes: serverSample.memory.rss,
      heapUsedBytes: serverSample.memory.heapUsed,
      heapTotalBytes: serverSample.memory.heapTotal,
      externalBytes: serverSample.memory.external,
      arrayBuffersBytes: serverSample.memory.arrayBuffers
    },
    browser: browserSample
  };
}

async function traversePeople(page, peopleUrl) {
  await page.goto(peopleUrl, { waitUntil: "domcontentloaded" });
  const search = page.getByPlaceholder("Search by name or relationship");
  await search.waitFor({ state: "visible" });
  await search.fill("Benchmark Person 00000");
  const result = page.locator(FIRST_USEFUL_SELECTOR).first();
  await result.waitFor({ state: "visible" });
  await result.click();
  await page.locator('[data-testid="person-detail"]').waitFor({
    state: "visible",
    timeout: 30_000
  });
}

async function runMemoryRetention({
  repositoryRoot,
  dataRoot,
  buildDir,
  profileRoot,
  profile,
  budgets
}) {
  const profilePath = path.join(profileRoot, "memory");
  await mkdir(profilePath, { recursive: true });
  const stack = await startWebStack({ repositoryRoot, dataRoot, buildDir });
  const context = await chromium.launchPersistentContext(profilePath, {
    ...desktopContextOptions(),
    args: ["--js-flags=--expose-gc"]
  });
  const points = [];
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.enable");
    await page.goto(stack.peopleUrl, { waitUntil: "domcontentloaded" });
    await page
      .locator(FIRST_USEFUL_SELECTOR)
      .first()
      .waitFor({ state: "visible" });
    points.push(
      memoryPoint(
        "baseline_after_gc",
        await stack.server.sampleMemory({ collect: true }),
        await collectBrowserHeap(cdp, true)
      )
    );
    for (let index = 0; index < profile.memory.traversals; index += 1) {
      await traversePeople(page, stack.peopleUrl);
      if (
        (index + 1) % profile.memory.sampleEvery === 0 ||
        index + 1 === profile.memory.traversals
      ) {
        points.push(
          memoryPoint(
            `after_traversal_${index + 1}`,
            await stack.server.sampleMemory(),
            await collectBrowserHeap(cdp)
          )
        );
      }
    }
    points.push(
      memoryPoint(
        "final_after_gc",
        await stack.server.sampleMemory({ collect: true }),
        await collectBrowserHeap(cdp, true)
      )
    );
    const baseline = points[0];
    const final = points.at(-1);
    const maximum = (selector) => Math.max(...points.map(selector));
    const summary = {
      traversals: profile.memory.traversals,
      server: {
        rssMaxMiB: maximum((point) => point.server.rssBytes) / MEBIBYTE,
        rssDeltaMiB:
          (final.server.rssBytes - baseline.server.rssBytes) / MEBIBYTE,
        rssRetainedMiB:
          Math.max(0, final.server.rssBytes - baseline.server.rssBytes) /
          MEBIBYTE,
        heapMaxMiB: maximum((point) => point.server.heapUsedBytes) / MEBIBYTE,
        heapDeltaMiB:
          (final.server.heapUsedBytes - baseline.server.heapUsedBytes) /
          MEBIBYTE,
        heapRetainedMiB:
          Math.max(
            0,
            final.server.heapUsedBytes - baseline.server.heapUsedBytes
          ) / MEBIBYTE
      },
      browser: {
        jsHeapMaxMiB:
          maximum((point) => point.browser.jsHeapUsedBytes) / MEBIBYTE,
        jsHeapDeltaMiB:
          (final.browser.jsHeapUsedBytes - baseline.browser.jsHeapUsedBytes) /
          MEBIBYTE,
        jsHeapRetainedMiB:
          Math.max(
            0,
            final.browser.jsHeapUsedBytes - baseline.browser.jsHeapUsedBytes
          ) / MEBIBYTE
      }
    };
    const checks = [
      evaluateCeiling({
        id: "memory.server.rss_max",
        actual: summary.server.rssMaxMiB,
        ceiling: budgets.memory.serverRssMaxMiB,
        unit: "MiB"
      }),
      evaluateCeiling({
        id: "memory.server.rss_retained",
        actual: summary.server.rssRetainedMiB,
        ceiling: budgets.memory.serverRssRetainedMiB,
        unit: "MiB"
      }),
      evaluateCeiling({
        id: "memory.server.heap_max",
        actual: summary.server.heapMaxMiB,
        ceiling: budgets.memory.serverHeapMaxMiB,
        unit: "MiB"
      }),
      evaluateCeiling({
        id: "memory.server.heap_retained",
        actual: summary.server.heapRetainedMiB,
        ceiling: budgets.memory.serverHeapRetainedMiB,
        unit: "MiB"
      }),
      evaluateCeiling({
        id: "memory.browser.js_heap_max",
        actual: summary.browser.jsHeapMaxMiB,
        ceiling: budgets.memory.browserJsHeapMaxMiB,
        unit: "MiB"
      }),
      evaluateCeiling({
        id: "memory.browser.js_heap_retained",
        actual: summary.browser.jsHeapRetainedMiB,
        ceiling: budgets.memory.browserJsHeapRetainedMiB,
        unit: "MiB"
      })
    ];
    return {
      status: allChecksPass(checks) ? "pass" : "fail",
      profilePath,
      methodology: {
        traversals: "People list -> typed query -> Person detail",
        serverMemory:
          "instrumented API process.memoryUsage over IPC; static preview process excluded",
        browserMemory: "Chromium Performance.getMetrics JSHeapUsedSize",
        retention: "positive final-minus-baseline delta after explicit GC"
      },
      summary,
      points,
      checks
    };
  } finally {
    await context.close();
    await stack.stop();
  }
}

async function preloadAllPeople(page, peopleUrl, expectedPeople) {
  const seenIds = new Set();
  let terminalPageSeen = false;
  let responseError = null;
  let responseCount = 0;
  const onResponse = async (response) => {
    const url = new URL(response.url());
    if (
      url.pathname !== "/api/v1/people" ||
      url.searchParams.has("query") ||
      response.request().method() !== "GET"
    ) {
      return;
    }
    try {
      const body = await response.json();
      responseCount += 1;
      for (const person of body.people ?? []) seenIds.add(person.id);
      if (body.page?.nextCursor === null) terminalPageSeen = true;
    } catch (error) {
      responseError = error;
    }
  };
  page.on("response", onResponse);
  try {
    await page.goto(peopleUrl, { waitUntil: "domcontentloaded" });
    const scroll = page.locator(SCROLL_SELECTOR);
    await scroll.waitFor({ state: "visible" });
    let stagnantIterations = 0;
    while (!terminalPageSeen) {
      if (responseError) throw responseError;
      const before = seenIds.size;
      await scroll.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const deadline = performance.now() + 10_000;
      while (
        performance.now() < deadline &&
        !terminalPageSeen &&
        seenIds.size === before &&
        !responseError
      ) {
        await delay(25);
      }
      if (seenIds.size === before) stagnantIterations += 1;
      else stagnantIterations = 0;
      if (stagnantIterations >= 3) {
        throw new Error(
          `People virtual list stopped loading at ${seenIds.size}/${expectedPeople} rows.`
        );
      }
    }
    if (responseError) throw responseError;
    if (seenIds.size !== expectedPeople) {
      throw new Error(
        `People virtual-list preload saw ${seenIds.size}/${expectedPeople} unique rows.`
      );
    }
    await scroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    await delay(100);
    return { uniquePeople: seenIds.size, responseCount };
  } finally {
    page.off("response", onResponse);
  }
}

export function classifyFramePixels(data, width, height) {
  const pixelCount = width * height;
  if (pixelCount < 1 || data.length < pixelCount * 3) {
    throw new Error("Captured-frame pixel buffer is incomplete.");
  }
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let luminanceTotal = 0;
  let luminanceSquaredTotal = 0;
  let nearBlack = 0;
  let nearWhite = 0;
  let blueDominant = 0;
  let edgeTotal = 0;
  let edgeCount = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 3;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    redTotal += red;
    greenTotal += green;
    blueTotal += blue;
    luminanceTotal += luminance;
    luminanceSquaredTotal += luminance * luminance;
    if (luminance < 5) nearBlack += 1;
    if (luminance > 250) nearWhite += 1;
    if (blue > 100 && blue > red + 35 && blue > green + 20) {
      blueDominant += 1;
    }
    if ((index + 1) % width !== 0) {
      const rightOffset = offset + 3;
      edgeTotal +=
        Math.abs(red - data[rightOffset]) +
        Math.abs(green - data[rightOffset + 1]) +
        Math.abs(blue - data[rightOffset + 2]);
      edgeCount += 3;
    }
  }
  const meanLuminance = luminanceTotal / pixelCount;
  const luminanceStdDev = Math.sqrt(
    Math.max(
      0,
      luminanceSquaredTotal / pixelCount - meanLuminance * meanLuminance
    )
  );
  const edgeMean = edgeCount > 0 ? edgeTotal / edgeCount : 0;
  const nearBlackRatio = nearBlack / pixelCount;
  const nearWhiteRatio = nearWhite / pixelCount;
  const blueDominantRatio = blueDominant / pixelCount;
  const blank =
    nearBlackRatio > 0.995 ||
    nearWhiteRatio > 0.995 ||
    (luminanceStdDev < 2 && edgeMean < 1.5);
  const blueFlash =
    blueDominantRatio > 0.9 &&
    blueTotal / pixelCount > 100 &&
    blueTotal / pixelCount - redTotal / pixelCount > 35 &&
    blueTotal / pixelCount - greenTotal / pixelCount > 20;
  return {
    blank,
    blueFlash,
    meanLuminance,
    luminanceStdDev,
    edgeMean,
    nearBlackRatio,
    nearWhiteRatio,
    blueDominantRatio
  };
}

async function classifyCapturedFrame(buffer) {
  const { data, info } = await sharp(buffer)
    .resize(64, 64, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return classifyFramePixels(data, info.width, info.height);
}

async function runScrollMotion(page, phaseDurationMs) {
  return page.locator(SCROLL_SELECTOR).evaluate(async (element, durationMs) => {
    const frameTimestamps = [];
    let contentLossSamples = 0;
    const visiblePersonIds = new Set();
    const inspect = () => {
      const viewport = element.getBoundingClientRect();
      const rows = Array.from(element.querySelectorAll("[data-person-id]"));
      const visible = rows.filter((row) => {
        const bounds = row.getBoundingClientRect();
        return (
          bounds.bottom > viewport.top &&
          bounds.top < viewport.bottom &&
          bounds.width > 0 &&
          bounds.height > 0 &&
          row.textContent?.trim()
        );
      });
      if (visible.length === 0) contentLossSamples += 1;
      for (const row of visible) {
        const personId = row.getAttribute("data-person-id");
        if (personId) visiblePersonIds.add(personId);
      }
    };
    const animate = (from, to) =>
      new Promise((resolve) => {
        let phaseStartedAt = null;
        const frame = (timestamp) => {
          if (phaseStartedAt === null) phaseStartedAt = timestamp;
          frameTimestamps.push(timestamp);
          inspect();
          const progress = Math.min(
            1,
            (timestamp - phaseStartedAt) / durationMs
          );
          element.scrollTop = from + (to - from) * progress;
          if (progress < 1) globalThis.requestAnimationFrame(frame);
          else {
            globalThis.requestAnimationFrame(() => {
              inspect();
              resolve();
            });
          }
        };
        globalThis.requestAnimationFrame(frame);
      });
    const scrollHeightBefore = element.scrollHeight;
    const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
    await animate(0, maximum);
    await animate(maximum, 0);
    inspect();
    const durations = frameTimestamps.slice(1).map((timestamp, index) => {
      return timestamp - frameTimestamps[index];
    });
    return {
      durations,
      contentLossSamples,
      visiblePersonCount: visiblePersonIds.size,
      scrollHeightBefore,
      scrollHeightAfter: element.scrollHeight,
      finalScrollTop: element.scrollTop,
      maximumScrollTop: maximum
    };
  }, phaseDurationMs);
}

async function measureRafCadence(page, sampleCount = 31) {
  return page.evaluate(
    (count) =>
      new Promise((resolve) => {
        const timestamps = [];
        const frame = (timestamp) => {
          timestamps.push(timestamp);
          if (timestamps.length < count) {
            globalThis.requestAnimationFrame(frame);
            return;
          }
          resolve(
            timestamps.slice(1).map((value, index) => value - timestamps[index])
          );
        };
        globalThis.requestAnimationFrame(frame);
      }),
    sampleCount
  );
}

export function normalizeRafToReference({
  p5Fps,
  p95FrameDurationMs,
  baselineFrameDurationMs,
  referenceFps = 60
}) {
  for (const [name, value] of Object.entries({
    p5Fps,
    p95FrameDurationMs,
    baselineFrameDurationMs,
    referenceFps
  })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive finite number.`);
    }
  }
  const baselineFps = 1_000 / baselineFrameDurationMs;
  if (baselineFps < 30 || baselineFps > 240) {
    throw new Error(
      `Measured rAF baseline ${baselineFps.toFixed(2)} FPS is outside the supported 30-240 FPS range.`
    );
  }
  const effectiveBaselineFps = Math.min(baselineFps, referenceFps);
  const referenceScale = referenceFps / effectiveBaselineFps;
  return {
    baselineFps,
    effectiveBaselineFps,
    baselineFrameDurationMs,
    referenceFps,
    referenceScale,
    p5Fps: p5Fps * referenceScale,
    p95FrameDurationMs: p95FrameDurationMs / referenceScale
  };
}

export function selectMeasuredRafBaseline({
  idleFrameDurationMs,
  motionMedianFrameDurationMs,
  minimumCalibrationFps = 50
}) {
  for (const [name, value] of Object.entries({
    idleFrameDurationMs,
    motionMedianFrameDurationMs,
    minimumCalibrationFps
  })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive finite number.`);
    }
  }
  return Math.max(
    idleFrameDurationMs,
    Math.min(motionMedianFrameDurationMs, 1_000 / minimumCalibrationFps)
  );
}

export function positiveFiniteFrameDurations(values) {
  if (!Array.isArray(values)) {
    throw new Error("Frame durations must be an array.");
  }
  return values.filter((duration) => Number.isFinite(duration) && duration > 0);
}

async function measureOneScrollRun(page, cdp, phaseDurationMs, runNumber) {
  const capturedFrames = [];
  const screencastTimestamps = [];
  const onFrame = (event) => {
    capturedFrames.push(Buffer.from(event.data, "base64"));
    if (Number.isFinite(event.metadata?.timestamp)) {
      screencastTimestamps.push(event.metadata.timestamp * 1_000);
    }
    void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId });
  };
  cdp.on("Page.screencastFrame", onFrame);
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 55,
    everyNthFrame: 1
  });
  let motion;
  let cadenceDurations;
  try {
    cadenceDurations = await measureRafCadence(page);
    motion = await runScrollMotion(page, phaseDurationMs);
    await delay(100);
  } finally {
    await cdp.send("Page.stopScreencast");
    cdp.off("Page.screencastFrame", onFrame);
  }
  const motionDurations = positiveFiniteFrameDurations(motion.durations);
  const validCadenceDurations = positiveFiniteFrameDurations(cadenceDurations);
  if (
    motionDurations.length < 2 ||
    validCadenceDurations.length < 2 ||
    capturedFrames.length < 2
  ) {
    throw new Error(
      `Scroll run ${runNumber} captured insufficient rAF or painted frames.`
    );
  }
  const frameClassifications = [];
  for (const frame of capturedFrames) {
    frameClassifications.push(await classifyCapturedFrame(frame));
  }
  const durationSummary = summarizeDurations(motionDurations);
  const totalDurationMs = motionDurations.reduce(
    (sum, duration) => sum + duration,
    0
  );
  const fps = (motionDurations.length / totalDurationMs) * 1_000;
  const p5Fps = nearestRankPercentile(
    motionDurations.map((duration) => 1_000 / duration),
    0.05
  );
  const cadenceSummary = summarizeDurations(validCadenceDurations);
  const idleFrameDurationMs = nearestRankPercentile(validCadenceDurations, 0.1);
  const baselineFrameDurationMs = selectMeasuredRafBaseline({
    idleFrameDurationMs,
    motionMedianFrameDurationMs: durationSummary.medianMs
  });
  const reference60Hz = normalizeRafToReference({
    p5Fps,
    p95FrameDurationMs: durationSummary.p95Ms,
    baselineFrameDurationMs
  });
  const screencastDurations = screencastTimestamps
    .slice(1)
    .map((timestamp, index) => timestamp - screencastTimestamps[index])
    .filter((duration) => duration > 0 && Number.isFinite(duration));
  return {
    run: runNumber,
    raf: {
      ...durationSummary,
      fps,
      p5Fps,
      cadence: {
        ...cadenceSummary,
        idleFrameDurationMs,
        motionMedianFrameDurationMs: durationSummary.medianMs,
        baselineFrameDurationMs
      },
      reference60Hz
    },
    paintedFrames: {
      captured: capturedFrames.length,
      timestamped: screencastTimestamps.length,
      durations:
        screencastDurations.length > 0
          ? summarizeDurations(screencastDurations)
          : null,
      blankFrames: frameClassifications.filter((frame) => frame.blank).length,
      blueFlashFrames: frameClassifications.filter((frame) => frame.blueFlash)
        .length
    },
    contentLossSamples: motion.contentLossSamples,
    visiblePersonCount: motion.visiblePersonCount,
    scrollHeightBefore: motion.scrollHeightBefore,
    scrollHeightAfter: motion.scrollHeightAfter,
    finalScrollTop: motion.finalScrollTop,
    maximumScrollTop: motion.maximumScrollTop
  };
}

async function measureScrollDevice({
  name,
  contextOptions,
  profilePath,
  peopleUrl,
  expectedPeople,
  runCount,
  phaseDurationMs,
  budgets
}) {
  await mkdir(profilePath, { recursive: true });
  const context = await chromium.launchPersistentContext(
    profilePath,
    contextOptions
  );
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const preload = await preloadAllPeople(page, peopleUrl, expectedPeople);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.enable");
    const runs = [];
    for (let index = 0; index < runCount; index += 1) {
      runs.push(
        await measureOneScrollRun(page, cdp, phaseDurationMs, index + 1)
      );
    }
    const checks = [];
    const minimumFps =
      name === "desktop"
        ? budgets.scroll.desktopMinimumFps
        : budgets.scroll.mobileMinimumFps;
    const p95FrameDurationMs =
      name === "desktop"
        ? budgets.scroll.desktopP95FrameDurationMs
        : budgets.scroll.mobileP95FrameDurationMs;
    const sharedRunnerTimingAdvisory =
      process.env.FORGE_PEOPLE_SHARED_RUNNER_TIMING_ADVISORY === "1";
    const timingAdvisoryReason =
      "Shared macOS runner rAF timing is hardware-dependent; raw timing remains evidence while visual stability is enforced independently.";
    for (const run of runs) {
      const fpsCheck = evaluateFloor({
        id: `scroll.${name}.run_${run.run}.fps`,
        actual: run.raf.reference60Hz.p5Fps,
        floor: minimumFps,
        unit: "fps"
      });
      const frameDurationCheck = evaluateCeiling({
        id: `scroll.${name}.run_${run.run}.p95_frame`,
        actual: run.raf.reference60Hz.p95FrameDurationMs,
        ceiling: p95FrameDurationMs,
        unit: "ms"
      });
      checks.push(
        sharedRunnerTimingAdvisory
          ? asAdvisoryCheck(fpsCheck, timingAdvisoryReason)
          : fpsCheck,
        sharedRunnerTimingAdvisory
          ? asAdvisoryCheck(frameDurationCheck, timingAdvisoryReason)
          : frameDurationCheck,
        evaluateCeiling({
          id: `scroll.${name}.run_${run.run}.blank_frames`,
          actual: run.paintedFrames.blankFrames,
          ceiling: budgets.scroll.maximumBlankFrames,
          unit: "frame"
        }),
        evaluateCeiling({
          id: `scroll.${name}.run_${run.run}.blue_flash_frames`,
          actual: run.paintedFrames.blueFlashFrames,
          ceiling: budgets.scroll.maximumBlueFlashFrames,
          unit: "frame"
        }),
        evaluateCeiling({
          id: `scroll.${name}.run_${run.run}.content_loss`,
          actual: run.contentLossSamples,
          ceiling: budgets.scroll.maximumContentLossSamples,
          unit: "sample"
        }),
        evaluateCeiling({
          id: `scroll.${name}.run_${run.run}.height_stability`,
          actual: Math.abs(run.scrollHeightAfter - run.scrollHeightBefore),
          ceiling: 1,
          unit: "px"
        }),
        evaluateCeiling({
          id: `scroll.${name}.run_${run.run}.return_to_top`,
          actual: Math.abs(run.finalScrollTop),
          ceiling: 1,
          unit: "px"
        })
      );
    }
    return {
      status: allChecksPass(checks) ? "pass" : "fail",
      profilePath,
      viewport: await page.evaluate(() => ({
        width: globalThis.innerWidth,
        height: globalThis.innerHeight,
        devicePixelRatio: globalThis.devicePixelRatio,
        reducedMotion: globalThis.matchMedia("(prefers-reduced-motion: reduce)")
          .matches
      })),
      preload,
      methodology: {
        loadedPeople: expectedPeople,
        authoredMotionPreserved: true,
        reducedMotionOverride: "no-preference",
        frameTiming: "requestAnimationFrame during down/up scroll",
        frameTimingReference:
          "60 Hz normalization from idle and motion-median rAF cadence under the same screencast load, bounded to compensate no lower than 50 Hz; raw timing is retained per run",
        paintCapture: "Chrome DevTools Protocol Page.startScreencast",
        blankAndBlueDetection: "all captured frames downsampled to 64x64 RGB"
      },
      runs,
      checks
    };
  } finally {
    await context.close();
  }
}

async function runScrollSuite({
  repositoryRoot,
  dataRoot,
  buildDir,
  profileRoot,
  profile,
  budgets
}) {
  const stack = await startWebStack({ repositoryRoot, dataRoot, buildDir });
  try {
    const desktop = await measureScrollDevice({
      name: "desktop",
      contextOptions: desktopContextOptions(),
      profilePath: path.join(profileRoot, "scroll-desktop"),
      peopleUrl: stack.peopleUrl,
      expectedPeople: profile.fixture.people,
      runCount: profile.scroll.runsPerDevice,
      phaseDurationMs: profile.scroll.phaseDurationMs,
      budgets
    });
    const pixel7 = await measureScrollDevice({
      name: "pixel_7",
      contextOptions: pixel7ContextOptions(),
      profilePath: path.join(profileRoot, "scroll-pixel-7"),
      peopleUrl: stack.peopleUrl,
      expectedPeople: profile.fixture.people,
      runCount: profile.scroll.runsPerDevice,
      phaseDurationMs: profile.scroll.phaseDurationMs,
      budgets
    });
    const checks = [...desktop.checks, ...pixel7.checks];
    return {
      status: allChecksPass(checks) ? "pass" : "fail",
      desktop,
      pixel7,
      checks
    };
  } finally {
    await stack.stop();
  }
}

export async function runPeopleBrowserPerformanceSuite({
  repositoryRoot,
  dataRoot,
  buildDir,
  runRoot,
  profile,
  budgets
}) {
  await verifyPeoplePerformanceFixture({ dataRoot, repositoryRoot, profile });
  const profileRoot = path.join(runRoot, "browser-profiles");
  await mkdir(profileRoot, { recursive: true });
  const cold = await runColdSamples({
    repositoryRoot,
    dataRoot,
    buildDir,
    profileRoot,
    sampleCount: profile.browser.coldSamples
  });
  const warm = await runWarmSamples({
    repositoryRoot,
    dataRoot,
    buildDir,
    profileRoot,
    sampleCount: profile.browser.warmSamples
  });
  const coldSummary = summarizeDurations(
    cold.samples.map((sample) => sample.firstUsefulContentMs)
  );
  const warmSummary = summarizeDurations(
    warm.samples.map((sample) => sample.firstUsefulContentMs)
  );
  const measuredFirstUsefulChecks = [
    evaluateCeiling({
      id: "browser.cold_first_useful_content.p95",
      actual: coldSummary.p95Ms,
      ceiling: budgets.browser.coldFirstUsefulContentP95Ms,
      unit: "ms"
    }),
    evaluateCeiling({
      id: "browser.warm_first_useful_content.p95",
      actual: warmSummary.p95Ms,
      ceiling: budgets.browser.warmFirstUsefulContentP95Ms,
      unit: "ms"
    })
  ];
  const sharedRunnerTimingAdvisory =
    process.env.FORGE_PEOPLE_SHARED_RUNNER_TIMING_ADVISORY === "1";
  const firstUsefulChecks = sharedRunnerTimingAdvisory
    ? measuredFirstUsefulChecks.map((check) =>
        asAdvisoryCheck(
          check,
          "Shared macOS runner navigation timing is hardware-dependent; raw timing remains evidence while rendering stability is enforced independently."
        )
      )
    : measuredFirstUsefulChecks;
  const memory = await runMemoryRetention({
    repositoryRoot,
    dataRoot,
    buildDir,
    profileRoot,
    profile,
    budgets
  });
  const scroll = await runScrollSuite({
    repositoryRoot,
    dataRoot,
    buildDir,
    profileRoot,
    profile,
    budgets
  });
  await verifyPeoplePerformanceFixture({ dataRoot, repositoryRoot, profile });
  const checks = [...firstUsefulChecks, ...memory.checks, ...scroll.checks];
  return {
    status: allChecksPass(checks) ? "pass" : "fail",
    browser: {
      engine: "chromium",
      version: cold.browserVersion,
      headless: true,
      colorScheme: "light"
    },
    profileRoot,
    firstUsefulContent: {
      methodology: {
        cold: "fresh Chromium process, persistent-profile directory, API server, and Vite preview process per sample",
        warm: "same Chromium profile and server with primed HTTP/module cache",
        endpoint: "/forge/people",
        usefulContent: "first visible nonempty virtualized Person row"
      },
      cold: { summary: coldSummary, samples: cold.samples },
      warm: { summary: warmSummary, samples: warm.samples },
      checks: firstUsefulChecks
    },
    memory,
    scroll,
    checks
  };
}
