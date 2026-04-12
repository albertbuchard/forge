import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGraphFocusCameraTarget,
  buildKnowledgeGraphFocusRings,
  buildKnowledgeGraphSeedPositions,
  reduceKnowledgeGraphSigmaEdgeAttributes,
  reduceKnowledgeGraphSigmaNodeAttributes
} from "@/components/knowledge-graph/knowledge-graph-force-view-model";
import type { KnowledgeGraphNode } from "@/lib/knowledge-graph-types";

const baseNode: KnowledgeGraphNode = {
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
};

describe("KnowledgeGraphForceView reducers", () => {
  it("seeds fresh graphs with dispersed phyllotaxis positions instead of one frozen circle", () => {
    const nodes: KnowledgeGraphNode[] = [
      baseNode,
      {
        ...baseNode,
        id: "project:project-1",
        entityType: "project",
        entityId: "project-1",
        entityKind: "project",
        title: "Execution Layer",
        importance: 80
      },
      {
        ...baseNode,
        id: "task:task-1",
        entityType: "task",
        entityId: "task-1",
        entityKind: "task",
        title: "Ship graph",
        importance: 70
      }
    ];

    const positions = buildKnowledgeGraphSeedPositions({
      nodes,
      cache: new Map()
    });

    const radii = nodes.map((node) => {
      const position = positions.get(node.id)!;
      return Number(Math.hypot(position.x, position.y).toFixed(4));
    });

    expect(new Set(radii).size).toBeGreaterThan(1);
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.2);
  });

  it("preserves sigma node position attributes while styling focused nodes", () => {
    const reduced = reduceKnowledgeGraphSigmaNodeAttributes({
      nodeId: baseNode.id,
      node: baseNode,
      focusNodeId: baseNode.id,
      relatedNodeIds: new Set([baseNode.id]),
      hoveredNodeId: null,
      attributes: {
        x: 12,
        y: -4,
        size: 8,
        color: "rgb(10, 20, 30)",
        label: "",
        hidden: false,
        forceLabel: false,
        highlighted: false,
        zIndex: 0,
        data: baseNode
      }
    });

    expect(reduced.x).toBe(12);
    expect(reduced.y).toBe(-4);
    expect(reduced.label).toBe("North Star");
    expect(reduced.size).toBeCloseTo(14.4);
    expect(reduced.zIndex).toBe(3);
  });

  it("prioritizes a dragged node visually without losing position data", () => {
    const reduced = reduceKnowledgeGraphSigmaNodeAttributes({
      nodeId: baseNode.id,
      node: baseNode,
      focusNodeId: null,
      relatedNodeIds: new Set([baseNode.id]),
      hoveredNodeId: null,
      draggedNodeId: baseNode.id,
      attributes: {
        x: 2,
        y: 5,
        size: 10,
        color: "rgb(10, 20, 30)",
        label: "",
        hidden: false,
        forceLabel: false,
        highlighted: false,
        zIndex: 0,
        data: baseNode
      }
    });

    expect(reduced.x).toBe(2);
    expect(reduced.y).toBe(5);
    expect(reduced.label).toBe(baseNode.title);
    expect(reduced.size).toBe(20);
    expect(reduced.zIndex).toBe(4);
  });

  it("preserves sigma edge metadata while styling focused relationships", () => {
    const reduced = reduceKnowledgeGraphSigmaEdgeAttributes({
      focusNodeId: baseNode.id,
      relatedNodeIds: new Set([baseNode.id, "project:project-1"]),
      edge: {
        id: "goal-project",
        source: baseNode.id,
        target: "project:project-1",
        relationKind: "goal_project",
        family: "structural",
        label: "Supports goal",
        strength: 0.9,
        directional: true,
        structural: true,
        parallelCount: 1,
        data: []
      },
      attributes: {
        size: 2,
        color: "rgba(255,255,255,0.18)",
        hidden: false,
        label: "Supports goal",
        forceLabel: false,
        zIndex: 0,
        data: {
          id: "goal-project",
          source: baseNode.id,
          target: "project:project-1",
          relationKind: "goal_project",
          family: "structural",
          label: "Supports goal",
          strength: 0.9,
          directional: true,
          structural: true,
          parallelCount: 1,
          data: []
        }
      }
    });

    expect(reduced.label).toBe("Supports goal");
    expect(reduced.hidden).toBe(false);
    expect(reduced.size).toBeCloseTo(2.6);
    expect(reduced.zIndex).toBe(2);
  });

  it("builds deterministic first-ring and second-ring neighborhoods for focus mode", () => {
    const rings = buildKnowledgeGraphFocusRings(
      [
        {
          source: baseNode.id,
          target: "project:project-1"
        },
        {
          source: "project:project-1",
          target: "task:task-1"
        },
        {
          source: "note:note-1",
          target: baseNode.id
        }
      ],
      baseNode.id
    );

    expect(rings.firstRing).toEqual(["note:note-1", "project:project-1"]);
    expect(rings.secondRing).toEqual(["task:task-1"]);
  });

  it("fits the focus camera to the visible neighborhood instead of using a hardcoded zoom", () => {
    const target = buildKnowledgeGraphFocusCameraTarget({
      positions: new Map([
        [baseNode.id, { x: 0, y: 0 }],
        ["project:project-1", { x: 1.1, y: 0.1 }],
        ["task:task-1", { x: 2.4, y: -0.2 }],
        ["note:note-1", { x: -0.8, y: 0.45 }],
        ["goal:goal-2", { x: 7.5, y: 5.2 }]
      ]),
      focusNodeId: baseNode.id,
      firstRingNodeIds: ["note:note-1", "project:project-1"],
      secondRingNodeIds: ["task:task-1"],
      currentRatio: 1
    });

    expect(target?.x).toBeCloseTo(0.8);
    expect(target?.y).toBeCloseTo(0.125);
    expect(target?.ratio).toBeGreaterThanOrEqual(0.2);
    expect(target?.ratio).toBeLessThan(1);
    expect(target?.nodeIds).toEqual([
      baseNode.id,
      "note:note-1",
      "project:project-1",
      "task:task-1"
    ]);
  });
});
