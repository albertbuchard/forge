import { expect, test, type Page } from "@playwright/test";
import { installE2eStorageGuards, waitForForge } from "./helpers";

const SETTINGS_INDEX = [
  [
    "Runtime",
    "/forge/settings",
    "Operator session, execution policy, appearance, locale, and Doctor checks."
  ],
  [
    "Data",
    "/forge/settings/data",
    "Active data root, backups, exports, and recovery candidates."
  ],
  [
    "Users",
    "/forge/settings/users",
    "Human and bot identities, ownership, and directional access."
  ],
  [
    "Calendar",
    "/forge/settings/calendar",
    "Provider connections, calendar selection, and sync defaults."
  ],
  [
    "Mobile",
    "/forge/settings/mobile",
    "iPhone and watch pairing, permissions, sync, and recovery."
  ],
  [
    "Models",
    "/forge/settings/models",
    "Model providers, credentials, defaults, and health checks."
  ],
  [
    "Agents",
    "/forge/settings/agents",
    "Agent identities, sessions, scopes, tokens, and approvals."
  ],
  [
    "Rewards",
    "/forge/settings/rewards",
    "Progression rules, assets, and reward controls."
  ],
  [
    "KarpaWiki",
    "/forge/settings/wiki",
    "Wiki spaces, index health, ingest behavior, and reindexing."
  ],
  [
    "Logs",
    "/forge/settings/logs",
    "Bounded runtime diagnostics and recovery evidence."
  ],
  [
    "Bin",
    "/forge/settings/bin",
    "Soft-deleted records available for deliberate recovery."
  ]
] as const;

test.beforeEach(async ({ page }, testInfo) => {
  await installE2eStorageGuards(page, testInfo.testId);
});

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      )
    )
    .toBe(0);
}

async function openPhoneSettingsIndex(page: Page, section: string) {
  const browse = page.getByRole("button", {
    name: `Settings section ${section} Browse`
  });
  await expect(browse).toBeVisible();
  await browse.click();
  const dialog = page.getByRole("dialog", { name: "Settings sections" });
  await expect(dialog).toBeVisible();
  return { browse, dialog };
}

test("the desktop index names and routes every settings area", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop-only coverage");

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("settings");
  await waitForForge(page);

  const navigation = page.getByRole("navigation", {
    name: "Settings sections"
  });
  await expect(navigation).toBeVisible();
  const links = navigation.getByRole("link");
  await expect(links).toHaveCount(SETTINGS_INDEX.length);

  for (const [label, href, description] of SETTINGS_INDEX) {
    const link = navigation.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAccessibleDescription(description);
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalOverflow(page);

  const dataLink = navigation.getByRole("link", {
    name: "Data",
    exact: true
  });
  await dataLink.click();
  await expect(page).toHaveURL(/\/forge\/settings\/data$/);
  await expect(
    page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("link", { name: "Data", exact: true })
  ).toBeFocused();
});

test("the phone index keeps every route reachable and restores focus", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "pixel-7", "Phone-only coverage");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("settings");
  await waitForForge(page);
  await expectNoHorizontalOverflow(page);

  const { browse, dialog } = await openPhoneSettingsIndex(page, "Runtime");
  await expect(dialog.getByRole("link")).toHaveCount(SETTINGS_INDEX.length);
  for (const [label, href, description] of SETTINGS_INDEX) {
    const link = dialog.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAccessibleDescription(description);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(browse).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("");

  const reopened = await openPhoneSettingsIndex(page, "Runtime");
  await reopened.dialog
    .getByRole("link", { name: "Data", exact: true })
    .click();
  await expect(page).toHaveURL(/\/forge\/settings\/data$/);
  await expect(
    page.getByRole("button", { name: "Settings section Data Browse" })
  ).toBeFocused();
  await expectNoHorizontalOverflow(page);
});

test("the index remains usable at the 200-percent-equivalent layout width", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop zoom coverage");

  // A 1280 CSS-pixel desktop reduced to 640 CSS pixels exercises the same
  // reflow width that a person receives at 200% browser zoom.
  await page.setViewportSize({ width: 640, height: 720 });
  await page.goto("settings");
  await waitForForge(page);
  await expectNoHorizontalOverflow(page);

  const { dialog } = await openPhoneSettingsIndex(page, "Runtime");
  await expect(dialog.getByRole("link")).toHaveCount(SETTINGS_INDEX.length);
  await expect(
    dialog.getByRole("link", { name: "Bin", exact: true })
  ).toHaveAccessibleDescription(
    "Soft-deleted records available for deliberate recovery."
  );

  const requiredControls = [
    dialog.getByRole("button", { name: "Close settings sections" }),
    dialog.getByRole("link", { name: "Runtime", exact: true }),
    dialog.getByRole("link", { name: "Bin", exact: true })
  ];
  for (const control of requiredControls) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
});
