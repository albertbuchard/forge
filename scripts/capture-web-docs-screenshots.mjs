import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const baseUrl = process.env.FORGE_SCREENSHOT_BASE_URL ?? "http://127.0.0.1:4317/forge/";
const outputDir = path.resolve(
  projectRoot,
  process.env.FORGE_SCREENSHOT_OUTPUT_DIR ?? "openclaw-plugin/docs/assets"
);

const captures = [
  {
    name: "forge-overview-dashboard.png",
    route: "overview",
    waitForText: "MOMENTUM SUMMARY",
    scrollTo: { x: 0, y: 0 }
  },
  {
    name: "forge-kanban-board.png",
    route: "kanban",
    waitForText: "BOARD",
    waitForSelector: '[data-testid="kanban-lane-backlog"]',
    scrollTo: { x: 0, y: 320 }
  },
  {
    name: "forge-movement-life-timeline.png",
    route: "movement",
    waitForText: "Life graph",
    scrollSelector: "text=Life graph",
    scrollOffset: -90
  },
  {
    name: "forge-sleep-overview.png",
    route: "sleep",
    waitForText: "Recent sleep pattern",
    scrollTo: { x: 0, y: 230 }
  },
  {
    name: "forge-wiki-memory.png",
    route: "wiki",
    waitForText: "Search KarpaWiki",
    scrollTo: { x: 0, y: 0 }
  }
];

function resolveRouteUrl(route) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(route, normalizedBase).toString();
}

async function waitForAppReady(page, text) {
  await page.waitForLoadState("load");
  await page.waitForFunction(
    (expected) => document.body?.innerText?.includes(expected),
    text,
    { timeout: 30_000 }
  );
}

async function scrollIntoFrame(page, capture) {
  if (capture.scrollSelector) {
    const locator = page.locator(capture.scrollSelector).first();
    await locator.scrollIntoViewIfNeeded();
    if (capture.scrollOffset) {
      await page.evaluate((offset) => {
        window.scrollBy({ top: offset, left: 0, behavior: "instant" });
      }, capture.scrollOffset);
    }
    return;
  }
  if (capture.scrollTo) {
    await page.evaluate(({ x, y }) => {
      window.scrollTo({ top: y, left: x, behavior: "instant" });
    }, capture.scrollTo);
  }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1320 },
    colorScheme: "dark",
    reducedMotion: "reduce",
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
      [data-sonner-toaster], [role="status"][aria-live], [role="alert"] {
        display: none !important;
      }
    `
  }).catch(() => {});

  try {
    for (const capture of captures) {
      console.log(`Capturing ${capture.name} from ${capture.route}`);
      await page.goto(resolveRouteUrl(capture.route), { waitUntil: "domcontentloaded" });
      await waitForAppReady(page, capture.waitForText);
      if (capture.waitForSelector) {
        await page.locator(capture.waitForSelector).first().waitFor({ state: "visible", timeout: 30_000 });
      }
      await scrollIntoFrame(page, capture);
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(outputDir, capture.name),
        type: "png"
      });
      console.log(`Saved ${capture.name}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  for (const capture of captures) {
    console.log(path.join(outputDir, capture.name));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
