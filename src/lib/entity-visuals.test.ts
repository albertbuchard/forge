import { describe, expect, it } from "vitest";
import { ENTITY_KINDS, getEntityVisual, isEntityKind } from "@/lib/entity-visuals";

describe("entity visuals", () => {
  it("defines a stable visual entry for every supported entity kind", () => {
    expect(ENTITY_KINDS).toEqual(["goal", "project", "task", "habit", "value", "pattern", "behavior", "belief", "mode", "report"]);

    for (const kind of ENTITY_KINDS) {
      const visual = getEntityVisual(kind);
      expect(visual.kind).toBe(kind);
      expect(visual.label.length).toBeGreaterThan(0);
      expect(visual.badgeClassName).toContain("border-");
      expect(visual.subtleBadgeClassName).toContain("border-");
      expect(visual.buttonClassName).toContain("hover:");
      expect(visual.icon).toBeTruthy();
    }
  });

  it("recognizes entity kinds without treating arbitrary metadata labels as entity types", () => {
    expect(isEntityKind("goal")).toBe(true);
    expect(isEntityKind("report")).toBe(true);
    expect(isEntityKind("stable")).toBe(false);
    expect(isEntityKind("schema")).toBe(false);
  });
});
