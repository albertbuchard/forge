import { expect, test } from "@playwright/test";
import { installE2eStorageGuards, waitForForge } from "./helpers";

test.beforeEach(async ({ page }) => {
  await installE2eStorageGuards(page);
});

test("desktop shell switches route context immediately without a blank loading frame", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop-only shell regression");

  let delayedMovementRequest: Promise<void> | null = null;
  await page.route("**/api/v1/movement/**", async (route) => {
    if (delayedMovementRequest) {
      await route.continue();
      return;
    }
    delayedMovementRequest = new Promise((resolve) =>
      setTimeout(resolve, 900)
    ).then(async () => {
      await route.continue();
    });
    await delayedMovementRequest;
  });

  await page.goto("overview");
  await waitForForge(page);

  const routeTitle = page.locator("[data-shell-route-title]");
  const main = page.locator("main");
  await expect(routeTitle).toHaveText("Overview");

  await page.locator('a[href="/forge/movement"]').first().click();

  await expect(routeTitle).toHaveText("Movement");
  await expect(main.getByText("Loading movement workspace")).toBeVisible();
  await expect(main).not.toBeEmpty();
  await delayedMovementRequest;
});

test("desktop shell header collapses on long routes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop-only shell regression");

  await page.goto("habits");
  await waitForForge(page);

  const header = page.locator("header.sticky").first();
  const before = await header.evaluate((element) =>
    Math.round(element.getBoundingClientRect().height)
  );

  await page.evaluate(() => window.scrollTo(0, 320));

  await expect
    .poll(async () =>
      header.evaluate((element) =>
        Math.round(element.getBoundingClientRect().height)
      )
    )
    .toBeLessThan(before);

  await page.evaluate(() => window.scrollTo(0, 0));

  await expect
    .poll(async () =>
      header.evaluate((element) =>
        Math.round(element.getBoundingClientRect().height)
      )
    )
    .toBe(before);
  await expect(page.locator("[data-shell-collapse-state]")).toHaveAttribute(
    "data-shell-collapse-state",
    "expanded"
  );
});

test("mobile shell header interpolates, collapses, and expands", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "pixel-7", "Mobile-only shell regression");

  await page.goto("rewards");
  await waitForForge(page);

  const root = page.locator("[data-shell-collapse-state]");
  const header = page.locator('[data-shell-collapse-header="mobile"]');
  const before = await header.evaluate(
    (element) => element.getBoundingClientRect().height
  );

  await page.evaluate(() => window.scrollTo(0, 40));
  await expect
    .poll(async () =>
      root.evaluate((element) =>
        Number(
          getComputedStyle(element).getPropertyValue("--forge-shell-collapse")
        )
      )
    )
    .toBeGreaterThan(0);

  const midState = await root.evaluate((element) => ({
    height: document
      .querySelector('[data-shell-collapse-header="mobile"]')!
      .getBoundingClientRect().height,
    progress: Number(
      getComputedStyle(element).getPropertyValue("--forge-shell-collapse")
    )
  }));
  expect(midState.progress).toBeGreaterThan(0);
  expect(midState.progress).toBeLessThan(1);
  expect(midState.height).toBeLessThan(before);

  await page.evaluate(() => window.scrollTo(0, 200));
  await expect(root).toHaveAttribute("data-shell-collapse-state", "collapsed");
  const collapsed = await header.evaluate(
    (element) => element.getBoundingClientRect().height
  );
  expect(collapsed).toBeLessThan(midState.height);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(root).toHaveAttribute("data-shell-collapse-state", "expanded");
  await expect
    .poll(() =>
      header.evaluate((element) => element.getBoundingClientRect().height)
    )
    .toBeCloseTo(before, 0);
});
