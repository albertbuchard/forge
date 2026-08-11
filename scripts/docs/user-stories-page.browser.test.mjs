/* global document, requestAnimationFrame, window */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const docsRoot = path.join(repositoryRoot, "plugins/openclaw/docs");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"]
]);

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://127.0.0.1").pathname
      );
      const relativePath = pathname.replace(/^\/+/, "") || "index.html";
      const filePath = path.resolve(docsRoot, relativePath);
      if (
        filePath !== docsRoot &&
        !filePath.startsWith(`${docsRoot}${path.sep}`)
      ) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type":
          contentTypes.get(path.extname(filePath)) ?? "application/octet-stream"
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

test("story deep links clear conflicting filters and reveal the target in real browsers", async (context) => {
  const browser = await chromium.launch({ headless: true });
  context.after(() => browser.close());

  for (const viewport of [
    { width: 1093, height: 904 },
    { width: 390, height: 844 }
  ]) {
    const page = await browser.newPage({ viewport });
    await page.goto(
      `${baseUrl}/user-stories.html?scope=current&family=SYS#story-android-01`,
      { waitUntil: "domcontentloaded" }
    );
    await page.evaluate(() => document.fonts?.ready);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    await page.waitForFunction(() => {
      const summary = document.querySelector("#story-android-01 > summary");
      if (!summary) return false;
      const bounds = summary.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
    });

    const state = await page.evaluate(() => {
      const story = document.querySelector("#story-android-01");
      const family = story.closest(".story-family");
      const summaryBounds = story
        .querySelector("summary")
        .getBoundingClientRect();
      return {
        familyHidden: family.hidden,
        familyOpen: family.open,
        search: window.location.search,
        storyHidden: story.hidden,
        storyOpen: story.open,
        summaryBottom: summaryBounds.bottom,
        summaryTop: summaryBounds.top,
        viewportHeight: window.innerHeight
      };
    });

    assert.deepEqual(
      {
        familyHidden: state.familyHidden,
        familyOpen: state.familyOpen,
        search: state.search,
        storyHidden: state.storyHidden,
        storyOpen: state.storyOpen
      },
      {
        familyHidden: false,
        familyOpen: true,
        search: "",
        storyHidden: false,
        storyOpen: true
      }
    );
    assert.ok(state.summaryTop >= 0);
    assert.ok(state.summaryBottom <= state.viewportHeight);
    await page.close();
  }
});

test("summary metrics apply fast filters with mouse and keyboard", async (context) => {
  const browser = await chromium.launch({ headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1093, height: 904 }
  });
  await page.goto(`${baseUrl}/user-stories.html#story-android-01`, {
    waitUntil: "domcontentloaded"
  });

  await page.locator('[data-metric-scope="current"]').click();
  assert.equal(
    await page.locator("[data-story-id]:not([hidden])").count(),
    191
  );
  assert.equal(new URL(page.url()).search, "?scope=current");
  assert.equal(new URL(page.url()).hash, "");
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(
    await page.locator("[data-story-id]:not([hidden])").count(),
    191
  );
  assert.equal(new URL(page.url()).search, "?scope=current");
  assert.equal(new URL(page.url()).hash, "");

  await page.locator('[data-metric-readiness="In review"]').click();
  assert.equal(
    await page.locator("[data-story-id]:not([hidden])").count(),
    147
  );
  assert.equal(new URL(page.url()).search, "?readiness=In+review");
  assert.equal(
    await page
      .locator('[data-metric-readiness="In review"]')
      .getAttribute("aria-current"),
    "true"
  );

  await page.locator('[data-metric-scope="planned"]').press("Enter");
  assert.equal(await page.locator("[data-story-id]:not([hidden])").count(), 12);
  assert.equal(new URL(page.url()).search, "?scope=planned");

  await page.locator('[data-metric-scope="all"]').click();
  assert.equal(
    await page.locator("[data-story-id]:not([hidden])").count(),
    203
  );
  assert.equal(new URL(page.url()).search, "");

  await page.locator("[data-metric-family-picker]").press("Enter");
  assert.equal(new URL(page.url()).hash, "#story-families");
  assert.equal(
    await page.locator("[data-filter-panel]").getAttribute("open"),
    ""
  );
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "family-filter"
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(new URL(page.url()).hash, "#story-families");
  assert.equal(
    await page.locator("[data-filter-panel]").getAttribute("open"),
    ""
  );
});
