import { expect, test, type Page } from "@playwright/test";

async function waitForForge(page: Page) {
  await page.waitForFunction(() => document.body.innerText.trim().length > 40);
}

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

  await page.getByRole("link", { name: /^Movement$/ }).first().click();

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
