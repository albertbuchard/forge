import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGraphHierarchyModel,
  resolveKnowledgeGraphFocusedHierarchyVisibleIds,
  resolveKnowledgeGraphHierarchyVisibleEdges,
  resolveKnowledgeGraphHierarchyVisibleIds,
  toggleKnowledgeGraphHierarchyBranch
} from "@/components/knowledge-graph/knowledge-graph-hierarchy-model";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode
} from "@/lib/knowledge-graph-types";
import { buildPerformanceGraphFixture } from "../../../../../tests/e2e/knowledge-graph-performance-fixture";

const makeNode = (
  id: string,
  entityKind: KnowledgeGraphNode["entityKind"],
  importance: number
): KnowledgeGraphNode => ({
  id,
  entityType:
    entityKind === "goal"
      ? "goal"
      : entityKind === "project"
        ? "project"
        : "task",
  entityId: id,
  entityKind,
  title: id,
  subtitle: "",
  description: "",
  searchText: null,
  href: "/",
  graphHref: "/knowledge-graph",
  iconName: "Circle",
  accentToken: "--primary",
  size: 20,
  importance,
  previewStats: [],
  owner: null,
  tags: [],
  updatedAt: null,
  graphStats: {
    degree: 1,
    structuralDegree: 1,
    contextualDegree: 0,
    taxonomyDegree: 0,
    workspaceDegree: 0
  }
});

const nodes = [
  makeNode("goal:one", "goal", 10),
  makeNode("project:one", "project", 9),
  makeNode("task:one", "task", 8),
  makeNode("goal:two", "goal", 7),
  makeNode("project:two", "project", 6)
];
const edges: KnowledgeGraphEdge[] = [
  {
    id: "goal-project-one",
    source: "goal:one",
    target: "project:one",
    relationKind: "goal_project",
    family: "structural",
    label: "Supports goal",
    strength: 1,
    directional: true,
    structural: true
  },
  {
    id: "project-task-one",
    source: "project:one",
    target: "task:one",
    relationKind: "project_task",
    family: "structural",
    label: "Contains task",
    strength: 1,
    directional: true,
    structural: true
  },
  {
    id: "goal-project-two",
    source: "goal:two",
    target: "project:two",
    relationKind: "goal_project",
    family: "structural",
    label: "Supports goal",
    strength: 1,
    directional: true,
    structural: true
  }
];

