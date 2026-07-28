import { expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import path from "node:path";

type E2eBrowserAuthority = {
  sessionToken: string;
  csrfToken: string;
};

type E2eBrowserAuthorityPool = {
  runId: string;
  authorities: E2eBrowserAuthority[];
};

const selectedAuthorities = new WeakMap<Page, E2eBrowserAuthority>();

async function readE2eBrowserAuthorities(): Promise<E2eBrowserAuthorityPool | null> {
  const dataRoot = process.env.FORGE_E2E_DATA_ROOT?.trim();
  if (!dataRoot) {
    return null;
  }
  const authority = JSON.parse(
    await readFile(
      path.join(dataRoot, ".forge-e2e-browser-authority.json"),
      "utf8"
    )
  ) as {
    schema?: unknown;
    runId?: unknown;
    authorities?: unknown;
  };
  if (
    authority.schema !== "forge-e2e-browser-authority/1" ||
    typeof authority.runId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(authority.runId) ||
    !Array.isArray(authority.authorities) ||
    authority.authorities.length < 1 ||
    !authority.authorities.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { sessionToken?: unknown }).sessionToken ===
          "string" &&
        typeof (entry as { csrfToken?: unknown }).csrfToken === "string"
    )
  ) {
    throw new Error("The isolated E2E browser authority is malformed.");
  }
  return {
    runId: authority.runId,
    authorities: authority.authorities as E2eBrowserAuthority[]
  };
}

async function claimE2eBrowserAuthority(testId: string) {
  const dataRoot = process.env.FORGE_E2E_DATA_ROOT?.trim();
  const pool = await readE2eBrowserAuthorities();
  if (!dataRoot || !pool) {
    throw new Error("The isolated E2E browser authority is unavailable.");
  }
  const start =
    createHash("sha256").update(testId).digest().readUInt32BE(0) %
    pool.authorities.length;
  for (let offset = 0; offset < pool.authorities.length; offset += 1) {
    const index = (start + offset) % pool.authorities.length;
    const claimPath = path.join(
      dataRoot,
      `.forge-e2e-authority-claim-${pool.runId}-${index}`
    );
    try {
      const claim = await open(claimPath, "wx", 0o600);
      try {
        await claim.writeFile(`${process.pid}\n`, "utf8");
      } finally {
        await claim.close();
      }
      return pool.authorities[index]!;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }
  throw new Error("The isolated E2E browser authority pool is exhausted.");
}

export async function e2eMutationHeaders(page: Page) {
  const authority = selectedAuthorities.get(page);
  if (!authority) {
    throw new Error(
      "Unsafe E2E requests require this page's isolated browser authority."
    );
  }
  return {
    "x-forge-csrf": authority.csrfToken,
    "x-forge-source": "ui"
  };
}

export async function installE2eStorageGuards(
  page: Page,
  testId: string
) {
  const dataRoot = process.env.FORGE_E2E_DATA_ROOT?.trim();
  const configuredPort = Number.parseInt(
    process.env.FORGE_E2E_PORT ?? "",
    10
  );
  let csrfToken: string | null = null;
  if (dataRoot) {
    const authority = await claimE2eBrowserAuthority(testId);
    selectedAuthorities.set(page, authority);
    csrfToken = authority.csrfToken;
    await page.context().addCookies([
      {
        name: "forge_session",
        value: authority.sessionToken,
        url: `http://127.0.0.1:${
          Number.isInteger(configuredPort) && configuredPort > 0
            ? configuredPort
            : 4317
        }`,
        httpOnly: true,
        sameSite: "Strict"
      }
    ]);
  }
  const expectedOrigin =
    dataRoot && Number.isInteger(configuredPort) && configuredPort > 0
      ? `http://127.0.0.1:${configuredPort}`
      : null;
  await page.addInitScript(
    ({ origin, token }) => {
      if (!origin || window.location.origin !== origin) {
        return;
      }
      window.localStorage.setItem(
        "forge-gamification-assets-setup-dismissed-v1",
        "1"
      );
      if (token) {
        window.localStorage.setItem("forge.browser.csrf", token);
      }
    },
    { origin: expectedOrigin, token: csrfToken }
  );
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
