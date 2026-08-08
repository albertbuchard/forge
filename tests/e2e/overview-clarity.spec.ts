import { expect, test } from "@playwright/test";
import { installE2eStorageGuards, waitForForge } from "./helpers";

const REQUIRED_HREFS = [
  "/forge/attention",
  "/forge/today",
  "/forge/calendar",
  "/forge/life-events",
  "/forge/activity",
  "/forge/insights",
  "/forge/review/weekly",
  "/forge/goals",
  "/forge/strategies",
  "/forge/projects",
  "/forge/projects/hierarchy",
  "/forge/kanban",
  "/forge/habits",
  "/forge/workbench",
  "/forge/notes",
  "/forge/wiki",
  "/forge/wiki/ingest-history",
  "/forge/knowledge-graph",
  "/forge/artifacts",
  "/forge/courses",
  "/forge/concepts",
  "/forge/life-force",
  "/forge/movement",
  "/forge/sleep",
  "/forge/sports",
  "/forge/training-load",
  "/forge/vitals",
  "/forge/weight-loss",
  "/forge/psyche",
  "/forge/preferences",
  "/forge/psyche/metrics",
  "/forge/psyche/flashcards",
  "/forge/psyche/values",
  "/forge/psyche/patterns",
  "/forge/psyche/questionnaires",
  "/forge/psyche/self-observation",
  "/forge/psyche/screen-time",
  "/forge/psyche/behaviors",
  "/forge/psyche/reports",
  "/forge/psyche/goal-map",
  "/forge/psyche/schemas-beliefs",
  "/forge/psyche/modes",
  "/forge/psyche/modes/guide",
  "/forge/people",
  "/forge/settings",
  "/forge/settings/data",
  "/forge/settings/users",
  "/forge/settings/calendar",
  "/forge/settings/mobile",
  "/forge/settings/models",
  "/forge/settings/agents",
  "/forge/settings/rewards",
  "/forge/settings/wiki",
  "/forge/settings/logs",
  "/forge/settings/bin",
  "/forge/rewards"
] as const;

test.beforeEach(async ({ page }, testInfo) => {
  await installE2eStorageGuards(page, testInfo.testId);
});

test("maps every production area once and keeps the semantic hierarchy", async ({
  page
}) => {
  await page.goto("overview");
  await waitForForge(page);

  const main = page.locator("main");
  await expect(main).toHaveCount(1);
  await expect(
    main.getByRole("heading", { name: "What matters now" })
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Continue where you left off" })
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Everything in Forge" })
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Health and capacity" })
  ).toBeVisible();

  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#forge-map a[href]")).map((link) =>
      link.getAttribute("href")
    )
  );
  for (const href of REQUIRED_HREFS) {
    expect(hrefs).toContain(href);
    expect(hrefs.filter((candidate) => candidate === href)).toHaveLength(1);
  }
  expect(hrefs).not.toContain("/forge/settings/mobile/lab");
  expect(hrefs).not.toContain("/forge/campaigns");

  const headingOrder = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main h2")).map((heading) =>
      heading.textContent?.trim()
    )
  );
  expect(headingOrder.indexOf("What matters now")).toBeLessThan(
    headingOrder.indexOf("Continue where you left off")
  );
  expect(headingOrder.indexOf("Continue where you left off")).toBeLessThan(
    headingOrder.indexOf("Everything in Forge")
  );
});

test("stays lean, keyboard-accessible, and responsive", async ({
  page
}, testInfo) => {
  const phone = testInfo.project.name === "pixel-7";
  await page.setViewportSize(
    phone ? { width: 390, height: 844 } : { width: 1280, height: 720 }
  );
  await page.goto("overview");
  await waitForForge(page);

  const metrics = await page.locator("main").evaluate((main) => {
    const links = Array.from(main.querySelectorAll("a[href]"));
    const buttons = Array.from(main.querySelectorAll("button"));
    const useful = [...links, ...buttons].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    });
    return {
      elements: document.querySelectorAll("*").length,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      usefulFirstViewport: useful.length,
      smithVisible: (() => {
        const smith = main.querySelector(
          '[data-testid="forge-smith-featured-trophy"]'
        );
        if (!smith) return false;
        const rect = smith.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      })()
    };
  });
  expect(metrics.elements).toBeLessThanOrEqual(phone ? 700 : 900);
  expect(metrics.overflow).toBe(false);
  expect(metrics.usefulFirstViewport).toBeGreaterThanOrEqual(phone ? 4 : 6);
  expect(metrics.smithVisible).toBe(true);

  const search = page
    .locator("main")
    .getByRole("button", { name: "Search Forge" });
  await expect(search).toBeVisible();
  await search.focus();
  await expect(search).toBeFocused();
  await search.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Forge Action bar" })
  ).toBeVisible();
  await page.keyboard.press("Escape");

  const create = page.locator("main").getByRole("button", { name: "Create" });
  await expect(create).toBeVisible();
  await create.click();
  await expect(
    page.getByRole("dialog", { name: "Create in Forge" })
  ).toBeVisible();
  await page.keyboard.press("Escape");
});

test("keeps the complete map available for an empty Attention state", async ({
  page
}) => {
  await page.route("**/api/v1/attention-inbox**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: new Date(0).toISOString(),
        state: "active",
        total: 0,
        offset: 0,
        limit: 6,
        hasMore: false,
        summary: {
          activeCount: 0,
          snoozedCount: 0,
          dismissedCount: 0,
          blockingCount: 0,
          importantCount: 0,
          sourceCounts: {
            approval: 0,
            insight: 0,
            task: 0,
            companion_sync: 0,
            agent_session: 0
          }
        },
        items: []
      })
    });
  });
  await page.goto("overview");
  await waitForForge(page);
  await expect(page.getByText("No items need attention")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Everything in Forge" })
  ).toBeVisible();
});

test("keeps the complete map available when Attention fails", async ({
  page
}) => {
  await page.route("**/api/v1/attention-inbox**", async (route) => {
    await route.fulfill({ status: 503, body: "unavailable" });
  });
  await page.goto("overview");
  await waitForForge(page);
  await expect(
    page.getByText(
      "Attention could not be loaded. Other Forge areas are still available."
    )
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Everything in Forge" })
  ).toBeVisible();
});
