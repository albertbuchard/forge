import { describe, expect, it } from "vitest";
import {
  clearKnowledgeGraphOverlayFocus,
  setKnowledgeGraphOverlayFocus,
  shellReducer
} from "@/store/slices/shell-slice";

describe("shell slice", () => {
  it("stores and clears the knowledge graph overlay focus payload", () => {
    const focused = shellReducer(
      undefined,
      setKnowledgeGraphOverlayFocus({
        generatedAt: "2026-04-12T12:00:00.000Z",
        focusNode: {
          id: "goal:goal-1",
          entityType: "goal",
          entityId: "goal-1",
          entityKind: "goal",
          title: "North Star",
          subtitle: "",
          description: "",
          href: "/goals/goal-1",
          graphHref: "/knowledge-graph?focus=goal%3Agoal-1",
          iconName: "Target",
          accentToken: "--forge-entity-goal-rgb",
          size: 56,
          importance: 90,
          previewStats: [],
          owner: null,
          tags: [],
          updatedAt: "2026-04-12T10:00:00.000Z",
          graphStats: {
            degree: 1,
            structuralDegree: 1,
            contextualDegree: 0,
            taxonomyDegree: 0,
            workspaceDegree: 0
          }
        },
        firstRingNodes: [],
        neighborhoodEdges: [],
        familyGroups: [],
        relationCounts: {
          structural: 0,
          contextual: 0,
          taxonomy: 0,
          workspace: 0
        },
        secondRingCounts: {
          structural: 0,
          contextual: 0,
          taxonomy: 0,
          workspace: 0
        }
      })
    );

    expect(focused.knowledgeGraphOverlayFocus?.focusNode?.id).toBe("goal:goal-1");

    const cleared = shellReducer(focused, clearKnowledgeGraphOverlayFocus());
    expect(cleared.knowledgeGraphOverlayFocus).toBeNull();
  });
});
