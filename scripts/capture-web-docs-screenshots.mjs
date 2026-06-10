import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const baseUrl = process.env.FORGE_SCREENSHOT_BASE_URL ?? "http://127.0.0.1:4317/forge/";
const colorScheme =
  process.env.FORGE_SCREENSHOT_COLOR_SCHEME === "dark" ? "dark" : "light";
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
    name: "forge-projects-board.png",
    route: "projects",
    waitForText: "Projects",
    scrollTo: { x: 0, y: 160 }
  },
  {
    name: "forge-project-hierarchy.png",
    route: "projects/hierarchy",
    waitForText: "HIERARCHY CONTROLS",
    scrollTo: { x: 0, y: 180 }
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
    waitForText: "SLEEP CALENDAR",
    waitForSelector: 'button[aria-label^="Select sleep for "]',
    scrollTo: { x: 0, y: 150 }
  },
  {
    name: "forge-wiki-memory.png",
    route: "wiki",
    waitForText: "Search KarpaWiki",
    scrollTo: { x: 0, y: 0 }
  },
  {
    name: "forge-knowledge-graph.jpeg",
    route: "knowledge-graph",
    waitForText: "Knowledge Graph",
    waitForSelector: '[data-testid="knowledge-graph-count-pill"]',
    scrollTo: { x: 0, y: 0 }
  },
  {
    name: "forge-psyche-graph.png",
    route: "psyche",
    waitForText: "Psyche",
    scrollTo: { x: 0, y: 80 }
  },
  {
    name: "forge-agent-psyche-example.png",
    route: "psyche/reports",
    waitForText: "Recent reports",
    scrollTo: { x: 0, y: 120 }
  },
  {
    name: "forge-weight-loss-nutrition.png",
    route: "weight-loss",
    waitForText: "Calories, macros, and meal evidence",
    scrollTo: { x: 0, y: 140 }
  },
  {
    name: "forge-calendar-surface.png",
    route: "calendar",
    waitForText: "Calendar",
    scrollTo: { x: 0, y: 0 }
  },
  {
    name: "forge-calendar-week-view.png",
    route: "calendar",
    waitForText: "Calendar",
    scrollTo: { x: 0, y: 300 }
  },
  {
    name: "forge-habit-detail.png",
    route: "habits",
    waitForText: "Habits",
    scrollTo: { x: 0, y: 160 }
  },
  {
    name: "forge-preference-game.png",
    route: "preferences?tab=overview&domain=projects",
    waitForText: "Quiet cockpit dashboard",
    scrollTo: { x: 0, y: 180 }
  },
  {
    name: "forge-ios-companion-sync.png",
    route: "settings/mobile",
    waitForText: "Companion",
    scrollTo: { x: 0, y: 120 }
  },
  {
    name: "forge-agent-task-example.png",
    route: "settings/agents",
    waitForText: "Agents",
    scrollTo: { x: 0, y: 120 }
  },
  {
    name: "forge-multi-agent-collaboration.png",
    route: "settings/users",
    waitForText: "Users",
    scrollTo: { x: 0, y: 110 }
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

async function dismissTransientDialogs(page) {
  const notNowButton = page.getByRole("button", { name: /not now/i }).first();
  if (await notNowButton.isVisible().catch(() => false)) {
    await notNowButton.click().catch(() => {});
    await page.waitForTimeout(150);
  }

  const closeButton = page.locator('button[aria-label="Close"]').first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click().catch(() => {});
    await page.waitForTimeout(150);
  }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1320 },
    colorScheme,
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
      await dismissTransientDialogs(page);
      await scrollIntoFrame(page, capture);
      await page.waitForTimeout(400);
      const extension = path.extname(capture.name).toLowerCase();
      const type = extension === ".jpg" || extension === ".jpeg" ? "jpeg" : "png";
      await page.screenshot({
        path: path.join(outputDir, capture.name),
        type,
        quality: type === "jpeg" ? 92 : undefined
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