describe("knowledge graph hierarchy expansion", () => {
  it("starts with roots only and expands a single branch", () => {
    const model = buildKnowledgeGraphHierarchyModel(nodes, edges);
    expect(
      [
        ...resolveKnowledgeGraphHierarchyVisibleIds({
          model,
          expandedNodeIds: new Set(),
          expandAll: false,
          focusNodeId: null
        })
      ].sort()
    ).toEqual(["goal:one", "goal:two"]);

    const first = toggleKnowledgeGraphHierarchyBranch(
      model,
      new Set(),
      "goal:one"
    );
    expect(
      resolveKnowledgeGraphHierarchyVisibleIds({
        model,
        expandedNodeIds: first,
        expandAll: false,
        focusNodeId: null
      })
    ).toEqual(new Set(["goal:one", "goal:two", "project:one"]));

    const second = toggleKnowledgeGraphHierarchyBranch(
      model,
      first,
      "goal:two"
    );
    expect(second).toEqual(new Set(["goal:two"]));
  });

  it("reveals the complete ancestor path for an externally focused node", () => {
    const model = buildKnowledgeGraphHierarchyModel(nodes, edges);
    expect(
      resolveKnowledgeGraphHierarchyVisibleIds({
        model,
        expandedNodeIds: new Set(),
        expandAll: false,
        focusNodeId: "task:one"
      })
    ).toEqual(new Set(["goal:one", "goal:two", "project:one", "task:one"]));
  });

  it("shows the selected node and every directly linked item, then its connected component", () => {
    const model = buildKnowledgeGraphHierarchyModel(nodes, edges);
    expect(
      resolveKnowledgeGraphFocusedHierarchyVisibleIds({
        model,
        focusNodeId: "goal:one",
        expandAll: false
      })
    ).toEqual(new Set(["goal:one", "project:one"]));

    expect(
      resolveKnowledgeGraphFocusedHierarchyVisibleIds({
        model,
        focusNodeId: "goal:one",
        expandAll: true
      })
    ).toEqual(new Set(["goal:one", "project:one", "task:one"]));
  });

  it("preserves every visible graph edge in the default focused hierarchy", () => {
    const contextualEdge: KnowledgeGraphEdge = {
      id: "task-context-goal",
      source: "task:one",
      target: "goal:two",
      relationKind: "entity_link",
      family: "contextual",
      label: "Related",
      strength: 0.8,
      directional: true,
      structural: false
    };
    const incomingEdge: KnowledgeGraphEdge = {
      id: "goal-two-project-one",
      source: "goal:two",
      target: "project:one",
      relationKind: "goal_project",
      family: "structural",
      label: "Supports goal",
      strength: 1,
      directional: true,
      structural: true
    };
    const model = buildKnowledgeGraphHierarchyModel(nodes, [
      ...edges,
      contextualEdge,
      incomingEdge
    ]);
    const visibleNodeIds = resolveKnowledgeGraphFocusedHierarchyVisibleIds({
      model,
      focusNodeId: "goal:two",
      expandAll: false
    });

    expect(visibleNodeIds).toEqual(
      new Set(["goal:two", "project:two", "task:one", "project:one"])
    );
    expect(
      resolveKnowledgeGraphHierarchyVisibleEdges({
        model,
        visibleNodeIds,
        includeSecondary: true
      }).map((edge) => edge.id)
    ).toEqual([
      "project-task-one",
      "goal-project-two",
      "task-context-goal",
      "goal-two-project-one"
    ]);
  });

  it("does not expose contextual-only nodes when cross-links are explicitly hidden", () => {
    const contextualEdge: KnowledgeGraphEdge = {
      id: "context-only",
      source: "goal:one",
      target: "goal:two",
      relationKind: "entity_link",
      family: "contextual",
      label: "Related",
      strength: 1,
      directional: true,
      structural: false
    };
    const model = buildKnowledgeGraphHierarchyModel(nodes, [contextualEdge]);

    expect(
      resolveKnowledgeGraphFocusedHierarchyVisibleIds({
        model,
        focusNodeId: "goal:one",
        expandAll: false,
        includeSecondary: false
      })
    ).toEqual(new Set(["goal:one"]));
    expect(
      resolveKnowledgeGraphHierarchyVisibleEdges({
        model,
        visibleNodeIds: new Set(["goal:one"]),
        includeSecondary: false
      })
    ).toEqual([]);

    const structuralModel = buildKnowledgeGraphHierarchyModel(nodes, edges);
    expect(
      resolveKnowledgeGraphFocusedHierarchyVisibleIds({
        model: structuralModel,
        focusNodeId: "project:one",
        expandAll: false,
        includeSecondary: false
      })
    ).toEqual(new Set(["project:one", "goal:one", "task:one"]));
  });

  it("selects one canonical hierarchy edge when several relationships connect the same parent and child", () => {
    const model = buildKnowledgeGraphHierarchyModel(nodes, [
      ...edges,
      {
        id: "goal-project-one-parallel",
        source: "goal:one",
        target: "project:one",
        relationKind: "goal_task",
        family: "structural",
        label: "Also relates",
        strength: 0.5,
        directional: true,
        structural: true
      }
    ]);

    expect(model.parentById.get("project:one")).toBe("goal:one");
    expect(model.parentEdgeByChildId.get("project:one")?.id).toBe(
      "goal-project-one"
    );
  });

  it("keeps every direct primary child discoverable in focused mode even when the child has another canonical parent", () => {
    const model = buildKnowledgeGraphHierarchyModel(nodes, [
      ...edges,
      {
        id: "goal-task-one",
        source: "goal:one",
        target: "task:one",
        relationKind: "goal_task",
        family: "structural",
        label: "Direct goal task",
        strength: 2,
        directional: true,
        structural: true
      }
    ]);

    expect(model.parentById.get("task:one")).toBe("goal:one");
    expect(model.primaryChildrenById.get("project:one")).toContain("task:one");
    expect(
      resolveKnowledgeGraphFocusedHierarchyVisibleIds({
        model,
        focusNodeId: "project:one",
        expandAll: false
      })
    ).toEqual(new Set(["project:one", "goal:one", "task:one"]));
    expect(model.primaryEdgeByPair.get("project:one\u0000task:one")?.id).toBe(
      "project-task-one"
    );
  });

  it("keeps contextual links out of the canonical tree without hiding their linked nodes", () => {
    const model = buildKnowledgeGraphHierarchyModel(nodes, [
      ...edges,
      {
        id: "goal-taxonomy-project",
        source: "goal:one",
        target: "project:two",
        relationKind: "tag_goal",
        family: "taxonomy",
        label: "Taxonomy context",
        strength: 1,
        directional: true,
        structural: false
      },
      {
        id: "goal-contextual-goal",
        source: "goal:one",
        target: "goal:two",
        relationKind: "entity_link",
        family: "contextual",
        label: "Contextual link",
        strength: 1,
        directional: true,
        structural: false
      }
    ]);

    expect(model.primaryChildrenById.get("goal:one")).toEqual([
      "project:one",
      "project:two"
    ]);
    expect(
      resolveKnowledgeGraphFocusedHierarchyVisibleIds({
        model,
        focusNodeId: "goal:one",
        expandAll: false
      })
    ).toEqual(new Set(["goal:one", "goal:two", "project:one", "project:two"]));
    expect(
      [...model.primaryEdgeByPair.values()].map((edge) => edge.id)
    ).not.toContain("goal-contextual-goal");
  });

  it("returns every node only when expand all is explicit", () => {
    const model = buildKnowledgeGraphHierarchyModel(nodes, edges);
    expect(
      resolveKnowledgeGraphHierarchyVisibleIds({
        model,
        expandedNodeIds: new Set(),
        expandAll: true,
        focusNodeId: null
      }).size
    ).toBe(nodes.length);
  });

  it("preserves adjacency and edge parity on the deterministic large fixture", () => {
    const fixture = buildPerformanceGraphFixture("large");
    const model = buildKnowledgeGraphHierarchyModel(
      fixture.nodes,
      fixture.edges
    );
    const focusNodeId = fixture.nodes[0]!.id;
    const expectedDirectIds = new Set([focusNodeId]);
    for (const edge of fixture.edges) {
      if (edge.source === focusNodeId) expectedDirectIds.add(edge.target);
      if (edge.target === focusNodeId) expectedDirectIds.add(edge.source);
    }

    const visibleNodeIds = resolveKnowledgeGraphFocusedHierarchyVisibleIds({
      model,
      focusNodeId,
      expandAll: false
    });
    expect(visibleNodeIds).toEqual(expectedDirectIds);

    const expectedVisibleEdgeIds = fixture.edges
      .filter(
        (edge) =>
          visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
      )
      .map((edge) => edge.id);
    expect(
      resolveKnowledgeGraphHierarchyVisibleEdges({
        model,
        visibleNodeIds,
        includeSecondary: true
      }).map((edge) => edge.id)
    ).toEqual(expectedVisibleEdgeIds);
  });
});
