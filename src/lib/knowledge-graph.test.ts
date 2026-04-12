import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGraphDatasetSignature,
  buildRenderedKnowledgeGraphEdges,
  buildKnowledgeGraphFocusPayload,
  buildKnowledgeGraphHierarchy,
  filterKnowledgeGraphData,
  selectKnowledgeGraphVisibleNodeIds
} from "@/lib/knowledge-graph";
import {
  KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP,
  buildKnowledgeGraphFocusHref,
  buildKnowledgeGraphNodeId,
  formatKnowledgeGraphFocusValue,
  getKnowledgeGraphEntityHref,
  parseKnowledgeGraphFocusValue,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode
} from "@/lib/knowledge-graph-types";

const goalNode: KnowledgeGraphNode = {
  id: buildKnowledgeGraphNodeId("goal", "goal-1"),
  entityType: "goal",
  entityId: "goal-1",
  entityKind: "goal",
  title: "North Star",
  subtitle: "Five years",
  description: "Top-level goal",
  href: "/goals/goal-1",
  graphHref: "/knowledge-graph?focus=goal%3Agoal-1",
  iconName: "Target",
  accentToken: "--forge-entity-goal-rgb",
  size: 48,
  importance: 64,
  previewStats: [],
  owner: null,
  tags: [],
  updatedAt: "2026-04-10T08:00:00.000Z",
  graphStats: {
    degree: 0,
    structuralDegree: 0,
    contextualDegree: 0,
    taxonomyDegree: 0,
    workspaceDegree: 0
  }
};

const projectNode: KnowledgeGraphNode = {
  id: buildKnowledgeGraphNodeId("project", "project-1"),
  entityType: "project",
  entityId: "project-1",
  entityKind: "project",
  title: "Execution Layer",
  subtitle: "Supports North Star",
  description: "Project connected to the goal",
  href: "/projects/project-1",
  graphHref: "/knowledge-graph?focus=project%3Aproject-1",
  iconName: "FolderOpen",
  accentToken: "--forge-entity-project-rgb",
  size: 42,
  importance: 56,
  previewStats: [],
  owner: null,
  tags: [],
  updatedAt: "2026-04-10T08:10:00.000Z",
  graphStats: {
    degree: 0,
    structuralDegree: 0,
    contextualDegree: 0,
    taxonomyDegree: 0,
    workspaceDegree: 0
  }
};

const wikiNode: KnowledgeGraphNode = {
  id: buildKnowledgeGraphNodeId("note", "note-1"),
  entityType: "note",
  entityId: "note-1",
  entityKind: "wiki_page",
  title: "Architecture Notes",
  subtitle: "knowledge-graph",
  description: "Wiki page attached to the goal",
  href: "/wiki/page/architecture-notes",
  graphHref: "/knowledge-graph?focus=note%3Anote-1",
  iconName: "StickyNote",
  accentToken: "--forge-entity-wiki_page-rgb",
  size: 38,
  importance: 45,
  previewStats: [],
  owner: null,
  tags: [],
  updatedAt: "2026-04-10T09:00:00.000Z",
  graphStats: {
    degree: 0,
    structuralDegree: 0,
    contextualDegree: 0,
    taxonomyDegree: 0,
    workspaceDegree: 0
  }
};

const edges: KnowledgeGraphEdge[] = [
  {
    id: "goal-project",
    source: goalNode.id,
    target: projectNode.id,
    relationKind: "goal_project",
    family: KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP.goal_project,
    label: "Supports goal",
    strength: 0.9,
    directional: true,
    structural: true
  },
  {
    id: "wiki-goal",
    source: wikiNode.id,
    target: goalNode.id,
    relationKind: "wiki_link",
    family: KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP.wiki_link,
    label: "References goal",
    strength: 0.7,
    directional: true,
    structural: false
  }
];

