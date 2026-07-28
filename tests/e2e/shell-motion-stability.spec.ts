import { expect, test, type Locator, type Page } from "@playwright/test";
import { installE2eStorageGuards, waitForForge } from "./helpers";

type PaintMetrics = {
  averageLuminance: number;
  brightPixelRatio: number;
  nonBlackPixelRatio: number;
};

async function paintMetrics(page: Page, locator: Locator) {
  const screenshot = await locator.screenshot({ animations: "allow" });
  const dataUrl = `data:image/png;base64,${screenshot.toString("base64")}`;
  return page.evaluate(async (source): Promise<PaintMetrics> => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Canvas 2D context is unavailable.");
    }
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let luminanceTotal = 0;
    let brightPixels = 0;
    let nonBlackPixels = 0;
    const pixelCount = pixels.length / 4;
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance =
        pixels[index] * 0.2126 +
        pixels[index + 1] * 0.7152 +
        pixels[index + 2] * 0.0722;
      luminanceTotal += luminance;
      if (luminance >= 64) brightPixels += 1;
      if (luminance >= 8) nonBlackPixels += 1;
    }
    return {
      averageLuminance: luminanceTotal / pixelCount,
      brightPixelRatio: brightPixels / pixelCount,
      nonBlackPixelRatio: nonBlackPixels / pixelCount
    };
  }, dataUrl);
}

function expectPainted(metrics: PaintMetrics, surface: string) {
  expect(
    metrics.averageLuminance,
    `${surface} average luminance`
  ).toBeGreaterThan(12);
  expect(
    metrics.nonBlackPixelRatio,
    `${surface} non-black pixels`
  ).toBeGreaterThan(0.92);
  expect(metrics.brightPixelRatio, `${surface} visible ink`).toBeGreaterThan(
    0.008
  );
}

test.beforeEach(async ({ page }, testInfo) => {
  await installE2eStorageGuards(page, testInfo.testId);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`mobile shell remains painted through startup and scroll with ${reducedMotion} motion`, async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "pixel-7",
      "Mobile compositor regression"
    );
    test.setTimeout(60_000);
    await page.emulateMedia({ reducedMotion });
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("people");
    await waitForForge(page);
    const header = page.locator('[data-shell-collapse-header="mobile"]');
    const bottomNav = page.getByTestId("mobile-bottom-nav");
    await expect(header).toBeVisible();
    await expect(bottomNav).toBeVisible();

    const layerStyles = await Promise.all(
      [header, bottomNav].map((surface) =>
        surface.evaluate((element) => {
          const style = window.getComputedStyle(element);
          return {
            backfaceVisibility: style.backfaceVisibility,
            contain: style.contain,
            transform: style.transform,
            willChange: style.willChange
          };
        })
      )
    );
    expect(layerStyles).toEqual([
      {
        backfaceVisibility: "visible",
        contain: "none",
        transform: "none",
        willChange: "auto"
      },
      {
        backfaceVisibility: "visible",
        contain: "none",
        transform: "none",
        willChange: "auto"
      }
    ]);

    for (let sample = 0; sample < 12; sample += 1) {
      expectPainted(
        await paintMetrics(page, header),
        `startup header ${sample}`
      );
      expectPainted(
        await paintMetrics(page, bottomNav),
        `startup bottom navigation ${sample}`
      );
      await page.waitForTimeout(80);
    }

    await page.evaluate(() => {
      document.documentElement.style.minHeight = "3200px";
      document.body.style.minHeight = "3200px";
    });
    const scrollPositions = [
      0, 12, 24, 36, 48, 60, 72, 84, 96, 120, 96, 72, 48, 24, 0
    ];
    for (const [sample, scrollTop] of scrollPositions.entries()) {
      await page.evaluate((top) => window.scrollTo(0, top), scrollTop);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      expectPainted(
        await paintMetrics(page, header),
        `scroll header ${sample}`
      );
      expectPainted(
        await paintMetrics(page, bottomNav),
        `scroll bottom navigation ${sample}`
      );
      const [headerBox, navBox] = await Promise.all([
        header.boundingBox(),
        bottomNav.boundingBox()
      ]);
      expect(headerBox?.y ?? Number.NaN).toBeGreaterThanOrEqual(-1);
      expect(headerBox?.y ?? Number.NaN).toBeLessThanOrEqual(1);
      expect(navBox).not.toBeNull();
      expect(
        Math.abs(
          (navBox?.y ?? 0) +
            (navBox?.height ?? 0) -
            (page.viewportSize()?.height ?? 0)
        )
      ).toBeLessThanOrEqual(1);
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}
