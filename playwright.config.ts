import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4317/forge/",
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
    command: "npm run build && node --import tsx server/src/e2e-server.ts",
    port: 4317,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI
  }
});
