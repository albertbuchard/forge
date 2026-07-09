import { describe, expect, it } from "vitest";
import { breakpointFromWidth, scaleWidgetSpan } from "@/lib/surface-layout";

describe("surface layout breakpoints", () => {
  it("maps measured container widths to stable grid column counts", () => {
    expect(breakpointFromWidth(1400)).toBe("lg");
    expect(breakpointFromWidth(1100)).toBe("md");
    expect(breakpointFromWidth(900)).toBe("sm");
    expect(breakpointFromWidth(600)).toBe("xs");
    expect(breakpointFromWidth(390)).toBe("xxs");
  });

  it("scales default and minimum spans proportionally on tablet layouts", () => {
    expect(
      scaleWidgetSpan({ id: "runway", defaultWidth: 8, minWidth: 5 }, "sm")
    ).toBe(4);
    expect(
      scaleWidgetSpan({ id: "capacity", defaultWidth: 4, minWidth: 4 }, "sm")
    ).toBe(2);
  });

  it("keeps substantial widgets full width on narrow mobile layouts", () => {
    const widget = { id: "runway", defaultWidth: 8, minWidth: 4 };

    expect(scaleWidgetSpan(widget, "xs")).toBe(4);
    expect(scaleWidgetSpan(widget, "xxs")).toBe(2);
  });

  it("still lets small utility widgets share a mobile row", () => {
    expect(scaleWidgetSpan({ id: "clock", defaultWidth: 3 }, "xs")).toBe(1);
    expect(scaleWidgetSpan({ id: "clock", defaultWidth: 3 }, "xxs")).toBe(1);
  });

  it("preserves the authored twelve-column span on large layouts", () => {
    expect(
      scaleWidgetSpan(
        { id: "runway", defaultWidth: 8, minWidth: 5, maxWidth: 9 },
        "lg"
      )
    ).toBe(8);
  });
});
