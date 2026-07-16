import path from "node:path";
import { defineConfig } from "@playwright/test";

const resultPath = process.env.FORGE_PEOPLE_PERF_BROWSER_RESULT;
if (!resultPath) {
  throw new Error(
    "The People performance Playwright config must run through the isolated CLI."
  );
}

export default defineConfig({
  testDir: path.resolve(process.cwd(), "tests", "e2e"),
  testMatch: "people-performance*.spec.ts",
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: path.join(path.dirname(resultPath), "playwright-artifacts"),
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  }
});
