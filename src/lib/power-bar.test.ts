import { describe, expect, it } from "vitest";
import {
  buildPowerBarHref,
  inferPowerBarDetail,
  inferPowerBarTitle,
  powerBarEntityTypeLabel,
  powerBarEntityTypeToKind,
  scorePowerBarMatch
} from "@/lib/power-bar";

describe("power bar helpers", () => {
  it("maps searchable Forge entity types onto themed kinds when available", () => {
    expect(powerBarEntityTypeToKind("goal")).toBe("goal");
    expect(powerBarEntityTypeToKind("habit")).toBe("habit");
    expect(powerBarEntityTypeToKind("psyche_value")).toBe("value");
    expect(powerBarEntityTypeToKind("behavior_pattern")).toBe("pattern");
    expect(powerBarEntityTypeToKind("behavior")).toBe("behavior");
    expect(powerBarEntityTypeToKind("belief_entry")).toBe("belief");
    expect(powerBarEntityTypeToKind("mode_profile")).toBe("mode");
    expect(powerBarEntityTypeToKind("trigger_report")).toBe("report");
    expect(powerBarEntityTypeToKind("calendar_event")).toBeNull();
  });

  it("builds focused routes for entity results", () => {
    expect(
      buildPowerBarHref("habit", "habit-1", { id: "habit-1" })
    ).toBe("/habits?focus=habit-1");
    expect(
      buildPowerBarHref("psyche_value", "value-1", { id: "value-1" })
    ).toBe("/psyche/values?focus=value-1");
    expect(
      buildPowerBarHref("trigger_report", "report-1", { id: "report-1" })
    ).toBe("/psyche/reports/report-1");
    expect(
      buildPowerBarHref("note", "note-1", {
        id: "note-1",
        kind: "wiki",
        slug: "focus-page"
      })
    ).toBe("/wiki/page/focus-page");
    expect(
      buildPowerBarHref("note", "note-2", {
        id: "note-2",
        kind: "evidence",
        slug: "ignored"
      })
    ).toBe("/notes");
  });

  it("infers readable titles and details from varied entity shapes", () => {
    expect(
      inferPowerBarTitle("belief_entry", {
        id: "belief-1",
        statement: "I need to ship every day"
      })
    ).toBe("I need to ship every day");

    expect(
      inferPowerBarDetail("project", {
        id: "project-1",
        summary: "Tighten the Forge command surface.",
        user: {
          id: "user_operator",
          kind: "human",
          displayName: "Operator",
          handle: "operator"
        }
      })
    ).toContain("Operator");

    expect(
      powerBarEntityTypeLabel("note", {
        kind: "wiki"
      })
    ).toBe("Wiki page");
  });

  it("scores closer title matches higher than loose matches", () => {
    const exact = scorePowerBarMatch(
      "forge",
      "Forge",
      "forge control surface"
    );
    const loose = scorePowerBarMatch(
      "forge",
      "Calendar",
      "weekly forge planning"
    );

    expect(exact).toBeGreaterThan(loose);
  });
});
