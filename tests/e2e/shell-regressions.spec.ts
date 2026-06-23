import { expect, test } from "@playwright/test";
import { installE2eStorageGuards, waitForForge } from "./helpers";

test.beforeEach(async ({ page }) => {
  await installE2eStorageGuards(page);
});

test("desktop shell keeps the current route visible until next-route data is ready", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop-only shell regression");

  await page.route("**/api/v1/movement/**", async (route) => {
    await page.waitForTimeout(900);
    await route.continue();
  });

  await page.goto("overview");
  await waitForForge(page);

  const header = page.locator("header.sticky").first();
  await expect(header).toContainText("Overview");

  await page.locator('a[href="/forge/movement"]').first().click();

  await page.waitForTimeout(250);
  await expect(header).toContainText("Overview");

  await expect(header).toContainText("Movement");
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
});
