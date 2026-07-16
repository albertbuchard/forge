import { readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { profileForMode } from "../../scripts/perf/people-performance-contract.mjs";
import { runPeopleBrowserPerformanceSuite } from "../../scripts/perf/people-performance-browser.mjs";

const configPath = process.env.FORGE_PEOPLE_PERF_BROWSER_CONFIG;
const resultPath = process.env.FORGE_PEOPLE_PERF_BROWSER_RESULT;

test("People production browser performance stays within configured ceilings", async () => {
  test.skip(
    !configPath || !resultPath,
    "Run through scripts/perf/people-performance.mjs so canonical data cannot be selected."
  );
  test.setTimeout(20 * 60_000);
  const config = JSON.parse(await readFile(configPath!, "utf8")) as {
    mode: "test" | "release";
    repositoryRoot: string;
    dataRoot: string;
    buildDir: string;
    runRoot: string;
    budgets: Record<string, Record<string, number>>;
  };
  const result = await runPeopleBrowserPerformanceSuite({
    repositoryRoot: config.repositoryRoot,
    dataRoot: config.dataRoot,
    buildDir: config.buildDir,
    runRoot: config.runRoot,
    profile: profileForMode(config.mode),
    budgets: config.budgets
  });
  await writeFile(resultPath!, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  expect(result.status, JSON.stringify(result.checks, null, 2)).toBe("pass");
});
