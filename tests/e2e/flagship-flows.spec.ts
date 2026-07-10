import { expect, test } from "@playwright/test";
import { installE2eStorageGuards, waitForForge } from "./helpers";

test.beforeEach(async ({ page }) => {
  await installE2eStorageGuards(page);
});

test("overview exposes momentum, rewards, and next actions", async ({ page }) => {
  await page.goto("");
  await waitForForge(page);
  await expect(page).toHaveURL(/\/forge\/overview$/);
  await expect(page.locator("body")).toContainText("Momentum summary");
  await expect(page.getByRole("heading", { name: "Next actions" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open rewards/ })).toBeVisible();
  await expect(page.locator("body")).toContainText("Projects, habits, tasks");
  await expect(page.locator("body")).toContainText("Life Force");

  const rewardPreview = page.getByRole("img", { name: "Fantasy preview" });
  await expect(rewardPreview).toBeVisible();
  await expect
    .poll(() =>
      rewardPreview.evaluate(
        (element) => (element as HTMLImageElement).naturalWidth
      )
    )
    .toBeGreaterThan(0);
});

test("today feels like a directive-driven operating surface", async ({ page }) => {
  await page.goto("today");
  await waitForForge(page);
  await expect(page).toHaveURL(/\/forge\/today$/);
  await expect(page.locator("body")).toContainText("Tasks for today");
  await expect(page.locator("body")).toContainText("Tasks by status");
  await expect(page.locator("body")).toContainText("Current task");
  await expect(page.locator("body")).toContainText("Due habits");
  await expect(page.locator("body")).toContainText("Life Force");
});

test("weekly review reads like an editorial calibration surface", async ({ page }) => {
  await page.goto("review/weekly");
  await waitForForge(page);
  await expect(page).toHaveURL(/\/forge\/review\/weekly$/);
  await expect(page.locator("body")).toContainText("This week, wins, recovery, and next steps");
  await expect(page.locator("body")).toContainText("Momentum summary");
  await expect(page.locator("body")).toContainText("Wins");
});

test("settings supports retroactive work logging and reward operations", async ({ page }, testInfo) => {
  await page.goto("settings/agents");
  await waitForForge(page);
  await expect(page).toHaveURL(/\/forge\/settings\/agents$/);
  await expect(page.locator("body")).toContainText("Connection status, capability access, tokens, approval queue, and work logging");
  await expect(page.locator("body")).toContainText("Retroactive work log");

  await page.goto("settings/rewards");
  await waitForForge(page);
  await expect(page).toHaveURL(/\/forge\/settings\/rewards$/);
  await expect(page.locator("body")).toContainText("Reward operations");

  if (testInfo.project.name !== "chromium") {
    return;
  }

  await page.goto("settings/agents");
  await waitForForge(page);
  await page.getByRole("button", { name: "Log work" }).click();
  await expect(page.locator('[data-testid="question-flow-dialog"]:visible').first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Is this work already tracked?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Describe what was done" })).toBeVisible();
  await page.getByPlaceholder("Write postmortem draft").first().fill("Playwright captured work");
  await page
    .getByPlaceholder("Wrote the full incident timeline and drafted the three key learnings for the team retrospective.")
    .first()
    .fill("Captured through the operator console to verify retroactive work logging.");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set the context and XP value" })).toBeVisible();
  const projectSelect = page.locator("select").first();
  const projectOptionCount = await projectSelect.locator("option").count();
  if (projectOptionCount > 1) {
    await projectSelect.selectOption({ index: 1 });
    await page.getByRole("button", { name: "Log work" }).click();
    await expect(page.getByText(/Logged Playwright captured work/)).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Log work" }).click();
    await expect(page.getByText("Tasks must belong to a project")).toBeVisible();
  }
});

test("psyche flagship surfaces render inside the shared shell", async ({ page }) => {
  await page.goto("psyche");
  await waitForForge(page);
  await expect(page).toHaveURL(/\/forge\/psyche$/);
  await expect(page.locator("body")).toContainText("Reflective pulse and live entity field");
  await expect(page.locator('[data-testid="psyche-hub-graph"]:visible').first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Reflect" })).toHaveCount(1);
  await expect(page.getByTestId("create-floating-trigger")).toBeVisible();

  await page.goto("psyche/goal-map");
  await waitForForge(page);
  await expect(page).toHaveURL(/\/forge\/psyche\/goal-map$/);
  await expect(page.locator('[data-testid="goal-gravity-graph"]:visible').first()).toBeVisible();

  await page.goto("psyche/reports");
  await waitForForge(page);
  await expect(page).toHaveURL(/\/forge\/psyche\/reports$/);
  await expect(page.locator("body")).toContainText("Capture the trigger, emotional wave, script, state, and next pivot");
  await expect(page.locator("body")).toContainText("Recent reports");
  await expect(page.locator("body")).not.toContainText("emotion | intensity | note | emotionId");
});

test("mode flow uses guided placeholders and inline help", async ({ page }) => {
  await page.goto("psyche/modes?create=1");
  await waitForForge(page);
  await expect(page.locator('[data-testid="question-flow-dialog"]:visible').first()).toBeVisible();
  await expect(page.getByPlaceholder("The Friday Vigil, The Scanner, The Good Son").first()).toBeVisible();
  await expect(page.getByPlaceholder("Detached protector, vulnerable child, demanding critic").first()).toBeVisible();
  await expect(page.locator('[aria-label="Explain Mode family"]').first()).toBeAttached();
});
