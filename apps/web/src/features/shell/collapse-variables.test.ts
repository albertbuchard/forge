import { describe, expect, it } from "vitest";
import {
  applyShellCollapseVariables,
  resolveExpandedShellMeasurement,
  resolveShellCollapseMaxScrollable,
  resolveShellCollapseProgress
} from "@/features/shell/collapse-variables";

describe("shell collapse motion", () => {
  it("interpolates continuously on mobile and desktop", () => {
    expect(
      resolveShellCollapseProgress({
        scrollTop: 48,
        viewportWidth: 390,
        maxScrollable: 800
      })
    ).toBe(0.5);
    expect(
      resolveShellCollapseProgress({
        scrollTop: 62,
        viewportWidth: 1280,
        maxScrollable: 800
      })
    ).toBe(0.5);
  });

  it("stays expanded on pages that cannot support the full motion", () => {
    expect(
      resolveShellCollapseProgress({
        scrollTop: 30,
        viewportWidth: 390,
        maxScrollable: 70
      })
    ).toBe(0);
  });

  it("keeps desktop progress tied to scroll distance as the header changes height", () => {
    expect(
      resolveShellCollapseProgress({
        scrollTop: 31,
        viewportWidth: 1280,
        maxScrollable: 800
      })
    ).toBe(0.25);
    expect(
      resolveShellCollapseProgress({
        scrollTop: 93,
        viewportWidth: 1280,
        maxScrollable: 800
      })
    ).toBe(0.75);
  });

  it("snaps instead of interpolating when reduced motion is requested", () => {
    expect(
      resolveShellCollapseProgress({
        scrollTop: 47,
        viewportWidth: 390,
        maxScrollable: 800,
        reduceMotion: true
      })
    ).toBe(0);
    expect(
      resolveShellCollapseProgress({
        scrollTop: 48,
        viewportWidth: 390,
        maxScrollable: 800,
        reduceMotion: true
      })
    ).toBe(1);
  });

  it("keeps the collapse threshold stable while the sticky header gets shorter", () => {
    expect(
      resolveShellCollapseMaxScrollable({
        maxScrollable: 106,
        expandedHeaderHeight: 161,
        currentHeaderHeight: 53,
        collapseProgress: 1
      })
    ).toBe(225);
    expect(
      resolveShellCollapseProgress({
        scrollTop: 96,
        viewportWidth: 390,
        maxScrollable: 225
      })
    ).toBe(1);
  });

  it("uses measured content heights for continuous close motion", () => {
    const target = document.createElement("div");
    applyShellCollapseVariables(target, 0.5, {
      desktopSecondaryHeight: 80,
      mobileCopyHeight: 96
    });

    expect(
      target.style.getPropertyValue(
        "--forge-shell-desktop-secondary-max-height"
      )
    ).toBe("40px");
    expect(
      target.style.getPropertyValue("--forge-shell-mobile-copy-max-height")
    ).toBe("48px");
  });

  it("retains the expanded content measurement through close and reopen", () => {
    const collapsedMeasurement = resolveExpandedShellMeasurement({
      previous: 40,
      observed: 22,
      collapseProgress: 1,
      previousCollapseProgress: 0.75
    });
    expect(collapsedMeasurement).toBe(40);
    expect(
      resolveExpandedShellMeasurement({
        previous: collapsedMeasurement,
        observed: 22,
        collapseProgress: 0,
        previousCollapseProgress: 1
      })
    ).toBe(40);
    expect(
      resolveExpandedShellMeasurement({
        previous: 40,
        observed: 32,
        collapseProgress: 0,
        previousCollapseProgress: 0
      })
    ).toBe(32);
  });

  it("restores the authored expanded and collapsed shell variables", () => {
    const target = document.createElement("div");
    applyShellCollapseVariables(target, 0);
    expect(target.dataset.shellCollapseState).toBe("expanded");
    expect(
      target.style.getPropertyValue("--forge-shell-mobile-header-padding-top")
    ).toBe("14px");
    expect(
      target.style.getPropertyValue("--forge-shell-mobile-copy-spacing")
    ).toBe("8px");
    expect(
      target.style.getPropertyValue(
        "--forge-shell-desktop-secondary-max-height"
      )
    ).toBe("176px");

    applyShellCollapseVariables(target, 1);
    expect(target.dataset.shellCollapseState).toBe("collapsed");
    expect(
      target.style.getPropertyValue("--forge-shell-mobile-header-padding-top")
    ).toBe("4px");
    expect(
      target.style.getPropertyValue("--forge-shell-mobile-copy-max-height")
    ).toBe("0px");
    expect(
      target.style.getPropertyValue("--forge-shell-mobile-copy-spacing")
    ).toBe("0px");
    expect(
      target.style.getPropertyValue(
        "--forge-shell-desktop-secondary-max-height"
      )
    ).toBe("0px");
    expect(
      target.style.getPropertyValue("--forge-shell-hero-title-scale")
    ).toBe("0.94");
  });
});
