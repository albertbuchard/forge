import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_GRAPH_NODE_VISIBILITY_POLICY,
  KNOWLEDGE_GRAPH_RELATION_VISIBILITY_POLICY,
  resolveKnowledgeGraphPresentation
} from "@/lib/knowledge-graph-visibility-policy";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode
} from "@/lib/knowledge-graph-types";

function node(id: string, entityKind: KnowledgeGraphNode["entityKind"]) {
  return {
    id,
    entityType: "note",
    entityId: id,
    entityKind,
    title: id,
    subtitle: "",
    description: "",
    href: null,
    graphHref: `/knowledge-graph?focus=${id}`,
    iconName: null,
    accentToken: null,
    size: 1,
    importance: 1,
    previewStats: [],
    owner: null,
    tags: [],
    updatedAt: null,
    graphStats: {
      degree: 0,
      structuralDegree: 0,
      contextualDegree: 0,
      taxonomyDegree: 0,
      workspaceDegree: 0
    }
  } satisfies KnowledgeGraphNode;
}

function edge(
  id: string,
  source: string,
  target: string,
  relationKind: KnowledgeGraphEdge["relationKind"]
) {
  return {
    id,
    source,
    target,
    relationKind,
    family: relationKind.startsWith("tag_") ? "taxonomy" : "structural",
    label: id,
    strength: 1,
    directional: true,
    structural: true
  } satisfies KnowledgeGraphEdge;
}

const nodes = [
  node("goal:1", "goal"),
  node("project:1", "project"),
  node("task:1", "task"),
  node("tag:1", "tag")
];
const edges = [
  edge("goal-project", "goal:1", "project:1", "goal_project"),
  edge("goal-task", "goal:1", "task:1", "goal_task"),
  edge("tag-goal", "tag:1", "goal:1", "tag_goal")
];

