import { describe, expect, it } from "vitest";
import { resolveAnchoredOverlayStyle } from "@/components/ui/use-anchored-overlay-position";

describe("anchored overlay positioning", () => {
  it("never makes a short-viewport menu taller than the available space", () => {
    const style = resolveAnchoredOverlayStyle({
      anchor: { left: 24, top: 100, bottom: 140, width: 320 },
      viewportWidth: 390,
      viewportHeight: 240,
      offset: 6,
      margin: 12,
      preferredMaxHeight: 320,
      minHeight: 120
    });

    expect(style).toMatchObject({
      position: "fixed",
      left: 24,
      top: 146,
      width: 320,
      maxHeight: 82
    });
    expect(Number(style.top) + Number(style.maxHeight)).toBeLessThanOrEqual(
      228
    );
  });

  it("places the menu above when that side has materially more room", () => {
    const style = resolveAnchoredOverlayStyle({
      anchor: { left: 24, top: 150, bottom: 190, width: 420 },
      viewportWidth: 390,
      viewportHeight: 240,
      offset: 6,
      margin: 12,
      preferredMaxHeight: 320,
      minHeight: 120
    });

    expect(style).toMatchObject({
      left: 12,
      top: 12,
      width: 366,
      maxHeight: 132
    });
  });
});
