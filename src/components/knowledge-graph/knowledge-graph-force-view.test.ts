import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGraphFramedGraphPosition,
  buildKnowledgeGraphFocusCameraTarget,
  buildKnowledgeGraphFocusRings,
  buildKnowledgeGraphHopLevels,
  buildKnowledgeGraphOverviewCameraTarget,
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

    const positionsList = nodes.map((node) => positions.get(node.id)!);
    const centroidX =
      positionsList.reduce((sum, position) => sum + position.x, 0) /
      positionsList.length;
    const centroidY =
      positionsList.reduce((sum, position) => sum + position.y, 0) /
      positionsList.length;

    expect(centroidX).toBeCloseTo(0, 6);
    expect(centroidY).toBeCloseTo(0, 6);
  });

  it("preserves sigma node position attributes while styling focused nodes", () => {
    const reduced = reduceKnowledgeGraphSigmaNodeAttributes({
      nodeId: baseNode.id,
      node: baseNode,
      focusNodeId: baseNode.id,
      relatedNodeIds: new Set([baseNode.id]),
      detailNodeIds: new Set([baseNode.id]),
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
      detailNodeIds: new Set([baseNode.id]),
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
      detailNodeIds: new Set([baseNode.id, "project:project-1"]),
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
    expect(reduced.color).toBe("rgba(125, 211, 252, 0.24)");
    expect(reduced.size).toBeCloseTo(2.36);
    expect(reduced.zIndex).toBe(2);
  });

  it("uses softer family-colored edges and light hover emphasis outside direct focus", () => {
    const reduced = reduceKnowledgeGraphSigmaEdgeAttributes({
      focusNodeId: null,
      detailNodeIds: new Set(),
      relatedNodeIds: new Set([baseNode.id, "project:project-1"]),
      hoveredNodeId: "project:project-1",
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
        color: "rgba(125, 211, 252, 0.14)",
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

    expect(reduced.color).toBe("rgba(125, 211, 252, 0.14)");
    expect(reduced.size).toBeCloseTo(2.16);
    expect(reduced.zIndex).toBe(1);
  });

  it("starts the initial overview camera at the graph origin", () => {
    const overview = buildKnowledgeGraphOverviewCameraTarget({
      positions: new Map([
        ["a", { x: -4, y: 3 }],
        ["b", { x: 10, y: -5 }],
        ["c", { x: 2, y: 7 }]
      ])
    });

    expect(overview.x).toBe(0);
    expect(overview.y).toBe(0);
    expect(overview.ratio).toBeGreaterThan(1);
  });

  it("maps graph positions into sigma framedGraph coordinates instead of raw graph coordinates", () => {
    const framed = buildKnowledgeGraphFramedGraphPosition({
      positions: new Map([
        ["left", { x: -10, y: -2 }],
        ["right", { x: 10, y: 2 }]
      ]),
      point: { x: 0, y: -2 }
    });

    expect(framed.x).toBeCloseTo(0.5);
    expect(framed.y).toBeCloseTo(0.4);
  });

  it("dims focused-network edges as they get farther from the focused node", () => {
    const firstRingEdge = reduceKnowledgeGraphSigmaEdgeAttributes({
      focusNodeId: baseNode.id,
      detailNodeIds: new Set([baseNode.id, "project:project-1"]),
      relatedNodeIds: new Set([
        baseNode.id,
        "project:project-1",
        "task:task-1"
      ]),
      edge: {
        id: "project-task",
        source: "project:project-1",
        target: "task:task-1",
        relationKind: "project_task",
        family: "structural",
        label: "Contains task",
        strength: 0.8,
        directional: true,
        structural: true,
        parallelCount: 1,
        data: []
      },
      attributes: {
        size: 2,
        color: "rgba(125, 211, 252, 0.1)",
        hidden: false,
        label: "Contains task",
        forceLabel: false,
        zIndex: 0,
        data: {
          id: "project-task",
          source: "project:project-1",
          target: "task:task-1",
          relationKind: "project_task",
          family: "structural",
          label: "Contains task",
          strength: 0.8,
          directional: true,
          structural: true,
          parallelCount: 1,
          data: []
        }
      }
    });

    const farEdge = reduceKnowledgeGraphSigmaEdgeAttributes({
      focusNodeId: baseNode.id,
      detailNodeIds: new Set([baseNode.id, "project:project-1"]),
      relatedNodeIds: new Set([
        baseNode.id,
        "project:project-1",
        "task:task-1"
      ]),
      edge: {
        id: "task-note",
        source: "task:task-1",
        target: "note:note-1",
        relationKind: "note_link",
        family: "contextual",
        label: "Notes",
        strength: 0.6,
        directional: false,
        structural: false,
        parallelCount: 1,
        data: []
      },
      attributes: {
        size: 2,
        color: "rgba(45, 212, 191, 0.1)",
        hidden: false,
        label: "Notes",
        forceLabel: false,
        zIndex: 0,
        data: {
          id: "task-note",
          source: "task:task-1",
          target: "note:note-1",
          relationKind: "note_link",
          family: "contextual",
          label: "Notes",
          strength: 0.6,
          directional: false,
          structural: false,
          parallelCount: 1,
          data: []
        }
      }
    });

    expect(firstRingEdge.color).toBe("rgba(125, 211, 252, 0.05)");
    expect(farEdge.color).toBe("rgba(45, 212, 191, 0.016)");
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

  it("builds hop levels across the visible graph for focus-priority layout shells", () => {
    const levels = buildKnowledgeGraphHopLevels(
      [
        baseNode.id,
        "project:project-1",
        "task:task-1",
        "note:note-1",
        "goal:goal-2"
      ],
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
          source: "task:task-1",
          target: "goal:goal-2"
        }
      ],
      baseNode.id
    );

    expect(levels).toEqual([0, 1, 2, -1, 3]);
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

    expect(target?.x).toBeCloseTo(0);
    expect(target?.y).toBeCloseTo(0);
    expect(target?.ratio).toBeGreaterThanOrEqual(0.38);
    expect(target?.ratio).toBeLessThanOrEqual(1.2);
    expect(target?.nodeIds).toEqual([
      baseNode.id,
      "note:note-1",
      "project:project-1",
      "task:task-1"
    ]);
  });

  it("uses the focused node position for camera centering instead of the neighborhood centroid", () => {
    const target = buildKnowledgeGraphFocusCameraTarget({
      positions: new Map([
        [baseNode.id, { x: 5.2, y: -1.4 }],
        ["project:project-1", { x: 10.6, y: 2.8 }],
        ["task:task-1", { x: 12.4, y: 3.5 }],
        ["note:note-1", { x: 9.7, y: -0.6 }]
      ]),
      focusNodeId: baseNode.id,
      firstRingNodeIds: ["note:note-1", "project:project-1"],
      secondRingNodeIds: ["task:task-1"],
      currentRatio: 0.9
    });

    expect(target?.x).toBeCloseTo(5.2);
    expect(target?.y).toBeCloseTo(-1.4);
  });
});