describe("knowledge graph visibility policy", () => {
  it("defines an intentional policy for every compile-time node and relation kind", () => {
    expect(Object.keys(KNOWLEDGE_GRAPH_NODE_VISIBILITY_POLICY)).toHaveLength(
      28
    );
    expect(
      Object.keys(KNOWLEDGE_GRAPH_RELATION_VISIBILITY_POLICY)
    ).toHaveLength(54);
    for (const policy of [
      ...Object.values(KNOWLEDGE_GRAPH_NODE_VISIBILITY_POLICY),
      ...Object.values(KNOWLEDGE_GRAPH_RELATION_VISIBILITY_POLICY)
    ]) {
      expect(policy.label).not.toBe("");
      expect(policy.rationale).not.toBe("");
      expect(policy.disclosureGroup).not.toBe("");
    }
  });

  it("locks the exact calm-overview memberships", () => {
    expect(
      Object.entries(KNOWLEDGE_GRAPH_NODE_VISIBILITY_POLICY)
        .filter(([, policy]) => policy.defaultVisible)
        .map(([kind]) => kind)
    ).toEqual([
      "goal",
      "strategy",
      "project",
      "wiki_space",
      "wiki_page",
      "note",
      "insight",
      "person",
      "artifact",
      "value",
      "pattern",
      "behavior",
      "belief",
      "mode"
    ]);
    expect(
      Object.entries(KNOWLEDGE_GRAPH_NODE_VISIBILITY_POLICY)
        .filter(([, policy]) => !policy.defaultVisible)
        .map(([kind]) => kind)
    ).toEqual([
      "task",
      "habit",
      "tag",
      "calendar_event",
      "work_block",
      "timebox",
      "mode_session",
      "flashcard",
      "report",
      "event_type",
      "emotion",
      "workbench",
      "functor",
      "chat"
    ]);
    expect(
      Object.entries(KNOWLEDGE_GRAPH_RELATION_VISIBILITY_POLICY)
        .filter(([, policy]) => policy.defaultVisible)
        .map(([kind]) => kind)
    ).toEqual([
      "goal_project",
      "goal_task",
      "project_task",
      "value_goal",
      "value_project",
      "value_task",
      "strategy_target",
      "strategy_step",
      "strategy_link",
      "habit_link",
      "entity_link",
      "note_link",
      "wiki_parent",
      "wiki_link",
      "calendar_link",
      "timebox_task",
      "timebox_project",
      "pattern_value",
      "pattern_belief",
      "pattern_mode",
      "behavior_pattern",
      "behavior_value",
      "behavior_belief",
      "behavior_mode",
      "belief_value",
      "belief_behavior",
      "belief_mode",
      "belief_report",
      "mode_pattern",
      "mode_behavior",
      "mode_value",
      "flashcard_value",
      "flashcard_behavior",
      "flashcard_pattern",
      "flashcard_belief",
      "flashcard_mode",
      "flashcard_report",
      "report_value",
      "report_pattern",
      "report_goal",
      "report_project",
      "report_task",
      "report_behavior",
      "report_belief",
      "report_mode",
      "mode_session_mode",
      "workbench_flow",
      "workbench_surface",
      "workbench_route"
    ]);
    expect(
      Object.entries(KNOWLEDGE_GRAPH_RELATION_VISIBILITY_POLICY)
        .filter(([, policy]) => !policy.defaultVisible)
        .map(([kind]) => kind)
    ).toEqual([
      "tag_goal",
      "tag_task",
      "tag_strategy",
      "report_event_type",
      "report_emotion"
    ]);
  });

  it("keeps a calm default while retaining all data outside the presentation sets", () => {
    const presentation = resolveKnowledgeGraphPresentation({
      nodes,
      edges,
      displayMode: "default",
      hasExplicitQuery: false,
      focusNodeId: null
    });

    expect([...presentation.visibleNodeIds]).toEqual(["goal:1", "project:1"]);
    expect([...presentation.visibleEdgeIds]).toEqual(["goal-project"]);
    expect(presentation.hiddenNodeCount).toBe(2);
    expect(presentation.hiddenEdgeCount).toBe(2);
  });

  it("reveals hidden-by-default kinds for search and explicit filters", () => {
    const presentation = resolveKnowledgeGraphPresentation({
      nodes,
      edges,
      displayMode: "default",
      hasExplicitQuery: true,
      focusNodeId: null
    });

    expect(presentation.visibleNodeIds).toEqual(
      new Set(nodes.map(({ id }) => id))
    );
    expect(presentation.visibleEdgeIds).toEqual(
      new Set(edges.map(({ id }) => id))
    );
    expect(presentation.disclosureReason).toBe("query");
  });

  it("keeps every hidden-by-default node kind searchable and focusable", () => {
    const hiddenKinds = Object.entries(KNOWLEDGE_GRAPH_NODE_VISIBILITY_POLICY)
      .filter(([, policy]) => !policy.defaultVisible)
      .map(([kind]) => kind as KnowledgeGraphNode["entityKind"]);
    const hiddenNodes = hiddenKinds.map((kind) => node(`${kind}:1`, kind));
    const allNodes = [node("goal:1", "goal"), ...hiddenNodes];
    const allEdges = hiddenNodes.map((hiddenNode) =>
      edge(`context:${hiddenNode.id}`, "goal:1", hiddenNode.id, "entity_link")
    );

    const searched = resolveKnowledgeGraphPresentation({
      nodes: allNodes,
      edges: allEdges,
      displayMode: "default",
      hasExplicitQuery: true,
      focusNodeId: null
    });
    for (const hiddenNode of hiddenNodes) {
      expect(searched.visibleNodeIds.has(hiddenNode.id)).toBe(true);
      const focused = resolveKnowledgeGraphPresentation({
        nodes: allNodes,
        edges: allEdges,
        displayMode: "default",
        hasExplicitQuery: false,
        focusNodeId: hiddenNode.id
      });
      expect(focused.visibleNodeIds.has(hiddenNode.id)).toBe(true);
      expect(focused.visibleNodeIds.has("goal:1")).toBe(true);
      expect(focused.visibleEdgeIds.has(`context:${hiddenNode.id}`)).toBe(true);
    }
  });

  it("reveals a hidden focused node, its direct context, and its connecting edge", () => {
    const presentation = resolveKnowledgeGraphPresentation({
      nodes,
      edges,
      displayMode: "default",
      hasExplicitQuery: false,
      focusNodeId: "tag:1"
    });

    expect(presentation.visibleNodeIds.has("tag:1")).toBe(true);
    expect(presentation.visibleNodeIds.has("goal:1")).toBe(true);
    expect(presentation.visibleEdgeIds.has("tag-goal")).toBe(true);
    expect(presentation.disclosureReason).toBe("focus");
  });

  it("supports an explicit all-types view", () => {
    const presentation = resolveKnowledgeGraphPresentation({
      nodes,
      edges,
      displayMode: "all",
      hasExplicitQuery: false,
      focusNodeId: null
    });

    expect(presentation.hiddenNodeCount).toBe(0);
    expect(presentation.hiddenEdgeCount).toBe(0);
    expect(presentation.disclosureReason).toBe("all");
  });

  it("keeps every type represented when the all-types view exceeds its progressive budget", () => {
    const manyNodes = [
      ...Array.from({ length: 8 }, (_, index) => node(`goal:${index}`, "goal")),
      ...Array.from({ length: 8 }, (_, index) => node(`task:${index}`, "task")),
      ...Array.from({ length: 8 }, (_, index) => node(`tag:${index}`, "tag"))
    ];
    const presentation = resolveKnowledgeGraphPresentation({
      nodes: manyNodes,
      edges: [],
      displayMode: "all",
      hasExplicitQuery: false,
      focusNodeId: null,
      nodeBudget: 6
    });

    expect(presentation.visibleNodeIds.size).toBe(6);
    for (const prefix of ["goal:", "task:", "tag:"]) {
      expect(
        [...presentation.visibleNodeIds].some((id) => id.startsWith(prefix))
      ).toBe(true);
    }
    expect(presentation.hiddenNodeCount).toBe(18);
    expect(presentation.disclosureReason).toBe("all");
  });

  it("uses an importance budget only for the calm overview and preserves anchors", () => {
    const manyNodes = [
      node("goal:anchor", "goal"),
      ...Array.from({ length: 8 }, (_, index) => ({
        ...node(`note:${index}`, "note"),
        importance: index,
        graphStats: {
          degree: index,
          structuralDegree: 0,
          contextualDegree: index,
          taxonomyDegree: 0,
          workspaceDegree: 0
        }
      }))
    ];
    const presentation = resolveKnowledgeGraphPresentation({
      nodes: manyNodes,
      edges: [],
      displayMode: "default",
      hasExplicitQuery: false,
      focusNodeId: null,
      nodeBudget: 3
    });

    expect(presentation.visibleNodeIds).toEqual(
      new Set(["goal:anchor", "note:7", "note:6"])
    );
    expect(presentation.hiddenNodeCount).toBe(6);
  });

  it("uses a bounded ambient edge budget while preserving focus relationships", () => {
    const manyNodes = Array.from({ length: 120 }, (_, index) =>
      node(`goal:${index}`, "goal")
    );
    const manyEdges = Array.from({ length: 119 }, (_, index) =>
      edge(`edge:${index}`, "goal:0", `goal:${index + 1}`, "goal_project")
    );
    const overview = resolveKnowledgeGraphPresentation({
      nodes: manyNodes,
      edges: manyEdges,
      displayMode: "default",
      hasExplicitQuery: false,
      focusNodeId: null
    });
    expect(overview.visibleEdgeIds.size).toBe(36);
    expect(overview.hiddenEdgeCount).toBe(83);

    const focused = resolveKnowledgeGraphPresentation({
      nodes: manyNodes,
      edges: manyEdges,
      displayMode: "default",
      hasExplicitQuery: false,
      focusNodeId: "goal:0",
      edgeBudget: 4
    });
    expect(focused.visibleEdgeIds.size).toBe(119);
  });
});
