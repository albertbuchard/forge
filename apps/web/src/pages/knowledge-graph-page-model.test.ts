import { describe, expect, it } from "vitest";
import {
  MAX_KNOWLEDGE_GRAPH_MAX_NODES,
  buildKnowledgeGraphQueryFromPageState,
  buildKnowledgeGraphQuickFilterSelectionIds,
  parseKnowledgeGraphPageState,
  parseKnowledgeGraphQuickFilterSelectionIds,
  resolveKnowledgeGraphFocusInteraction,
  resolveKnowledgeGraphOverlaySyncAction
} from "@/pages/knowledge-graph-page-model";

describe("resolveKnowledgeGraphFocusInteraction", () => {
  it("opens the desktop overlay on the first node selection", () => {
    expect(
      resolveKnowledgeGraphFocusInteraction({
        isMobile: false,
        currentFocusNodeId: null,
        nextNodeId: "goal:goal-1"
      })
    ).toEqual({
      nextFocusNodeId: "goal:goal-1",
      nextMobileSheetOpen: false,
      shouldUpdateFocus: true
    });
  });

  it("requires two taps on the same node before opening the mobile sheet", () => {
    expect(
      resolveKnowledgeGraphFocusInteraction({
        isMobile: true,
        currentFocusNodeId: null,
        nextNodeId: "goal:goal-1"
      })
    ).toEqual({
      nextFocusNodeId: "goal:goal-1",
      nextMobileSheetOpen: false,
      shouldUpdateFocus: true
    });

    expect(
      resolveKnowledgeGraphFocusInteraction({
        isMobile: true,
        currentFocusNodeId: "goal:goal-1",
        nextNodeId: "goal:goal-1"
      })
    ).toEqual({
      nextFocusNodeId: "goal:goal-1",
      nextMobileSheetOpen: true,
      shouldUpdateFocus: false
    });
  });

  it("retargets mobile focus without opening the sheet when a different node is tapped", () => {
    expect(
      resolveKnowledgeGraphFocusInteraction({
        isMobile: true,
        currentFocusNodeId: "goal:goal-1",
        nextNodeId: "project:project-1"
      })
    ).toEqual({
      nextFocusNodeId: "project:project-1",
      nextMobileSheetOpen: false,
      shouldUpdateFocus: true
    });
  });

  it("clears focus and closes the mobile sheet when the selection is cleared", () => {
    expect(
      resolveKnowledgeGraphFocusInteraction({
        isMobile: true,
        currentFocusNodeId: "goal:goal-1",
        nextNodeId: null
      })
    ).toEqual({
      nextFocusNodeId: null,
      nextMobileSheetOpen: false,
      shouldUpdateFocus: true
    });
  });
});

describe("resolveKnowledgeGraphOverlaySyncAction", () => {
  it("requests a set when desktop focus changes to a new node", () => {
    expect(
      resolveKnowledgeGraphOverlaySyncAction({
        isMobile: false,
        focusNodeId: "goal:goal-1",
        shellOverlayFocusNodeId: null,
        lastRequestedKey: null
      })
    ).toEqual({
      action: "set",
      nextRequestedKey: "goal:goal-1"
    });
  });

  it("does not repeat the same set request while the store catches up", () => {
    expect(
      resolveKnowledgeGraphOverlaySyncAction({
        isMobile: false,
        focusNodeId: "goal:goal-1",
        shellOverlayFocusNodeId: null,
        lastRequestedKey: "goal:goal-1"
      })
    ).toEqual({
      action: "none",
      nextRequestedKey: "goal:goal-1"
    });
  });

  it("requests a clear only once when desktop focus is removed", () => {
    expect(
      resolveKnowledgeGraphOverlaySyncAction({
        isMobile: false,
        focusNodeId: null,
        shellOverlayFocusNodeId: "goal:goal-1",
        lastRequestedKey: null
      })
    ).toEqual({
      action: "clear",
      nextRequestedKey: "__clear__"
    });

    expect(
      resolveKnowledgeGraphOverlaySyncAction({
        isMobile: false,
        focusNodeId: null,
        shellOverlayFocusNodeId: "goal:goal-1",
        lastRequestedKey: "__clear__"
      })
    ).toEqual({
      action: "none",
      nextRequestedKey: "__clear__"
    });
  });

  it("suppresses shell overlay sync on mobile", () => {
    expect(
      resolveKnowledgeGraphOverlaySyncAction({
        isMobile: true,
        focusNodeId: "goal:goal-1",
        shellOverlayFocusNodeId: null,
        lastRequestedKey: null
      })
    ).toEqual({
      action: "none",
      nextRequestedKey: "__clear__"
    });
  });
});

describe("knowledge graph URL and query model", () => {
  it("parses search params into bounded page state", () => {
    const state = parseKnowledgeGraphPageState(
      [
        "view=hierarchy",
        "focus=goal%3Agoal-1",
        "entityKind=goal,project",
        "entityKind=task",
        "relationKind=goal_project",
        "tag=urgent",
        "owner=user-1",
        "q=roadmap",
        "updatedFrom=2026-01-01",
        "updatedTo=2026-02-01",
        "limit=99999",
        "cross=1"
      ].join("&")
    );

    expect(state).toMatchObject({
      selectedView: "hierarchy",
      focusNodeId: "goal:goal-1",
      selectedKinds: ["goal", "project", "task"],
      selectedRelations: ["goal_project"],
      selectedTags: ["urgent"],
      selectedOwners: ["user-1"],
      queryText: "roadmap",
      updatedFrom: "2026-01-01",
      updatedTo: "2026-02-01",
      showHierarchyCrossLinks: true,
      maxNodes: MAX_KNOWLEDGE_GRAPH_MAX_NODES
    });
  });

  it("builds a stable API query from parsed page state", () => {
    const state = parseKnowledgeGraphPageState(
      "q=  graph  &focus=tag%3Atag-vitality&entityKind=task&entityKind=goal&tag=b&tag=a&owner=user-2&relationKind=task_note"
    );

    expect(buildKnowledgeGraphQueryFromPageState(state)).toEqual({
      q: "graph",
      entityKinds: ["goal", "task"],
      relationKinds: ["task_note"],
      tags: ["a", "b"],
      owners: ["user-2"],
      updatedFrom: null,
      updatedTo: null,
      limit: 2000,
      focusNodeId: "tag:tag-vitality"
    });
  });

  it("round-trips quick filter ids by facet family", () => {
    const selectedIds = buildKnowledgeGraphQuickFilterSelectionIds({
      entityKinds: ["goal"],
      relationKinds: ["goal_project"],
      tags: ["deep:work"],
      owners: ["user-1"]
    });

    expect(selectedIds).toEqual([
      "entity:goal",
      "relation:goal_project",
      "tag:deep:work",
      "owner:user-1"
    ]);
    expect(parseKnowledgeGraphQuickFilterSelectionIds(selectedIds)).toEqual({
      entityKinds: ["goal"],
      relationKinds: ["goal_project"],
      tags: ["deep:work"],
      owners: ["user-1"]
    });
  });
});
