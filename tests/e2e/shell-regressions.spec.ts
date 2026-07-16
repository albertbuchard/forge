import { expect, test } from "@playwright/test";
import { installE2eStorageGuards, waitForForge } from "./helpers";

test.beforeEach(async ({ page }) => {
  await installE2eStorageGuards(page);
});

test("desktop shell switches route context immediately without a blank loading frame", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Desktop-only shell regression"
  );

  await page.goto("habits");
  await waitForForge(page);

  const routeTitle = page.locator("[data-shell-route-title]");
  const main = page.locator("main");
  await expect(routeTitle).toHaveText("Habits");

  let delayedMovementChunk: Promise<void> | null = null;
  await page.route("**/assets/movement-page-*.js", async (route) => {
    if (delayedMovementChunk) {
      await route.continue();
      return;
    }
    delayedMovementChunk = new Promise((resolve) =>
      setTimeout(resolve, 900)
    ).then(async () => {
      await route.continue();
    });
    await delayedMovementChunk;
  });

  await page.evaluate(() => {
    const frameSamples: Array<{
      contentEmpty: boolean;
      fallbackVisible: boolean;
    }> = [];
    (
      window as Window & {
        __FORGE_SHELL_FRAME_SAMPLES__?: Array<{
          contentEmpty: boolean;
          fallbackVisible: boolean;
        }>;
      }
    ).__FORGE_SHELL_FRAME_SAMPLES__ = frameSamples;
    const startedAt = performance.now();
    const sample = () => {
      const content = document.querySelector<HTMLElement>(
        "[data-route-transition-content]"
      );
      const fallback = document.querySelector<HTMLElement>(
        "[data-route-transition-fallback]"
      );
      const style = fallback ? getComputedStyle(fallback) : null;
      const bounds = fallback?.getBoundingClientRect();
      frameSamples.push({
        contentEmpty: !content || content.childElementCount === 0,
        fallbackVisible: Boolean(
          fallback &&
          style?.display !== "none" &&
          style?.visibility !== "hidden" &&
          bounds &&
          bounds.width > 0 &&
          bounds.height > 0
        )
      });
      if (performance.now() - startedAt < 1_200) {
        requestAnimationFrame(sample);
      }
    };
    requestAnimationFrame(sample);
  });

  await page.locator('a[href="/forge/movement"]').first().click();

  await expect(routeTitle).toHaveText("Movement");
  await expect(main).not.toBeEmpty();
  await expect.poll(() => delayedMovementChunk !== null).toBe(true);
  await delayedMovementChunk;
  await expect(page).toHaveURL(/\/forge\/movement$/);
  await page.waitForTimeout(350);

  const frameSamples = await page.evaluate(
    () =>
      (
        window as Window & {
          __FORGE_SHELL_FRAME_SAMPLES__?: Array<{
            contentEmpty: boolean;
            fallbackVisible: boolean;
          }>;
        }
      ).__FORGE_SHELL_FRAME_SAMPLES__ ?? []
  );
  expect(frameSamples.length).toBeGreaterThan(5);
  expect(
    frameSamples.filter(
      ({ contentEmpty, fallbackVisible }) => contentEmpty && !fallbackVisible
    )
  ).toEqual([]);
});

test("desktop shell header collapses on long routes", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Desktop-only shell regression"
  );

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
  test.skip(
    testInfo.project.name !== "pixel-7",
    "Mobile-only shell regression"
  );

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
