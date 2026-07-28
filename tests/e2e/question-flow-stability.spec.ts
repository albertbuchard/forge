import { expect, test, type Page } from "@playwright/test";
import {
  e2eMutationHeaders,
  installE2eStorageGuards,
  waitForForge
} from "./helpers";

type TransitionSample = {
  elapsedMs: number;
  opacity: number;
  painted: boolean;
  stepId: string | null;
  textLength: number;
};

async function samplePersonStepTransition(page: Page) {
  await page.goto("people");
  await waitForForge(page);
  await page.getByRole("button", { name: "Add person", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Display name").fill("Transition stability check");
  await expect(page.getByTestId("question-flow-step")).toHaveAttribute(
    "data-step-id",
    "identity"
  );

  return page.evaluate(async () => {
    const canvas = document.querySelector<HTMLElement>(
      '[data-testid="question-flow-canvas"]'
    );
    const dialogElement =
      document.querySelector<HTMLElement>('[role="dialog"]');
    const continueButton = [
      ...(dialogElement?.querySelectorAll("button") ?? [])
    ].find((candidate) => candidate.textContent?.includes("Continue"));

    if (!canvas || !(continueButton instanceof HTMLButtonElement)) {
      throw new Error(
        "The guided-flow canvas or Continue button is unavailable."
      );
    }

    const samples: TransitionSample[] = [];
    const startedAt = performance.now();
    continueButton.click();

    await new Promise<void>((resolve) => {
      const sampleFrame = () => {
        const step = canvas.querySelector<HTMLElement>(
          '[data-testid="question-flow-step"]'
        );
        const elapsedMs = performance.now() - startedAt;
        const opacity = step
          ? Number.parseFloat(window.getComputedStyle(step).opacity)
          : 0;
        const rect = step?.getBoundingClientRect();
        const textLength = step?.innerText.trim().length ?? 0;
        samples.push({
          elapsedMs,
          opacity,
          painted:
            Boolean(rect && rect.width > 0 && rect.height > 0) &&
            textLength > 0 &&
            opacity >= 0.7,
          stepId: step?.dataset.stepId ?? null,
          textLength
        });

        if (elapsedMs < 650) {
          window.requestAnimationFrame(sampleFrame);
        } else {
          resolve();
        }
      };

      window.requestAnimationFrame(sampleFrame);
    });

    return samples;
  });
}

test.beforeEach(async ({ page }, testInfo) => {
  await installE2eStorageGuards(page, testInfo.testId);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`guided steps never paint an empty frame with ${reducedMotion} motion`, async ({
    page
  }) => {
    await page.emulateMedia({ reducedMotion });

    const samples = await samplePersonStepTransition(page);

    expect(samples.length).toBeGreaterThan(8);
    expect(samples.every((sample) => sample.painted)).toBe(true);
    expect(samples.some((sample) => sample.stepId === "relationship")).toBe(
      true
    );
    expect(
      Math.min(...samples.map((sample) => sample.opacity))
    ).toBeGreaterThanOrEqual(0.7);
  });
}

test("the guided Person flow saves rich local context without browser persistence", async ({
  page
}, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const displayName = `Guided QA ${suffix}`;
  const privateNote = `Private browser-storage sentinel ${suffix}`;
  const contactValue = `guided-${suffix}@example.com`;
  const factValue = `Morning ${suffix}`;
  const failedResponses: Array<{ status: number; url: string }> = [];
  const pageErrors: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push({ status: response.status(), url: response.url() });
    }
  });

  await page.goto("people");
  await waitForForge(page);
  await page.getByRole("button", { name: "Add person", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Display name").fill(displayName);
  await dialog.getByLabel("Preferred name").fill("Guided");
  await dialog.getByLabel("Aliases").fill(`QA ${suffix}, Guided test`);
  await dialog.getByRole("button", { name: "Continue" }).click();

  await dialog.getByLabel("Relationship label").fill("QA collaborator");
  await dialog.getByLabel("Closeness").selectOption("4");
  await dialog.getByRole("button", { name: "High", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();

  await dialog
    .getByLabel("Short description")
    .fill("A synthetic Person used to verify the complete guided flow.");
  await dialog
    .getByLabel("Relationship context")
    .fill("Stored only in this isolated E2E Forge data root.");
  await dialog.getByLabel("Private notes").fill(privateNote);
  await dialog.getByRole("button", { name: "Continue" }).click();

  await dialog.getByLabel("Birthday precision").selectOption("month_day");
  await dialog.getByLabel("Birthday month", { exact: true }).fill("7");
  await dialog.getByLabel("Birthday day", { exact: true }).fill("15");
  await dialog.getByLabel("Timezone").fill("Europe/Zurich");
  await dialog.getByLabel("Home place label").fill("Zurich");
  await dialog.getByRole("button", { name: "Continue" }).click();

  await dialog.getByRole("button", { name: "Add contact" }).click();
  await dialog.getByLabel("Contact label", { exact: true }).fill("Work");
  await dialog.getByLabel("Contact value", { exact: true }).fill(contactValue);
  await dialog.getByRole("checkbox", { name: "Primary email contact" }).check();

  await dialog.getByRole("button", { name: "Add fact" }).click();
  await dialog
    .getByLabel("Fact label", { exact: true })
    .fill("Preferred meeting time");
  const factSensitivity = dialog
    .locator("label")
    .filter({ hasText: "Fact sensitivity" })
    .locator("select");
  await factSensitivity.evaluate((element) =>
    element.scrollIntoView({ block: "center" })
  );
  await factSensitivity.selectOption("sensitive");
  await factSensitivity.selectOption("personal");
  await expect(factSensitivity).toHaveValue("personal");
  await dialog.getByLabel("Fact value", { exact: true }).fill(factValue);

  const storageBeforeSubmit = await page.evaluate(
    async (sentinels) => {
      let cacheContainsSensitiveValue = false;
      for (const cacheName of await window.caches.keys()) {
        const cache = await window.caches.open(cacheName);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          if (response) {
            const body = await response
              .clone()
              .text()
              .catch(() => "");
            if (sentinels.some((sentinel) => body.includes(sentinel))) {
              cacheContainsSensitiveValue = true;
            }
          }
        }
      }
      return {
        cacheContainsSensitiveValue,
        persistedStorage: JSON.stringify({
          localStorage: Object.fromEntries(
            Object.keys(window.localStorage).map((key) => [
              key,
              window.localStorage.getItem(key)
            ])
          ),
          sessionStorage: Object.fromEntries(
            Object.keys(window.sessionStorage).map((key) => [
              key,
              window.sessionStorage.getItem(key)
            ])
          )
        }),
        url: window.location.href
      };
    },
    [privateNote, contactValue, factValue]
  );
  expect(storageBeforeSubmit.cacheContainsSensitiveValue).toBe(false);
  expect(storageBeforeSubmit.persistedStorage).not.toContain(privateNote);
  expect(storageBeforeSubmit.persistedStorage).not.toContain(contactValue);
  expect(storageBeforeSubmit.persistedStorage).not.toContain(factValue);
  expect(storageBeforeSubmit.url).not.toContain(privateNote);
  expect(storageBeforeSubmit.url).not.toContain(contactValue);
  expect(storageBeforeSubmit.url).not.toContain(factValue);

  await dialog.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
  await expect(page.getByText(privateNote, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: contactValue })
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: factValue })
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});

