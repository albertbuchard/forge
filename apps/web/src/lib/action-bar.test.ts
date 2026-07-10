import { describe, expect, it } from "vitest";
import {
  ACTION_BAR_FILTER_TOKENS,
  type ActionBarCreateActionCandidate,
  type ActionBarFilterId,
  buildActionBarCreateActionMatches,
  buildActionBarHref,
  createActionMatchesActionBarFilters,
  entityMatchesActionBarFilters,
  getActionBarEntityTypesForFilters,
  inferActionBarDetail,
  inferActionBarTitle,
  actionBarEntityTypeLabel,
  actionBarEntityTypeToKind,
  resolveEntityNavigationTargetFromLocation,
  scoreActionBarMatch
} from "@/lib/action-bar";

describe("action bar helpers", () => {
  it("maps searchable Forge entity types onto themed kinds when available", () => {
    expect(actionBarEntityTypeToKind("goal")).toBe("goal");
    expect(actionBarEntityTypeToKind("habit")).toBe("habit");
    expect(actionBarEntityTypeToKind("psyche_value")).toBe("value");
    expect(actionBarEntityTypeToKind("behavior_pattern")).toBe("pattern");
    expect(actionBarEntityTypeToKind("behavior")).toBe("behavior");
    expect(actionBarEntityTypeToKind("belief_entry")).toBe("belief");
    expect(actionBarEntityTypeToKind("mode_profile")).toBe("mode");
    expect(actionBarEntityTypeToKind("flashcard")).toBe("flashcard");
    expect(actionBarEntityTypeToKind("trigger_report")).toBe("report");
    expect(actionBarEntityTypeToKind("calendar_event")).toBe("calendar_event");
    expect(actionBarEntityTypeToKind("work_block_template")).toBe("work_block");
    expect(actionBarEntityTypeToKind("task_timebox")).toBe("timebox");
    expect(actionBarEntityTypeToKind("note", { kind: "wiki" })).toBe(
      "wiki_page"
    );
    expect(actionBarEntityTypeToKind("note", { kind: "evidence" })).toBe(
      "note"
    );
  });

  it("builds focused routes for entity results", () => {
    expect(buildActionBarHref("habit", "habit-1", { id: "habit-1" })).toBe(
      "/habits?focus=habit-1"
    );
    expect(
      buildActionBarHref("psyche_value", "value-1", { id: "value-1" })
    ).toBe("/psyche/values?focus=value-1");
    expect(buildActionBarHref("flashcard", "card-1", { id: "card-1" })).toBe(
      "/psyche/flashcards?focus=card-1"
    );
    expect(
      buildActionBarHref("trigger_report", "report-1", { id: "report-1" })
    ).toBe("/psyche/reports/report-1");
    expect(
      buildActionBarHref("task_timebox", "timebox-1", { id: "timebox-1" })
    ).toBe("/calendar?focus=timebox-1&focusType=task_timebox");
    expect(
      buildActionBarHref("note", "note-1", {
        id: "note-1",
        kind: "wiki",
        slug: "focus-page"
      })
    ).toBe("/wiki/page/focus-page");
    expect(
      buildActionBarHref("note", "note-2", {
        id: "note-2",
        kind: "evidence",
        slug: "ignored"
      })
    ).toBe("/notes?focus=note-2");
    expect(buildActionBarHref("insight", "insight-1", {})).toBe(
      "/knowledge-graph?focus=insight%3Ainsight-1"
    );
  });

  it("resolves canonical navigation targets from detail and focus routes", () => {
    expect(
      resolveEntityNavigationTargetFromLocation("/projects/project%20one", "")
    ).toEqual({ entityType: "project", entityId: "project one" });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/psyche/flashcards",
        "?focus=card-1"
      )
    ).toEqual({ entityType: "flashcard", entityId: "card-1" });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/calendar",
        "?focus=timebox-1&focusType=task_timebox"
      )
    ).toEqual({ entityType: "task_timebox", entityId: "timebox-1" });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/calendar",
        "?focus=event-1&focusType=unknown"
      )
    ).toEqual({ entityType: "calendar_event", entityId: "event-1" });
    expect(
      resolveEntityNavigationTargetFromLocation("/artifacts/artifact%20one", "")
    ).toEqual({ entityType: "artifact", entityId: "artifact one" });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/psyche/questionnaires/instrument-1",
        ""
      )
    ).toEqual({
      entityType: "questionnaire_instrument",
      entityId: "instrument-1"
    });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/sports/workouts/workout-1",
        ""
      )
    ).toEqual({ entityType: "workout_session", entityId: "workout-1" });
    expect(
      resolveEntityNavigationTargetFromLocation("/sleep", "?focus=sleep-1")
    ).toEqual({ entityType: "sleep_session", entityId: "sleep-1" });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/life-events",
        "?focus=life-event-1"
      )
    ).toEqual({ entityType: "life_event", entityId: "life-event-1" });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/psyche/modes/guide",
        "?focus=guide-1"
      )
    ).toEqual({ entityType: "mode_guide_session", entityId: "guide-1" });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/preferences",
        "?tab=table&focusItem=preference-1"
      )
    ).toEqual({ entityType: "preference_item", entityId: "preference-1" });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/preferences",
        "?tab=concepts&focusCatalog=catalog-1"
      )
    ).toEqual({ entityType: "preference_catalog", entityId: "catalog-1" });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/preferences",
        "?tab=concepts&focusCatalogItem=catalog-item-1"
      )
    ).toEqual({
      entityType: "preference_catalog_item",
      entityId: "catalog-item-1"
    });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/preferences",
        "?tab=contexts&focusContext=context-1"
      )
    ).toEqual({ entityType: "preference_context", entityId: "context-1" });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/knowledge-graph",
        "?focus=tag%3Atag-1"
      )
    ).toEqual({ entityType: "tag", entityId: "tag-1" });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/knowledge-graph",
        "?focus=event_type%3Aevent-type-1"
      )
    ).toEqual({ entityType: "event_type", entityId: "event-type-1" });
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/knowledge-graph",
        "?focus=goal%3Agoal-1"
      )
    ).toBeNull();
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/psyche/questionnaires/new",
        ""
      )
    ).toBeNull();
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/health/sleep",
        "?focus=sleep-1"
      )
    ).toBeNull();
    expect(
      resolveEntityNavigationTargetFromLocation(
        "/health/sports",
        "?focus=workout-1"
      )
    ).toBeNull();
    expect(
      resolveEntityNavigationTargetFromLocation("/tasks/%E0%A4%A", "")
    ).toBeNull();
    expect(
      resolveEntityNavigationTargetFromLocation("/overview", "")
    ).toBeNull();
  });

  it("infers readable titles and details from varied entity shapes", () => {
    expect(
      inferActionBarTitle("belief_entry", {
        id: "belief-1",
        statement: "I need to ship every day"
      })
    ).toBe("I need to ship every day");

    expect(
      inferActionBarDetail("project", {
        id: "project-1",
        summary: "Tighten the Forge action surface.",
        user: {
          id: "user_operator",
          kind: "human",
          displayName: "Operator",
          handle: "operator"
        }
      })
    ).toContain("Operator");

    expect(
      inferActionBarTitle("flashcard", {
        id: "card-1",
        message: "Ride the urge for ten minutes."
      })
    ).toBe("Ride the urge for ten minutes.");

    expect(
      actionBarEntityTypeLabel("note", {
        kind: "wiki"
      })
    ).toBe("Wiki page");
  });

  it("maps the wiki page badge to note search while preserving client-side kind filtering", () => {
    const wikiFilter = ACTION_BAR_FILTER_TOKENS.find(
      (filter) => filter.id === "wiki_page"
    );
    const noteFilter = ACTION_BAR_FILTER_TOKENS.find(
      (filter) => filter.id === "note"
    );

    expect(wikiFilter?.entityTypes).toEqual(["note"]);
    expect(getActionBarEntityTypesForFilters([wikiFilter!])).toEqual(["note"]);
    expect(
      entityMatchesActionBarFilters("note", { kind: "wiki" }, [wikiFilter!])
    ).toBe(true);
    expect(
      entityMatchesActionBarFilters("note", { kind: "evidence" }, [wikiFilter!])
    ).toBe(false);
    expect(
      entityMatchesActionBarFilters("note", { kind: "wiki" }, [noteFilter!])
    ).toBe(false);
    expect(
      entityMatchesActionBarFilters("note", { kind: "evidence" }, [noteFilter!])
    ).toBe(true);
  });

  it("synthesizes create quick actions from create or new intents", () => {
    const actions: ActionBarCreateActionCandidate[] = [
      {
        id: "habit",
        title: "Habit",
        quickActionTitle: "Create habit",
        description: "Track a recurring commitment.",
        aliases: ["habit", "routine"],
        filterIds: ["habit"]
      },
      {
        id: "trigger_report",
        title: "Report",
        quickActionTitle: "Create report",
        description: "Start a reflective chain.",
        aliases: ["report"],
        filterIds: ["trigger_report"]
      },
      {
        id: "wiki_page",
        title: "Wiki page",
        quickActionTitle: "Create wiki page",
        description: "Open a new knowledge page.",
        aliases: ["wiki", "page"],
        filterIds: ["wiki_page"]
      }
    ];

    expect(
      buildActionBarCreateActionMatches("create habit", actions)[0]?.id
    ).toBe("habit");
    expect(
      buildActionBarCreateActionMatches("new report", actions)[0]?.id
    ).toBe("trigger_report");
    expect(
      buildActionBarCreateActionMatches("create wiki page", actions)[0]?.id
    ).toBe("wiki_page");
  });

  it("applies OR semantics within the entity-type filter family for quick actions", () => {
    const habitAction = {
      filterIds: ["habit"] as ActionBarFilterId[]
    } satisfies Pick<ActionBarCreateActionCandidate, "filterIds">;
    const reportAction = {
      filterIds: ["trigger_report"] as ActionBarFilterId[]
    } satisfies Pick<ActionBarCreateActionCandidate, "filterIds">;
    const selectedFilters = ACTION_BAR_FILTER_TOKENS.filter(
      (filter) => filter.id === "habit" || filter.id === "trigger_report"
    );

    expect(
      createActionMatchesActionBarFilters(habitAction, selectedFilters)
    ).toBe(true);
    expect(
      createActionMatchesActionBarFilters(reportAction, selectedFilters)
    ).toBe(true);
  });

  it("scores closer title matches higher than loose matches", () => {
    const exact = scoreActionBarMatch(
      "forge",
      "Forge",
      "forge control surface"
    );
    const loose = scoreActionBarMatch(
      "forge",
      "Calendar",
      "weekly forge planning"
    );

    expect(exact).toBeGreaterThan(loose);
  });
});
