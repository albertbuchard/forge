import { describe, expect, it } from "vitest";
import { isShellRouteReady } from "@/features/shell/route-readiness";

describe("isShellRouteReady", () => {
  it("blocks every route until shell bootstrap data is ready", () => {
    expect(
      isShellRouteReady("/overview", {
        bootstrapReady: false,
        sleepReady: true
      })
    ).toBe(false);
  });

  it("requires the sleep payload on sleep routes", () => {
    expect(
      isShellRouteReady("/sleep", {
        bootstrapReady: true,
        sleepReady: false
      })
    ).toBe(false);
    expect(
      isShellRouteReady("/sleep/night-1", {
        bootstrapReady: true,
        sleepReady: true
      })
    ).toBe(true);
  });

  it("allows non-sleep routes once bootstrap data is ready", () => {
    expect(
      isShellRouteReady("/projects", {
        bootstrapReady: true,
        sleepReady: false
      })
    ).toBe(true);
  });
});
