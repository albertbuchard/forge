import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGraphHierarchyModel,
  resolveKnowledgeGraphFocusedHierarchyVisibleIds,
  resolveKnowledgeGraphHierarchyVisibleIds,
  toggleKnowledgeGraphHierarchyBranch
} from "@/components/knowledge-graph/knowledge-graph-hierarchy-model";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode
} from "@/lib/knowledge-graph-types";

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

  it("shows only the selected node and direct children in focused mode unless the subtree is expanded", () => {
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
    ).toEqual(new Set(["project:one", "task:one"]));
    expect(model.primaryEdgeByPair.get("project:one\u0000task:one")?.id).toBe(
      "project-task-one"
    );
  });

  it("includes forward structural and taxonomy children while keeping contextual links out of the default hierarchy", () => {
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
    ).toEqual(new Set(["goal:one", "project:one", "project:two"]));
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
});