describe("knowledge graph helpers", () => {
  it("parses and formats deep-link focus values", () => {
    const value = formatKnowledgeGraphFocusValue("task", "task-42");
    expect(value).toBe("task:task-42");
    expect(parseKnowledgeGraphFocusValue(value)).toEqual({
      entityType: "task",
      entityId: "task-42"
    });
  });

  it("resolves canonical graph hrefs for core entity types", () => {
    expect(getKnowledgeGraphEntityHref("goal", "goal-1")).toBe("/goals/goal-1");
    expect(getKnowledgeGraphEntityHref("tag", "tag-1")).toBe("/tags?focus=tag-1");
    expect(getKnowledgeGraphEntityHref("habit", "habit-1")).toBe(
      "/habits?focus=habit-1"
    );
    expect(
      getKnowledgeGraphEntityHref("note", "note-1", {
        noteKind: "wiki",
        noteSlug: "architecture-notes",
        noteSpaceId: "space-main"
      })
    ).toBe("/wiki/page/architecture-notes?spaceId=space-main");
    expect(getKnowledgeGraphEntityHref("workbench_surface", "today")).toBe(
      "/workbench?surface=today"
    );
    expect(buildKnowledgeGraphFocusHref("task", "task-9", { view: "hierarchy" })).toBe(
      "/knowledge-graph?focus=task%3Atask-9&view=hierarchy"
    );
  });

  it("builds deterministic hierarchy layers and marks backward edges as secondary", () => {
    const hierarchy = buildKnowledgeGraphHierarchy(
      [wikiNode, projectNode, goalNode],
      edges
    );

    expect(hierarchy.nodes.map((node) => node.id)).toEqual([
      goalNode.id,
      projectNode.id,
      wikiNode.id
    ]);
    expect(hierarchy.edges.find((edge) => edge.id === "goal-project")?.secondary).toBe(
      false
    );
    expect(hierarchy.edges.find((edge) => edge.id === "wiki-goal")?.secondary).toBe(
      true
    );
  });

  it("builds a focused neighborhood with grouped first-ring relations", () => {
    const focus = buildKnowledgeGraphFocusPayload(
      [goalNode, projectNode, wikiNode],
      edges,
      goalNode.id
    );

    expect(focus.focusNode?.id).toBe(goalNode.id);
    expect(focus.firstRingNodes.map((node) => node.id)).toEqual([
      wikiNode.id,
      projectNode.id
    ]);
    expect(focus.familyGroups.map((group) => group.family)).toEqual([
      "contextual",
      "structural"
    ]);
    expect(focus.relationCounts.structural).toBe(1);
    expect(focus.relationCounts.contextual).toBe(1);
  });

  it("filters graph nodes by free text and tags before relation pruning", () => {
    const taggedGoal = {
      ...goalNode,
      tags: [{ id: "tag-vision", label: "Vision" }]
    };
    const untaggedProject = {
      ...projectNode,
      tags: []
    };
    const filtered = filterKnowledgeGraphData(
      {
        nodes: [taggedGoal, untaggedProject, wikiNode],
        edges
      },
      {
        q: "north star",
        tags: ["tag-vision"]
      }
    );

    expect(filtered.nodes.map((node) => node.id)).toEqual([taggedGoal.id]);
    expect(filtered.edges).toEqual([]);
  });

  it("prioritizes hop expansion from the focused node when limiting visible nodes", () => {
    const taskNode: KnowledgeGraphNode = {
      ...projectNode,
      id: buildKnowledgeGraphNodeId("task", "task-1"),
      entityType: "task",
      entityId: "task-1",
      entityKind: "task",
      title: "Focused task",
      importance: 60,
      tags: []
    };
    const reportNode: KnowledgeGraphNode = {
      ...wikiNode,
      id: buildKnowledgeGraphNodeId("trigger_report", "report-1"),
      entityType: "trigger_report",
      entityId: "report-1",
      entityKind: "report",
      title: "Second hop report",
      importance: 50,
      tags: []
    };
    const expandedEdges: KnowledgeGraphEdge[] = [
      ...edges,
      {
        id: "project-task",
        source: projectNode.id,
        target: taskNode.id,
        relationKind: "project_task",
        family: KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP.project_task,
        label: "Contains task",
        strength: 0.9,
        directional: true,
        structural: true
      },
      {
        id: "task-report",
        source: taskNode.id,
        target: reportNode.id,
        relationKind: "report_task",
        family: KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP.report_task,
        label: "Report to task",
        strength: 0.7,
        directional: true,
        structural: false
      }
    ];

    const visibleIds = selectKnowledgeGraphVisibleNodeIds({
      nodes: [goalNode, projectNode, taskNode, reportNode],
      edges: expandedEdges,
      limit: 3,
      focusNodeId: projectNode.id
    });

    expect(Array.from(visibleIds)).toEqual([
      projectNode.id,
      goalNode.id,
      taskNode.id
    ]);
  });

  it("collapses parallel edges by ordered endpoint pair for graph rendering", () => {
    const duplicateEdges: KnowledgeGraphEdge[] = [
      {
        ...edges[0],
        id: "goal-project-secondary",
        label: "Secondary support",
        strength: 0.75
      },
      edges[0]!,
      edges[1]!
    ];

    const renderedEdges = buildRenderedKnowledgeGraphEdges(duplicateEdges);

    expect(renderedEdges).toHaveLength(2);
    expect(renderedEdges[0]).toMatchObject({
      source: goalNode.id,
      target: projectNode.id,
      relationKind: "goal_project",
      parallelCount: 2
    });
    expect(renderedEdges[0]?.data.map((edge) => edge.id)).toEqual([
      "goal-project",
      "goal-project-secondary"
    ]);
    expect(renderedEdges[0]?.label).toContain("+1");
  });

  it("fills remaining focused capacity by stable importance when BFS shells do not fill the cap", () => {
    const detachedNode: KnowledgeGraphNode = {
      ...wikiNode,
      id: buildKnowledgeGraphNodeId("note", "note-detached"),
      entityId: "note-detached",
      title: "Detached evidence",
      importance: 58
    };
    const detachedNodeLow: KnowledgeGraphNode = {
      ...wikiNode,
      id: buildKnowledgeGraphNodeId("note", "note-detached-low"),
      entityId: "note-detached-low",
      title: "Detached evidence low",
      importance: 21
    };
    const visibleIds = selectKnowledgeGraphVisibleNodeIds({
      nodes: [goalNode, projectNode, wikiNode, detachedNode, detachedNodeLow],
      edges,
      limit: 4,
      focusNodeId: projectNode.id
    });

    expect(Array.from(visibleIds)).toEqual([
      projectNode.id,
      goalNode.id,
      wikiNode.id,
      detachedNode.id
    ]);
  });

  it("keeps the dataset signature stable when only generatedAt would differ", () => {
    const firstSignature = buildKnowledgeGraphDatasetSignature(
      [goalNode, projectNode, wikiNode],
      edges
    );
    const secondSignature = buildKnowledgeGraphDatasetSignature(
      [
        { ...goalNode },
        { ...projectNode },
        { ...wikiNode }
      ],
      edges.map((edge) => ({ ...edge }))
    );

    expect(secondSignature).toBe(firstSignature);
  });

  it("keeps graph helper performance within a generous regression budget", () => {
    const manyNodes = Array.from({ length: 1200 }, (_, index) => ({
      ...projectNode,
      id: buildKnowledgeGraphNodeId("task", `task-${index}`),
      entityType: "task" as const,
      entityId: `task-${index}`,
      entityKind: "task" as const,
      title: `Task ${index}`,
      importance: 1200 - index,
      size: 30 + (index % 6),
      updatedAt: `2026-04-${String((index % 28) + 1).padStart(2, "0")}T08:00:00.000Z`
    }));
    const manyEdges = manyNodes.slice(1).flatMap((node, index) => [
      {
        id: `edge-${index}`,
        source: manyNodes[index]!.id,
        target: node.id,
        relationKind: "project_task" as const,
        family: KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP.project_task,
        label: "Contains task",
        strength: 0.85,
        directional: true,
        structural: true
      },
      {
        id: `edge-duplicate-${index}`,
        source: manyNodes[index]!.id,
        target: node.id,
        relationKind: "project_task" as const,
        family: KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP.project_task,
        label: "Parallel support",
        strength: 0.6,
        directional: true,
        structural: true
      }
    ]);

    const startedAt = performance.now();
    const filtered = filterKnowledgeGraphData(
      {
        nodes: manyNodes,
        edges: manyEdges
      },
      {
        q: "Task 11",
        limit: 180
      }
    );
    buildRenderedKnowledgeGraphEdges(filtered.edges);
    selectKnowledgeGraphVisibleNodeIds({
      nodes: manyNodes,
      edges: manyEdges,
      limit: 180,
      focusNodeId: manyNodes[200]?.id ?? null
    });
    const elapsedMs = performance.now() - startedAt;

    expect(filtered.nodes.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(1200);
  });
});
