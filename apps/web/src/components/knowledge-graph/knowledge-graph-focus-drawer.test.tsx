import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeGraphFocusDrawer } from "@/components/knowledge-graph/knowledge-graph-focus-drawer";
import type { KnowledgeGraphFocusPayload } from "@/lib/knowledge-graph-types";

const focusFixture: KnowledgeGraphFocusPayload = {
  generatedAt: "2026-04-12T12:00:00.000Z",
  focusNode: {
    id: "goal:goal-1",
    entityType: "goal",
    entityId: "goal-1",
    entityKind: "goal",
    title: "North Star",
    subtitle: "Top goal",
    description: "Primary direction",
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
};

describe("KnowledgeGraphFocusDrawer", () => {
  it("uses a shell-side scroll region instead of nesting full paper cards", () => {
    const onClose = vi.fn();
    const { container } = render(
      <KnowledgeGraphFocusDrawer
        focus={focusFixture}
        onOpenPage={vi.fn()}
        onOpenNotes={vi.fn()}
        onOpenHierarchy={vi.fn()}
        onSelectNode={vi.fn()}
        onClose={onClose}
      />
    );

    expect(screen.getByText("Focus Node")).toBeInTheDocument();
    const drawerRoot = container.firstElementChild as HTMLElement | null;
    expect(drawerRoot).toBeTruthy();
    expect(drawerRoot?.className).toContain("overflow-hidden");
    const scrollRegion = drawerRoot?.querySelector(".overflow-y-auto");
    expect(scrollRegion).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
