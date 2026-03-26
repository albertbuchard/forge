import { expect, test, type Locator, type Page } from "@playwright/test";

async function waitForForge(page: Page) {
  await page.waitForFunction(() => document.body.innerText.trim().length > 40);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
    })
    .toBe(0);
}

async function openFirstEntityLink(page: Page, pathPrefix: string) {
  const link = page.locator(`a[href*="${pathPrefix}"]:visible`).first();
  await expect(link).toBeVisible();
  await link.click();
  await waitForForge(page);
}

async function getMovableTaskCard(
  page: Page
): Promise<{ card: Locator; testId: string; direction: "next" | "previous" }> {
  const scrollSteps = [0, 320, 640, 960, 1280, 1600];

  for (const top of scrollSteps) {
    await page.evaluate((value) => window.scrollTo(0, value), top);
    const cards = page.locator('[data-testid^="task-card-"]:visible');
    const count = await cards.count();

    for (let index = 0; index < count; index += 1) {
      const card = cards.nth(index);
      const nextControl = card.getByLabel(/next lane/i);
      if (await nextControl.count()) {
        const testId = await card.getAttribute("data-testid");
        expect(testId).toBeTruthy();
        return { card, testId: testId!, direction: "next" };
      }
      const previousControl = card.getByLabel(/previous lane/i);
      if (await previousControl.count()) {
        const testId = await card.getAttribute("data-testid");
        expect(testId).toBeTruthy();
        return { card, testId: testId!, direction: "previous" };
      }
    }
  }

  throw new Error("No visible movable task card found on the mobile Kanban board.");
}

async function clickVisibleControl(control: Locator) {
  await expect(control).toBeVisible();
  await control.evaluate((element) => {
    (element as HTMLElement).click();
  });
}

test("mobile flagship routes stay inside the viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "pixel-7", "Mobile-only coverage");

  await page.goto("overview");
  await waitForForge(page);
  await expectNoHorizontalOverflow(page);

  await page.goto("goals");
  await waitForForge(page);
  await openFirstEntityLink(page, "/forge/goals/");
  await expectNoHorizontalOverflow(page);

  await page.goto("projects");
  await waitForForge(page);
  await openFirstEntityLink(page, "/forge/projects/");
  await expectNoHorizontalOverflow(page);

  await page.goto("kanban");
  await waitForForge(page);
  await expectNoHorizontalOverflow(page);

  await page.goto("psyche");
  await waitForForge(page);
  await expectNoHorizontalOverflow(page);

  await page.goto("psyche/beliefs");
  await waitForForge(page);
  await expectNoHorizontalOverflow(page);

  await page.goto("psyche/goal-map");
  await waitForForge(page);
  await expectNoHorizontalOverflow(page);
});

test("mobile shell controls stay pinned to the viewport bottom", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "pixel-7", "Mobile-only coverage");

  await page.goto("overview");
  await waitForForge(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const nav = document.querySelector('[data-testid="mobile-bottom-nav"]');
        const create = document.querySelector('[data-testid="create-floating-trigger"]');
        if (!nav || !create) {
          return null;
        }

        const navRect = nav.getBoundingClientRect();
        const createRect = create.getBoundingClientRect();
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;

        return {
          navBottomGap: Math.round(viewportHeight - navRect.bottom),
          createAboveNav: Math.round(navRect.top - createRect.bottom),
          createRightGap: Math.round(viewportHeight),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
    })
    .toMatchObject({
      navBottomGap: 0,
      overflow: 0
    });

  const geometry = await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="mobile-bottom-nav"]')!;
    const create = document.querySelector('[data-testid="create-floating-trigger"]')!;
    const navRect = nav.getBoundingClientRect();
    const createRect = create.getBoundingClientRect();
    return {
      createAboveNav: Math.round(navRect.top - createRect.bottom),
      rightGap: Math.round((window.visualViewport?.width ?? window.innerWidth) - createRect.right)
    };
  });

  expect(geometry.createAboveNav).toBeGreaterThanOrEqual(8);
  expect(geometry.rightGap).toBeGreaterThanOrEqual(0);
});

test("mobile kanban supports lane-step buttons without horizontal bleed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "pixel-7", "Mobile-only coverage");

  await page.goto("kanban");
  await waitForForge(page);

  const start = await getMovableTaskCard(page);
  await start.card.scrollIntoViewIfNeeded();
  await clickVisibleControl(start.card.getByLabel(start.direction === "next" ? /next lane/i : /previous lane/i));
  const movedCard = page.locator(`[data-testid="${start.testId}"]:visible`).first();
  await expect(movedCard).toBeVisible();
  const returnDirection = start.direction === "next" ? /previous lane/i : /next lane/i;
  if (await movedCard.getByLabel(returnDirection).count()) {
    await movedCard.scrollIntoViewIfNeeded();
    await clickVisibleControl(movedCard.getByLabel(returnDirection));
    await expect(page.locator(`[data-testid="${start.testId}"]:visible`).first()).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);
});
