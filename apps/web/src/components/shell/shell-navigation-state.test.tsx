import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useShellNavigationState } from "@/components/shell/shell-navigation";

beforeEach(() => {
  window.localStorage.clear();
});

describe("useShellNavigationState migrations", () => {
  it("places Attention after Overview for existing desktop and mobile layouts", () => {
    window.localStorage.setItem(
      "forge.desktop-nav-layout",
      JSON.stringify(["overview", "today"])
    );
    window.localStorage.setItem(
      "forge.mobile-nav-layout",
      JSON.stringify(["overview", "today"])
    );

    const { result } = renderHook(() => useShellNavigationState("/overview"));

    expect(result.current.desktopNavIds.slice(0, 3)).toEqual([
      "overview",
      "attention",
      "today"
    ]);
    expect(result.current.mobileNavIds.slice(0, 3)).toEqual([
      "overview",
      "attention",
      "today"
    ]);
  });

  it("does not re-add Attention after the one-time migration is complete", () => {
    window.localStorage.setItem(
      "forge.desktop-nav-layout",
      JSON.stringify(["overview", "today"])
    );
    window.localStorage.setItem(
      "forge.nav-layout-migrations",
      JSON.stringify({
        "desktop-knowledge-graph-default-v1": true,
        "desktop-courses-default-v1": true,
        "desktop-attention-default-v1": true
      })
    );

    const { result } = renderHook(() => useShellNavigationState("/overview"));
    expect(result.current.desktopNavIds).toEqual(["overview", "today"]);

    act(() => result.current.setDesktopNavIds(["today", "overview"]));
    expect(result.current.desktopNavIds).toEqual(["today", "overview"]);
  });
});