test("People pagination preserves loaded rows and waits for deliberate retry after 429", async ({
  page
}, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const prefix = `Paging QA ${suffix}`;

  await page.goto("");
  await waitForForge(page);

  const usersResponse = await page.request.get("/api/v1/users");
  expect(usersResponse.ok()).toBe(true);
  const usersBody = (await usersResponse.json()) as {
    users: Array<{ id: string; kind: string }>;
  };
  const owner = usersBody.users.find((user) => user.kind === "human");
  expect(owner).toBeDefined();

  const operations = Array.from({ length: 101 }, (_, index) => ({
    entityType: "person",
    idempotencyKey: `e2e-people-pagination-${suffix}-${String(index).padStart(3, "0")}`,
    data: {
      userId: owner!.id,
      displayName: `${prefix} ${String(index).padStart(3, "0")}`,
      relationshipCategory: "community",
      relationshipLabel: "Community",
      shortDescription: "Isolated browser pagination regression fixture."
    }
  }));
  for (const batch of [operations.slice(0, 100), operations.slice(100)]) {
    const createResponse = await page.request.post("/api/v1/entities/create", {
      headers: await e2eMutationHeaders(page),
      data: { atomic: true, operations: batch }
    });
    expect(createResponse.ok()).toBe(true);
    const createBody = (await createResponse.json()) as {
      results: Array<{ ok: boolean }>;
    };
    expect(createBody.results.every((result) => result.ok)).toBe(true);
  }

  let failContinuation = true;
  let continuationAttempts = 0;
  await page.route("**/api/v1/people?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("cursor")) {
      continuationAttempts += 1;
      if (failContinuation) {
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          headers: { "Retry-After": "30" },
          body: JSON.stringify({
            code: "peer_rate_limit_exceeded",
            error: "Too many People operations were requested.",
            statusCode: 429,
            operationId: "listPeopleReadModel",
            limit: 480,
            retryAfterSeconds: 30
          })
        });
        return;
      }
    }
    await route.continue();
  });

  await page.goto("people");
  await waitForForge(page);
  await page.getByLabel("Search People").fill(prefix);
  await expect(page.getByText("100 loaded", { exact: true })).toBeVisible();

  const scroll = page.getByTestId("people-virtual-scroll");
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(page.getByText("We couldn't load more people")).toBeVisible();
  await expect(page.getByText("100 loaded", { exact: true })).toBeVisible();
  expect(await page.locator("[data-person-id]").count()).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(continuationAttempts).toBe(1);

  failContinuation = false;
  await page.getByRole("button", { name: "Retry loading more" }).click();
  await expect(page.getByText("101 loaded", { exact: true })).toBeVisible();
  await expect(page.getByText("We couldn't load more people")).toBeHidden();
  expect(continuationAttempts).toBe(2);
});
