import { describe, expect, it } from "vitest";
import { resolveKnowledgeGraphFocusInteraction } from "@/pages/knowledge-graph-page-model";

describe("resolveKnowledgeGraphFocusInteraction", () => {
  it("opens the desktop overlay on the first node selection", () => {
    expect(
      resolveKnowledgeGraphFocusInteraction({
        isMobile: false,
        currentFocusNodeId: null,
        mobileSheetOpen: false,
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
        mobileSheetOpen: false,
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
        mobileSheetOpen: false,
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
        mobileSheetOpen: true,
        nextNodeId: "project:project-1"
      })
    ).toEqual({
      nextFocusNodeId: "project:project-1",
      nextMobileSheetOpen: false,
      shouldUpdateFocus: true
    });
  });
});
