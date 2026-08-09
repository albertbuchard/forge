import { expect, test, type Page } from "@playwright/test";
import { installE2eStorageGuards, waitForForge } from "./helpers";

type ObservedResponse = {
  path: string;
  status: number;
};

function streamResponseIndexes(responses: ObservedResponse[], status: number) {
  return responses.flatMap((response, index) =>
    response.path === "/api/v1/events/stream" && response.status === status
      ? [index]
      : []
  );
}

test.beforeEach(async ({ page }, testInfo) => {
  await installE2eStorageGuards(page, testInfo.testId);
});

test("live updates reconnect after the owner stream quota asks the browser to retry", async ({
  page
}: {
  page: Page;
}) => {
  const responses: ObservedResponse[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path === "/api/v1/events/stream" || path === "/api/v1/context") {
      responses.push({ path, status: response.status() });
    }
  });

  await page.goto("");
  await waitForForge(page);
  await expect
    .poll(() => streamResponseIndexes(responses, 200).length)
    .toBeGreaterThan(0);

  const probeStatuses = await page.evaluate(async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const response = await fetch("/api/v1/events/stream");
      statuses.push(response.status);
      await response.body?.cancel();
      if (response.status === 429) {
        break;
      }
    }
    return statuses;
  });
  expect(probeStatuses.at(-1)).toBe(429);

  const reloadStartIndex = responses.length;
  await page.reload();
  await waitForForge(page);

  await expect
    .poll(
      () => streamResponseIndexes(responses.slice(reloadStartIndex), 429).length
    )
    .toBeGreaterThan(0);
  await expect
    .poll(
      () => {
        const boundedRetryIndexes = streamResponseIndexes(responses, 429);
        const lastBoundedRetry = boundedRetryIndexes.at(-1) ?? -1;
        return streamResponseIndexes(responses, 200).some(
          (index) => index > lastBoundedRetry
        );
      },
      { timeout: 15_000 }
    )
    .toBe(true);

  const successfulReconnect = streamResponseIndexes(responses, 200).at(-1)!;
  await expect
    .poll(() =>
      responses.some(
        (response, index) =>
          index > successfulReconnect &&
          response.path === "/api/v1/context" &&
          response.status === 200
      )
    )
    .toBe(true);
});
