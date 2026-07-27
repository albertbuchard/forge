import { defineConfig, devices } from "@playwright/test";

const configuredE2ePort = Number.parseInt(process.env.FORGE_E2E_PORT ?? "", 10);
const e2ePort =
  Number.isInteger(configuredE2ePort) && configuredE2ePort > 0
    ? configuredE2ePort
    : 4317;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}/forge/`;
const reuseManagedE2eServer =
  process.env.FORGE_E2E_REUSE_EXISTING_SERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: e2eBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "pixel-7",
      use: { ...devices["Pixel 7"] }
    }
  ],
  webServer: {
    command: `npm run build && PORT=${e2ePort} node --import tsx apps/api/src/e2e-server.ts`,
    port: e2ePort,
    timeout: 120_000,
    reuseExistingServer:
      reuseManagedE2eServer || (e2ePort === 4317 && !process.env.CI)
  }
});
