import { expect, test } from "@playwright/test";
import { installE2eStorageGuards, waitForForge } from "./helpers";

const workoutTypes = [
  "running",
  "cycling",
  "walking",
  "kickboxing",
  "traditional_strength_training",
  "high_intensity_interval_training",
  "snow_sports",
  "core_training"
];

test.beforeEach(async ({ page }) => {
  await installE2eStorageGuards(page);
});

test("sports comparison and type search stay inside the viewport", async ({
  page
}, testInfo) => {
  await page.goto("overview");
  await waitForForge(page);

  const createResponse = await page.request.post("/api/v1/entities/create", {
    data: {
      atomic: true,
      operations: workoutTypes.map((workoutType, index) => {
        const startedAt = new Date(Date.UTC(2026, 6, 1 + index, 8, 0, 0));
        const endedAt = new Date(
          startedAt.getTime() + (30 + index * 5) * 60_000
        );
        return {
          entityType: "workout_session",
          clientRef: `${testInfo.project.name}-${workoutType}`,
          data: {
            workoutType,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            activeEnergyKcal: 180 + index * 25,
            averageHeartRate: 128 + index,
            maxHeartRate: 154 + index,
            subjectiveEffort: 5 + (index % 4)
          }
        };
      })
    }
  });
  expect(createResponse.ok()).toBe(true);

  await page.goto("sports");
  await waitForForge(page);

  const comparison = page.getByTestId("sport-comparison-panel");
  await expect(comparison).toBeVisible();
  await expect
    .poll(() =>
      comparison.evaluate(
        (element) => element.scrollWidth - element.clientWidth
      )
    )
    .toBe(0);

  const typeSearch = page.getByRole("combobox", {
    name: "Search exercise types"
  });
  await expect(typeSearch).toBeVisible();
  await typeSearch.fill("run");

  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const popup = await listbox.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      zIndex: Number.parseInt(getComputedStyle(element).zIndex, 10)
    };
  });
  expect(popup.top).toBeGreaterThanOrEqual(0);
  expect(popup.bottom).toBeLessThanOrEqual(popup.viewportHeight);
  expect(popup.left).toBeGreaterThanOrEqual(0);
  expect(popup.right).toBeLessThanOrEqual(popup.viewportWidth);
  expect(popup.zIndex).toBeGreaterThanOrEqual(40);
});
