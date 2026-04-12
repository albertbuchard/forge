import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  getEntityKindForCrudEntityType,
  getEntityKindForWorkbenchFlowKind,
  getEntityVisual,
  isEntityKind
} from "@/lib/entity-visuals";

describe("entity visuals", () => {
  it("defines a stable visual entry for every supported entity kind", () => {
    expect(ENTITY_KINDS).toEqual([
      "goal",
      "project",
      "task",
      "strategy",
      "habit",
      "tag",
      "note",
      "wiki_page",
      "wiki_space",
      "insight",
      "calendar_event",
      "work_block",
      "timebox",
      "value",
      "pattern",
      "behavior",
      "belief",
      "mode",
      "mode_session",
      "report",
      "event_type",
      "emotion",
      "workbench",
      "functor",
      "chat"
    ]);

    for (const kind of ENTITY_KINDS) {
      const visual = getEntityVisual(kind);
      expect(visual.kind).toBe(kind);
      expect(visual.label.length).toBeGreaterThan(0);
      expect(visual.iconName.length).toBeGreaterThan(0);
      expect(visual.colorToken.cssVariable).toContain("--forge-entity-");
      expect(visual.colorToken.hex).toMatch(/^#[0-9a-f]{6}$/);
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

  it("maps CRUD entity types to identity kinds through one central helper", () => {
    expect(getEntityKindForCrudEntityType("goal")).toBe("goal");
    expect(getEntityKindForCrudEntityType("tag")).toBe("tag");
    expect(getEntityKindForCrudEntityType("insight")).toBe("insight");
    expect(getEntityKindForCrudEntityType("work_block_template")).toBe(
      "work_block"
    );
    expect(getEntityKindForCrudEntityType("task_timebox")).toBe("timebox");
    expect(getEntityKindForCrudEntityType("mode_guide_session")).toBe(
      "mode_session"
    );
    expect(getEntityKindForCrudEntityType("emotion_definition")).toBe(
      "emotion"
    );
    expect(getEntityKindForCrudEntityType("note", { noteKind: "wiki" })).toBe(
      "wiki_page"
    );
    expect(getEntityKindForCrudEntityType("note", { noteKind: "evidence" })).toBe(
      "note"
    );
  });

  it("maps workbench flow kinds to dedicated entity identities", () => {
    expect(getEntityKindForWorkbenchFlowKind("functor")).toBe("functor");
    expect(getEntityKindForWorkbenchFlowKind("chat")).toBe("chat");
  });
});
