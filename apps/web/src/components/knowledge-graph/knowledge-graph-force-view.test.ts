import { describe, expect, it } from "vitest";
import {
  advanceKnowledgeGraphAdaptiveQuality,
  beginKnowledgeGraphPresentationRender,
  buildKnowledgeGraphFramedGraphPosition,
  buildKnowledgeGraphFallbackKeyboardPositions,
  buildKnowledgeGraphAdjacency,
  buildKnowledgeGraphFocusCameraTarget,
  buildKnowledgeGraphFocusRings,
  buildKnowledgeGraphFocusRingsFromAdjacency,
  buildKnowledgeGraphHopLevels,
  buildKnowledgeGraphHopLevelsFromAdjacency,
  buildKnowledgeGraphOverviewCameraTarget,
  buildKnowledgeGraphSeedPositions,
  buildKnowledgeGraphSigmaOverviewRatio,
  buildKnowledgeGraphViewportNodeIds,
  buildVisibleRenderedKnowledgeGraphEdgeIds,
  completeKnowledgeGraphPresentationRender,
  isKnowledgeGraphPresentationCompletion,
  resolveKnowledgeGraphRenderQuality,
  resolveKnowledgeGraphKeyboardTarget,
  reduceKnowledgeGraphSigmaEdgeAttributes,
  reduceKnowledgeGraphSigmaNodeAttributes,
  requestKnowledgeGraphPresentation,
  shouldRenderKnowledgeGraphEdgeAtQuality
} from "@/components/knowledge-graph/knowledge-graph-force-view-model";
import {
  createGraphFromData,
  getFallbackOverviewCamera,
  isKnowledgeGraphPositionMessageCurrent
} from "@/components/knowledge-graph/knowledge-graph-renderer-model";
import { buildRenderedKnowledgeGraphEdges } from "@/lib/knowledge-graph";
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
  it("maps visible source relation IDs onto coalesced renderer edge IDs", () => {
    const sourceEdges = [
      {
        id: "structural",
        source: "goal:1",
        target: "project:1",
        relationKind: "goal_project" as const,
        family: "structural" as const,
        label: "Supports",
        strength: 1,
        directional: true,
        structural: true
      },
      {
        id: "contextual",
        source: "goal:1",
        target: "project:1",
        relationKind: "entity_link" as const,
        family: "contextual" as const,
        label: "Related",
        strength: 0.8,
        directional: true,
        structural: false
      }
    ];
    const renderedEdges = buildRenderedKnowledgeGraphEdges(sourceEdges);

    expect(renderedEdges).toHaveLength(1);
    expect(
      buildVisibleRenderedKnowledgeGraphEdgeIds(
        renderedEdges,
        new Set(["contextual"])
      )
    ).toEqual(new Set([renderedEdges[0]!.id]));
    expect(
      buildVisibleRenderedKnowledgeGraphEdgeIds(renderedEdges, new Set())
    ).toEqual(new Set());
  });

  it("adapts presentation quality from observed frame pressure with hysteresis", () => {
    expect(
      resolveKnowledgeGraphRenderQuality({
        currentQuality: "full",
        frameP95Ms: 26,
        interactionActive: true,
        visibleEdgeCount: 4_000
      })
    ).toBe("reduced");
    expect(
      resolveKnowledgeGraphRenderQuality({
        currentQuality: "reduced",
        frameP95Ms: 15,
        interactionActive: false,
        visibleEdgeCount: 4_000
      })
    ).toBe("balanced");
    expect(
      resolveKnowledgeGraphRenderQuality({
        currentQuality: "balanced",
        frameP95Ms: 13,
        interactionActive: false,
        visibleEdgeCount: 4_000
      })
    ).toBe("full");
    expect(
      resolveKnowledgeGraphRenderQuality({
        currentQuality: "full",
        frameP95Ms: 10,
        interactionActive: true,
        visibleEdgeCount: 4_000
      })
    ).toBe("balanced");
  });

  it("requires sustained pressure and sustained health before changing quality", () => {
    const initial = {
      quality: "full" as const,
      pressuredWindows: 0,
      healthyWindows: 0
    };
    const pressuredOnce = advanceKnowledgeGraphAdaptiveQuality(initial, {
      frameP95Ms: 27,
      interactionActive: true,
      visibleEdgeCount: 4_000
    });
    expect(pressuredOnce.quality).toBe("full");
    const pressuredTwice = advanceKnowledgeGraphAdaptiveQuality(pressuredOnce, {
      frameP95Ms: 27,
      interactionActive: true,
      visibleEdgeCount: 4_000
    });
    expect(pressuredTwice.quality).toBe("reduced");
    const healthyOnce = advanceKnowledgeGraphAdaptiveQuality(pressuredTwice, {
      frameP95Ms: 12,
      interactionActive: false,
      visibleEdgeCount: 4_000
    });
    const healthyTwice = advanceKnowledgeGraphAdaptiveQuality(healthyOnce, {
      frameP95Ms: 12,
      interactionActive: false,
      visibleEdgeCount: 4_000
    });
    const healthyThrice = advanceKnowledgeGraphAdaptiveQuality(healthyTwice, {
      frameP95Ms: 12,
      interactionActive: false,
      visibleEdgeCount: 4_000
    });
    expect(healthyOnce.quality).toBe("reduced");
    expect(healthyTwice.quality).toBe("reduced");
    expect(healthyThrice.quality).toBe("balanced");
  });

  it("does not accept an unrelated render as presentation completion", () => {
    expect(
      isKnowledgeGraphPresentationCompletion({
        beforeKey: "query:old",
        requestedKey: "query:old",
        renderedKey: "query:old"
      })
    ).toBe(false);
    expect(
      isKnowledgeGraphPresentationCompletion({
        beforeKey: "query:old",
        requestedKey: "query:new",
        renderedKey: "query:old"
      })
    ).toBe(false);
    expect(
      isKnowledgeGraphPresentationCompletion({
        beforeKey: "query:old",
        requestedKey: "query:new",
        renderedKey: "query:new"
      })
    ).toBe(true);
  });

  it("does not seal a synchronous setGraph render before new reducers begin", () => {
    const oldState = {
      requestedKey: "query:old",
      pendingKey: null,
      renderedKey: "query:old"
    };
    const requested = requestKnowledgeGraphPresentation(oldState, "query:new");
    const synchronousSetGraphRender =
      completeKnowledgeGraphPresentationRender(requested);
    expect(synchronousSetGraphRender.renderedKey).toBe("query:old");

    const reducerReady = beginKnowledgeGraphPresentationRender(
      synchronousSetGraphRender
    );
    const completed = completeKnowledgeGraphPresentationRender(reducerReady);
    expect(completed.renderedKey).toBe("query:new");
    expect(completed.pendingKey).toBeNull();
  });

  it("culls offscreen nodes while preserving selected context", () => {
    const nodes = Array.from({ length: 300 }, (_, index) => ({
      id: `node:${index}`,
      viewportX: index < 10 ? index * 10 : 2_000 + index,
      viewportY: 100
    }));
    const visible = buildKnowledgeGraphViewportNodeIds({
      nodes,
      width: 800,
      height: 600,
      padding: 40,
      preserveNodeIds: new Set(["node:299"])
    });
    expect(visible.size).toBe(11);
    expect(visible.has("node:299")).toBe(true);
    expect(visible.has("node:150")).toBe(false);

    const searchResults = buildKnowledgeGraphViewportNodeIds({
      nodes,
      width: 800,
      height: 600,
      padding: 40,
      preserveNodeIds: new Set(),
      preserveAll: true
    });
    expect(searchResults.size).toBe(300);
    expect(searchResults.has("node:299")).toBe(true);
  });

  it("samples only nonessential edges as quality falls", () => {
    const edges = Array.from({ length: 32 }, (_, index) => ({
      id: `contextual-${index}`,
      source: "goal:1",
      target: `note:${index}`,
      relationKind: "entity_link" as const,
      family: "contextual" as const,
      label: "Related",
      strength: 0.6,
      directional: true,
      structural: false,
      parallelCount: 1,
      data: []
    }));
    const balancedCount = edges.filter((edge) =>
      shouldRenderKnowledgeGraphEdgeAtQuality({
        edge,
        quality: "balanced",
        preserve: false
      })
    ).length;
    const reducedCount = edges.filter((edge) =>
      shouldRenderKnowledgeGraphEdgeAtQuality({
        edge,
        quality: "reduced",
        preserve: false
      })
    ).length;

    expect(balancedCount).toBeGreaterThan(0);
    expect(balancedCount).toBeLessThan(edges.length);
    expect(reducedCount).toBeLessThanOrEqual(balancedCount);
    expect(
      shouldRenderKnowledgeGraphEdgeAtQuality({
        edge: edges[0]!,
        quality: "reduced",
        preserve: true
      })
    ).toBe(true);
    expect(
      shouldRenderKnowledgeGraphEdgeAtQuality({
        edge: { ...edges[0]!, structural: true },
        quality: "reduced",
        preserve: false
      })
    ).toBe(true);
  });

  it("rejects a queued position update after the graph generation or node order changes", () => {
    const message = {
      type: "positions" as const,
      generation: 4,
      tick: 12,
      x: new Float32Array([1, 2]),
      y: new Float32Array([3, 4])
    };
    expect(
      isKnowledgeGraphPositionMessageCurrent({
        message,
        generation: 4,
        nodeCount: 2
      })
    ).toBe(true);
    expect(
      isKnowledgeGraphPositionMessageCurrent({
        message,
        generation: 5,
        nodeCount: 2
      })
    ).toBe(false);
    expect(
      isKnowledgeGraphPositionMessageCurrent({
        message,
        generation: 4,
        nodeCount: 3
      })
    ).toBe(false);
  });
  it("supports bounded keyboard traversal and activation across dense graph nodes", () => {
    const nodeIds = ["goal:1", "project:1", "task:1"];

    expect(
      resolveKnowledgeGraphKeyboardTarget({
        key: "ArrowRight",
        nodeIds,
        focusNodeId: null
      }).targetNodeId
    ).toBe("goal:1");
    expect(
      resolveKnowledgeGraphKeyboardTarget({
        key: "ArrowLeft",
        nodeIds,
        focusNodeId: "goal:1"
      }).targetNodeId
    ).toBe("task:1");
    expect(
      resolveKnowledgeGraphKeyboardTarget({
        key: "End",
        nodeIds,
        focusNodeId: "goal:1"
      }).targetNodeId
    ).toBe("task:1");
    expect(
      resolveKnowledgeGraphKeyboardTarget({
        key: "Escape",
        nodeIds,
        focusNodeId: "project:1"
      })
    ).toEqual({ handled: true, targetNodeId: null });
    expect(
      resolveKnowledgeGraphKeyboardTarget({
        key: "Tab",
        nodeIds,
        focusNodeId: "project:1"
      }).handled
    ).toBe(false);
  });

  it("keeps presentation-hidden fallback nodes in the keyboard position map", () => {
    const positions = buildKnowledgeGraphFallbackKeyboardPositions([
      { id: "goal:visible", viewportX: 0, viewportY: 0 },
      { id: "task:hidden", viewportX: 20, viewportY: 0 }
    ]);

    expect(positions.has("task:hidden")).toBe(true);
    expect(
      resolveKnowledgeGraphKeyboardTarget({
        key: "ArrowRight",
        nodeIds: ["goal:visible", "task:hidden"],
        focusNodeId: "goal:visible",
        nodePositions: positions
      }).targetNodeId
    ).toBe("task:hidden");
  });

  it("uses screen-space direction instead of array order for arrow navigation", () => {
    const nodeIds = ["center", "far-right", "near-up", "near-right", "left"];
    const nodePositions = new Map([
      ["center", { x: 100, y: 100 }],
      ["far-right", { x: 300, y: 100 }],
      ["near-up", { x: 100, y: 40 }],
      ["near-right", { x: 145, y: 105 }],
      ["left", { x: 20, y: 100 }]
    ]);

    expect(
      resolveKnowledgeGraphKeyboardTarget({
        key: "ArrowRight",
        nodeIds,
        focusNodeId: "center",
        nodePositions
      }).targetNodeId
    ).toBe("near-right");
    expect(
      resolveKnowledgeGraphKeyboardTarget({
        key: "ArrowUp",
        nodeIds,
        focusNodeId: "center",
        nodePositions
      }).targetNodeId
    ).toBe("near-up");
    expect(
      resolveKnowledgeGraphKeyboardTarget({
        key: "ArrowLeft",
        nodeIds,
        focusNodeId: "left",
        nodePositions
      }).targetNodeId
    ).toBe("left");
  });

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

  it("resolves graph node colors from body theme tokens before root defaults", () => {
    document.documentElement.style.setProperty(
      "--forge-entity-goal-rgb",
      "1, 2, 3"
    );
    document.body.style.setProperty("--forge-entity-goal-rgb", "10, 20, 30");

    try {
      const graph = createGraphFromData([baseNode], [], new Map());

      expect(graph.getNodeAttribute(baseNode.id, "color")).toBe(
        "rgb(10, 20, 30)"
      );
    } finally {
      document.documentElement.style.removeProperty("--forge-entity-goal-rgb");
      document.body.style.removeProperty("--forge-entity-goal-rgb");
    }
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

  it("exposes important ambient labels without forcing collision overlap", () => {
    const reduced = reduceKnowledgeGraphSigmaNodeAttributes({
      nodeId: baseNode.id,
      node: baseNode,
      focusNodeId: null,
      relatedNodeIds: new Set(),
      detailNodeIds: new Set(),
      hoveredNodeId: null,
      ambientLabelVisible: true,
      attributes: {
        x: 0,
        y: 0,
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

    expect(reduced.label).toBe(baseNode.title);
    expect(reduced.forceLabel).toBe(false);
    expect(reduced.highlighted).toBe(false);
  });

  it("keeps contextual nodes visually present without turning every neighbor into a label", () => {
    const reduced = reduceKnowledgeGraphSigmaNodeAttributes({
      nodeId: baseNode.id,
      node: baseNode,
      focusNodeId: "project:project-1",
      relatedNodeIds: new Set([baseNode.id]),
      detailNodeIds: new Set([baseNode.id]),
      hoveredNodeId: null,
      attributes: {
        x: 0,
        y: 0,
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

    expect(reduced.label).toBe("");
    expect(reduced.forceLabel).toBe(false);
    expect(reduced.highlighted).toBe(false);
    expect(reduced.size).toBeGreaterThan(8);
  });

  it("preserves sigma edge metadata while styling focused relationships", () => {
    document.body.style.setProperty("--info", "#0369a1");
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
    expect(reduced.color).toBe("rgba(3, 105, 161, 0.24)");
    expect(reduced.size).toBeCloseTo(2.36);
    expect(reduced.zIndex).toBe(2);
    document.body.style.removeProperty("--info");
  });

  it("uses softer family-colored edges and light hover emphasis outside direct focus", () => {
    document.body.style.setProperty("--info", "#0369a1");
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

    expect(reduced.color).toBe("rgba(3, 105, 161, 0.14)");
    expect(reduced.size).toBeCloseTo(2.16);
    expect(reduced.zIndex).toBe(1);
    document.body.style.removeProperty("--info");
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
    expect(buildKnowledgeGraphSigmaOverviewRatio(overview.ratio)).toBeCloseTo(
      1.07125
    );
  });

  it("bounds Sigma overview framing so the graph is visible without clipping extremes", () => {
    expect(buildKnowledgeGraphSigmaOverviewRatio(0.72)).toBe(1.02);
    expect(buildKnowledgeGraphSigmaOverviewRatio(2.8)).toBeCloseTo(1.108);
    expect(buildKnowledgeGraphSigmaOverviewRatio(8)).toBe(1.14);
  });

  it("fits the fallback renderer to the available viewport", () => {
    const camera = getFallbackOverviewCamera();

    expect(camera).toMatchObject({ x: 0, y: 0, ratio: 1 });
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
    document.body.style.setProperty("--info", "#0369a1");
    document.body.style.setProperty("--secondary", "#0f8b6d");
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

    expect(firstRingEdge.color).toBe("rgba(3, 105, 161, 0.05)");
    expect(farEdge.color).toBe("rgba(15, 139, 109, 0.016)");
    document.body.style.removeProperty("--info");
    document.body.style.removeProperty("--secondary");
  });

  it("builds deterministic first-ring and second-ring neighborhoods for focus mode", () => {
    const focusEdges = [
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
    ];
    const rings = buildKnowledgeGraphFocusRings(focusEdges, baseNode.id);
    const adjacency = buildKnowledgeGraphAdjacency(
      [baseNode.id, "project:project-1", "task:task-1", "note:note-1"],
      focusEdges
    );

    expect(rings.firstRing).toEqual(["note:note-1", "project:project-1"]);
    expect(rings.secondRing).toEqual(["task:task-1"]);
    expect(
      buildKnowledgeGraphFocusRingsFromAdjacency(adjacency, baseNode.id)
    ).toEqual(rings);
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
    const adjacency = buildKnowledgeGraphAdjacency(
      [
        baseNode.id,
        "project:project-1",
        "task:task-1",
        "note:note-1",
        "goal:goal-2"
      ],
      [
        { source: baseNode.id, target: "project:project-1" },
        { source: "project:project-1", target: "task:task-1" },
        { source: "task:task-1", target: "goal:goal-2" }
      ]
    );
    expect(
      buildKnowledgeGraphHopLevelsFromAdjacency(
        [
          baseNode.id,
          "project:project-1",
          "task:task-1",
          "note:note-1",
          "goal:goal-2"
        ],
        adjacency,
        baseNode.id
      )
    ).toEqual(levels);
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
    expect(target?.ratio).toBeGreaterThanOrEqual(0.38);
    expect(target?.ratio).toBeLessThanOrEqual(1.45);
    expect(target?.nodeIds).toEqual([
      baseNode.id,
      "note:note-1",
      "project:project-1",
      "task:task-1"
    ]);
  });

  it("centers the focused neighborhood so direct context stays in view", () => {
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

    expect(target?.x).toBeCloseTo(8.8);
    expect(target?.y).toBeCloseTo(1.05);
    expect(target?.ratio).toBeCloseTo(1.45);
  });
});
