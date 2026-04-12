import { describe, expect, it } from "vitest";
import {
  resolveKnowledgeGraphFocusInteraction,
  resolveKnowledgeGraphOverlaySyncAction
} from "@/pages/knowledge-graph-page-model";

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

  it("clears focus and closes the mobile sheet when the selection is cleared", () => {
    expect(
      resolveKnowledgeGraphFocusInteraction({
        isMobile: true,
        currentFocusNodeId: "goal:goal-1",
        mobileSheetOpen: true,
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
