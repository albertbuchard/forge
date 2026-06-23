import { expect, type Page } from "@playwright/test";

export async function installE2eStorageGuards(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "forge-gamification-assets-setup-dismissed-v1",
      "1"
    );
  });
}

export async function dismissOptionalRewardArtDialog(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Download Forge reward art" });
  const notNowButton = dialog.getByRole("button", { name: "Not now" });
  if (
    await notNowButton
      .waitFor({ state: "visible", timeout: 1500 })
      .then(() => true)
      .catch(() => false)
  ) {
    await notNowButton.click();
    await expect(dialog).toBeHidden();
  }
}

export async function waitForForge(page: Page) {
  await page.waitForFunction(() => document.body.innerText.trim().length > 40);
  await dismissOptionalRewardArtDialog(page);
}
