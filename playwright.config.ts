import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const configuredE2ePort = Number.parseInt(process.env.FORGE_E2E_PORT ?? "", 10);
const configuredE2eDataRoot = process.env.FORGE_E2E_DATA_ROOT?.trim() ?? "";
const configuredE2eOutputDir = process.env.FORGE_E2E_OUTPUT_DIR?.trim() ?? "";
const resolvedE2eDataRoot = path.resolve(configuredE2eDataRoot);
const resolvedE2eOutputDir = path.resolve(configuredE2eOutputDir);
const outputRelativeToDataRoot = path.relative(
  resolvedE2eDataRoot,
  resolvedE2eOutputDir
);
if (
  process.env.FORGE_E2E_MODE !== "isolated" ||
  !configuredE2eDataRoot ||
  !path.isAbsolute(configuredE2eDataRoot) ||
  !configuredE2eOutputDir ||
  !path.isAbsolute(configuredE2eOutputDir) ||
  outputRelativeToDataRoot === "" ||
  outputRelativeToDataRoot.startsWith("..") ||
  path.isAbsolute(outputRelativeToDataRoot) ||
  !Number.isInteger(configuredE2ePort) ||
  configuredE2ePort < 1024 ||
  configuredE2ePort > 65_535 ||
  configuredE2ePort === 4317 ||
  configuredE2ePort === 3027
) {
  throw new Error(
    "Forge browser tests must run through npm run test:e2e in isolated mode."
  );
}
const e2ePort = configuredE2ePort;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}/forge/`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  outputDir: resolvedE2eOutputDir,
  reporter: process.env.CI
    ? [
        ["github"],
        [
          "html",
          {
            open: "never",
            outputFolder: path.join(resolvedE2eOutputDir, "html-report")
          }
        ]
      ]
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
    command: `node node_modules/vite/bin/vite.js build && PORT=${e2ePort} node --import tsx apps/api/src/e2e-server.ts`,
    port: e2ePort,
    timeout: 120_000,
    reuseExistingServer: false
  }
});
