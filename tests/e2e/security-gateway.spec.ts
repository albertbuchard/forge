import { expect, test } from "@playwright/test";

const protectedPaths = [
  "/api/v1/settings",
  "/api/v1/events/stream",
  "/api/v1/ai/processors"
] as const;

test("network reachability and spoofed transport identity never grant API access", async ({
  request
}) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);

  for (const path of protectedPaths) {
    const anonymous = await request.get(path);
    expect(anonymous.status(), path).toBe(401);

    const spoofedTransportIdentity = await request.get(path, {
      headers: {
        "Tailscale-User-Login": "owner@example.invalid",
        "Tailscale-User-Name": "Forge Owner",
        "X-Forwarded-For": "127.0.0.1",
        "X-Forge-Local": "true"
      }
    });
    expect(
      [401, 426],
      `${path}: spoofed transport identity must be denied before route data`
    ).toContain(spoofedTransportIdentity.status());
  }
});

test("the public web shell does not create an ambient authenticated session", async ({
  page,
  request
}) => {
  await page.goto("./");
  await expect(page.locator("#root")).toBeVisible();

  const settings = await request.get("/api/v1/settings");
  expect(settings.status()).toBe(401);
  expect(settings.headers()["set-cookie"]).toBeUndefined();
});
