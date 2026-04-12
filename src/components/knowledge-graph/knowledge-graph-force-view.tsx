import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import FA2LayoutSupervisor from "graphology-layout-forceatlas2/worker";
import Sigma from "sigma";
import type { Attributes } from "graphology-types";
import type { CameraState } from "sigma/types";
import {
  buildKnowledgeGraphFocusCameraTarget,
  buildKnowledgeGraphFocusRings,
  buildKnowledgeGraphSeedPositions,
  reduceKnowledgeGraphSigmaEdgeAttributes,
  reduceKnowledgeGraphSigmaNodeAttributes,
  type KnowledgeGraphSeedPosition
} from "@/components/knowledge-graph/knowledge-graph-force-view-model";
import { EntityBadge } from "@/components/ui/entity-badge";
import {
  buildKnowledgeGraphDatasetSignature,
  buildRenderedKnowledgeGraphEdges,
  getKnowledgeGraphFocusRelatedNodeIds,
  type RenderedKnowledgeGraphEdge
} from "@/lib/knowledge-graph";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode
} from "@/lib/knowledge-graph-types";

type SigmaNodeAttributes = Attributes & {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  hidden: boolean;
  forceLabel: boolean;
  highlighted: boolean;
  zIndex: number;
  data: KnowledgeGraphNode;
};

type SigmaEdgeAttributes = Attributes & {
  size: number;
  color: string;
  hidden: boolean;
  label: string;
  forceLabel: boolean;
  zIndex: number;
  data: RenderedKnowledgeGraphEdge;
};

type PositionSnapshot = {
  x: number;
  y: number;
};

type DragState = {
  nodeId: string;
  offsetX: number;
  offsetY: number;
};

type FallbackGraphNode = SigmaNodeAttributes & {
  id: string;
};

type FallbackGraphSnapshot = {
  nodes: FallbackGraphNode[];
  edges: RenderedKnowledgeGraphEdge[];
};

export type KnowledgeGraphForceViewHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  recenterOnFocus: () => void;
};

type KnowledgeGraphDiagnostics = {
  datasetSignature: string;
  visibleNodeIds: string[];
  visibleNodeCount: number;
  focusedNodeId: string | null;
  draggedNodeId: string | null;
  layoutGeneration: number;
  rendererMode: "sigma" | "fallback";
  camera: CameraState;
  nodeScreenPositions: Record<
    string,
    {
      x: number;
      y: number;
      size: number;
    }
  >;
};

declare global {
  interface Window {
    __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean;
    __FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__?: KnowledgeGraphDiagnostics;
    __FORGE_KNOWLEDGE_GRAPH_TEST_API__?: {
      selectNode: (nodeId: string | null) => void;
      moveNodeBy: (nodeId: string, deltaX: number, deltaY: number) => void;
    };
  }
}

let WEBGL_SUPPORT_CACHE: boolean | null = null;

function resolveGraphColor(token: string | null | undefined) {
  if (!token || typeof window === "undefined") {
    return "#c0c1ff";
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  if (!value) {
    return "#c0c1ff";
  }
  return `rgb(${value})`;
}

function fadeColor(color: string, alpha: number) {
  if (color.startsWith("rgb(") && color.endsWith(")")) {
    return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  }
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const normalized =
      hex.length === 3
        ? hex
            .split("")
            .map((part) => `${part}${part}`)
            .join("")
        : hex;
    const red = parseInt(normalized.slice(0, 2), 16);
    const green = parseInt(normalized.slice(2, 4), 16);
    const blue = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  return color;
}

function rememberGraphPositions(
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  cache: Map<string, PositionSnapshot>
) {
  graph.forEachNode((node) => {
    const attributes = graph.getNodeAttributes(node);
    if (
      Number.isFinite(attributes.x) &&
      Number.isFinite(attributes.y)
    ) {
      cache.set(node, {
        x: attributes.x,
        y: attributes.y
      });
    }
  });
}

function shouldPublishKnowledgeGraphDiagnostics() {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.__FORGE_ENABLE_GRAPH_DIAGNOSTICS__) {
    return true;
  }
  try {
    return (
      new URLSearchParams(window.location.search).get("graphDiagnostics") === "1"
    );
  } catch {
    return false;
  }
}

function clearKnowledgeGraphDiagnostics() {
  if (typeof window === "undefined") {
    return;
  }
  delete window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__;
  delete window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__;
}

function canUseWebGL() {
  if (WEBGL_SUPPORT_CACHE !== null) {
    return WEBGL_SUPPORT_CACHE;
  }
  if (typeof document === "undefined") {
    WEBGL_SUPPORT_CACHE = false;
    return false;
  }
  const canvas = document.createElement("canvas");
  WEBGL_SUPPORT_CACHE = Boolean(
    canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
  );
  return WEBGL_SUPPORT_CACHE;
}

function getGraphBoundsFromSnapshot(snapshot: FallbackGraphSnapshot) {
  if (snapshot.nodes.length === 0) {
    return {
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of snapshot.nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }

  return {
    minX,
    maxX,
    minY,
    maxY
  };
}

function getFallbackCameraForSnapshot(snapshot: FallbackGraphSnapshot): CameraState {
  const bounds = getGraphBoundsFromSnapshot(snapshot);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    angle: 0,
    ratio: 1
  };
}

function projectFallbackNode({
  node,
  snapshot,
  camera,
  width,
  height
}: {
  node: FallbackGraphNode;
  snapshot: FallbackGraphSnapshot;
  camera: CameraState;
  width: number;
  height: number;
}) {
  const bounds = getGraphBoundsFromSnapshot(snapshot);
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const padding = 28;
  const baseScale = Math.min(
    Math.max(1, width - padding * 2) / spanX,
    Math.max(1, height - padding * 2) / spanY
  );
  const scale = baseScale / Math.max(camera.ratio, 0.08);

  return {
    x: width / 2 + (node.x - camera.x) * scale,
    y: height / 2 - (node.y - camera.y) * scale,
    size: Math.max(4, node.size * scale * 0.12)
  };
}

function publishKnowledgeGraphDiagnostics({
  datasetSignature,
  focusNodeId,
  draggedNodeId,
  graph,
  layoutGeneration,
  sigma
}: {
  datasetSignature: string;
  focusNodeId: string | null;
  draggedNodeId: string | null;
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>;
  layoutGeneration: number;
  sigma: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>;
}) {
  if (!shouldPublishKnowledgeGraphDiagnostics()) {
    clearKnowledgeGraphDiagnostics();
    return;
  }

  const visibleNodeIds: string[] = [];
  const nodeScreenPositions: KnowledgeGraphDiagnostics["nodeScreenPositions"] = {};

  graph.forEachNode((node) => {
    visibleNodeIds.push(node);
    const attributes = graph.getNodeAttributes(node);
    const displayData = sigma.getNodeDisplayData(node);
    const viewport = sigma.graphToViewport({
      x: attributes.x,
      y: attributes.y
    });
    nodeScreenPositions[node] = {
      x: viewport.x,
      y: viewport.y,
      size: displayData?.size ?? attributes.size
    };
  });

  window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__ = {
    datasetSignature,
    visibleNodeIds,
    visibleNodeCount: visibleNodeIds.length,
    focusedNodeId: focusNodeId,
    draggedNodeId,
    layoutGeneration,
    rendererMode: "sigma",
    camera: sigma.getCamera().getState(),
    nodeScreenPositions
  };
}

function publishFallbackKnowledgeGraphDiagnostics({
  datasetSignature,
  focusNodeId,
  draggedNodeId,
  layoutGeneration,
  camera,
  snapshot,
  width,
  height
}: {
  datasetSignature: string;
  focusNodeId: string | null;
  draggedNodeId: string | null;
  layoutGeneration: number;
  camera: CameraState;
  snapshot: FallbackGraphSnapshot;
  width: number;
  height: number;
}) {
  if (!shouldPublishKnowledgeGraphDiagnostics()) {
    clearKnowledgeGraphDiagnostics();
    return;
  }

  const visibleNodeIds = snapshot.nodes.map((node) => node.id);
  const nodeScreenPositions: KnowledgeGraphDiagnostics["nodeScreenPositions"] = {};

  for (const node of snapshot.nodes) {
    const position = projectFallbackNode({
      node,
      snapshot,
      camera,
      width,
      height
    });
    nodeScreenPositions[node.id] = position;
  }

  window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__ = {
    datasetSignature,
    visibleNodeIds,
    visibleNodeCount: visibleNodeIds.length,
    focusedNodeId: focusNodeId,
    draggedNodeId,
    layoutGeneration,
    rendererMode: "fallback",
    camera,
    nodeScreenPositions
  };
}

function isContainerReady(
  container: HTMLDivElement | null,
  size: { width: number; height: number }
) {
  if (!container) {
    return false;
  }
  return (
    container.isConnected &&
    size.width > 0 &&
    size.height > 0 &&
    container.getClientRects().length > 0
  );
}

function getWarmStartIterations(nodeCount: number) {
  return Math.max(14, Math.min(36, Math.round(Math.sqrt(nodeCount) * 2.5)));
}

function getKnowledgeGraphLayoutSettings({
  nodeCount,
  dragging
}: {
  nodeCount: number;
  dragging: boolean;
}) {
  return {
    ...forceAtlas2.inferSettings(nodeCount),
    gravity: dragging ? 0.32 : 0.22,
    slowDown: dragging ? 2.6 : 7.2,
    scalingRatio: dragging ? 3.4 : 2.6,
    strongGravityMode: false,
    barnesHutOptimize: nodeCount > 120,
    barnesHutTheta: 0.7
  };
}

function applyWarmStartLayout(
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  nodeCount: number
) {
  if (graph.order <= 1) {
    return;
  }
  forceAtlas2.assign(graph, {
    iterations: getWarmStartIterations(nodeCount),
    settings: getKnowledgeGraphLayoutSettings({
      nodeCount,
      dragging: false
    })
  });
}

function createGraphFromData(
  nodes: KnowledgeGraphNode[],
  edges: RenderedKnowledgeGraphEdge[],
  cache: Map<string, PositionSnapshot>
) {
  const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const nodeOrder = [...nodes].sort(
    (left, right) =>
      right.importance - left.importance ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id)
  );
  const seedPositions = buildKnowledgeGraphSeedPositions({
    nodes: nodeOrder,
    cache: cache as Map<string, KnowledgeGraphSeedPosition>
  });

  nodeOrder.forEach((node) => {
    const seeded = seedPositions.get(node.id);
    graph.addNode(node.id, {
      x: seeded?.x ?? 0,
      y: seeded?.y ?? 0,
      size: Math.max(2.5, node.size / 14),
      color: resolveGraphColor(node.accentToken),
      label: node.title,
      hidden: false,
      forceLabel: false,
      highlighted: false,
      zIndex: 0,
      data: node
    });
  });

  edges.forEach((edge) => {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      return;
    }
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      size: Math.max(0.8, edge.strength * 1.6),
      color: "rgba(255,255,255,0.14)",
      label: edge.label,
      hidden: false,
      forceLabel: false,
      zIndex: 0,
      data: edge
    });
  });

  return graph;
}

function buildPositionMapFromGraph(
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>
) {
  const positions = new Map<string, PositionSnapshot>();
  graph.forEachNode((nodeId) => {
    const attributes = graph.getNodeAttributes(nodeId);
    positions.set(nodeId, {
      x: attributes.x,
      y: attributes.y
    });
  });
  return positions;
}

function redistributeFocusNeighborhood({
  graph,
  edges,
  focusNodeId,
  cache
}: {
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>;
  edges: RenderedKnowledgeGraphEdge[];
  focusNodeId: string;
  cache: Map<string, PositionSnapshot>;
}) {
  if (!graph.hasNode(focusNodeId)) {
    return null;
  }

  const focusNode = graph.getNodeAttributes(focusNodeId);
  const { firstRing, secondRing } = buildKnowledgeGraphFocusRings(edges, focusNodeId);
  const positionNodes = (nodeIds: string[], radius: number, angleOffset: number) => {
    nodeIds.forEach((nodeId, index) => {
      if (!graph.hasNode(nodeId)) {
        return;
      }
      const angle =
        angleOffset + (index / Math.max(nodeIds.length, 1)) * Math.PI * 2;
      const x = focusNode.x + Math.cos(angle) * radius;
      const y = focusNode.y + Math.sin(angle) * radius;
      graph.mergeNodeAttributes(nodeId, { x, y });
      cache.set(nodeId, { x, y });
    });
  };

  positionNodes(firstRing, 0.95, -Math.PI / 2);
  positionNodes(secondRing, 1.8, -Math.PI / 3);
  cache.set(focusNodeId, {
    x: focusNode.x,
    y: focusNode.y
  });

  return {
    firstRing,
    secondRing
  };
}

function buildFallbackSnapshot(
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  edges: RenderedKnowledgeGraphEdge[]
) {
  return {
    nodes: graph.nodes().map((nodeId) => ({
      id: nodeId,
      ...graph.getNodeAttributes(nodeId)
    })),
    edges
  } satisfies FallbackGraphSnapshot;
}

export const KnowledgeGraphForceView = forwardRef<
  KnowledgeGraphForceViewHandle,
  {
    nodes: KnowledgeGraphNode[];
    edges: KnowledgeGraphEdge[];
    focusNodeId: string | null;
    onSelectNode: (node: KnowledgeGraphNode | null) => void;
  }
>(function KnowledgeGraphForceView(
  { nodes, edges, focusNodeId, onSelectNode },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(
    null
  );
  const graphRef = useRef<Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(
    null
  );
  const layoutRef = useRef<FA2LayoutSupervisor | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const positionCacheRef = useRef<Map<string, PositionSnapshot>>(new Map());
  const cameraStateCacheRef = useRef<Map<string, CameraState>>(new Map());
  const nodeMapRef = useRef<Map<string, KnowledgeGraphNode>>(new Map());
  const onSelectNodeRef = useRef(onSelectNode);
  const focusNodeIdRef = useRef<string | null>(focusNodeId);
  const datasetSignatureRef = useRef<string | null>(null);
  const layoutGenerationRef = useRef(0);
  const dragStateRef = useRef<DragState | null>(null);
  const previousPanningEnabledRef = useRef(true);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [fallbackCamera, setFallbackCamera] = useState<CameraState>({
    x: 0,
    y: 0,
    angle: 0,
    ratio: 1
  });
  const [fallbackSnapshot, setFallbackSnapshot] =
    useState<FallbackGraphSnapshot | null>(null);
  const [containerSize, setContainerSize] = useState({
    width: 0,
    height: 0
  });

  const renderedEdges = useMemo(() => buildRenderedKnowledgeGraphEdges(edges), [edges]);
  const datasetSignature = useMemo(
    () => buildKnowledgeGraphDatasetSignature(nodes, edges),
    [edges, nodes]
  );
  const graphDatasetRef = useRef<{
    nodes: KnowledgeGraphNode[];
    renderedEdges: RenderedKnowledgeGraphEdge[];
    datasetSignature: string;
  } | null>(null);
  if (graphDatasetRef.current?.datasetSignature !== datasetSignature) {
    graphDatasetRef.current = {
      nodes,
      renderedEdges,
      datasetSignature
    };
  }
  const graphDataset = graphDatasetRef.current;
  const relatedNodeIds = useMemo(
    () => getKnowledgeGraphFocusRelatedNodeIds(focusNodeId, edges),
    [edges, focusNodeId]
  );
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const hoveredNode = hoveredNodeId ? nodeMap.get(hoveredNodeId) ?? null : null;

  const stopLayout = () => {
    if (settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (!layoutRef.current) {
      return;
    }
    const supervisor = layoutRef.current as FA2LayoutSupervisor & {
      stop: () => void;
    };
    supervisor.stop();
  };

  const restartLayout = ({
    dragging,
    durationMs
  }: {
    dragging: boolean;
    durationMs?: number;
  }) => {
    if (!layoutRef.current || !graphRef.current) {
      return;
    }
    stopLayout();
    const supervisor = layoutRef.current as FA2LayoutSupervisor & {
      settings: Record<string, unknown>;
      start: () => void;
      stop: () => void;
    };
    Object.assign(
      supervisor.settings,
      getKnowledgeGraphLayoutSettings({
        nodeCount: graphRef.current.order,
        dragging
      })
    );
    supervisor.start();
    if (!durationMs) {
      return;
    }
    settleTimerRef.current = window.setTimeout(() => {
      if (!graphRef.current) {
        return;
      }
      rememberGraphPositions(graphRef.current, positionCacheRef.current);
      supervisor.stop();
      settleTimerRef.current = null;
      if (sigmaRef.current && datasetSignatureRef.current) {
        cameraStateCacheRef.current.set(
          datasetSignatureRef.current,
          sigmaRef.current.getCamera().getState()
        );
        publishKnowledgeGraphDiagnostics({
          datasetSignature: datasetSignatureRef.current,
          focusNodeId: focusNodeIdRef.current,
          draggedNodeId: dragStateRef.current?.nodeId ?? null,
          graph: graphRef.current,
          layoutGeneration: layoutGenerationRef.current,
          sigma: sigmaRef.current
        });
      }
    }, durationMs);
  };

  useEffect(() => {
    onSelectNodeRef.current = onSelectNode;
  }, [onSelectNode]);

  useEffect(() => {
    focusNodeIdRef.current = focusNodeId;
  }, [focusNodeId]);

  useEffect(() => {
    if (!shouldPublishKnowledgeGraphDiagnostics() || typeof window === "undefined") {
      return;
    }
    window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__ = {
      selectNode: (nodeId) => {
        const nextNode = nodeId ? nodeMapRef.current.get(nodeId) ?? null : null;
        onSelectNodeRef.current(nextNode);
      },
      moveNodeBy: (nodeId, deltaX, deltaY) => {
        if (!graphRef.current?.hasNode(nodeId)) {
          return;
        }
        const current = graphRef.current.getNodeAttributes(nodeId);
        const nextX = current.x + deltaX;
        const nextY = current.y + deltaY;
        graphRef.current.mergeNodeAttributes(nodeId, {
          x: nextX,
          y: nextY
        });
        positionCacheRef.current.set(nodeId, {
          x: nextX,
          y: nextY
        });
        if (sigmaRef.current) {
          sigmaRef.current.refresh();
          return;
        }
        setFallbackSnapshot((currentSnapshot) => {
          if (!currentSnapshot) {
            return currentSnapshot;
          }
          return {
            ...currentSnapshot,
            nodes: currentSnapshot.nodes.map((node) =>
              node.id === nodeId
                ? {
                    ...node,
                    x: nextX,
                    y: nextY
                  }
                : node
            )
          };
        });
      }
    };
    return () => {
      if (window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__) {
        delete window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__;
      }
    };
  }, [fallbackReason, graphDataset?.datasetSignature]);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateSize = () => {
      if (!containerRef.current) {
        return;
      }
      setContainerSize({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight
      });
    };

    updateSize();
    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        if (sigmaRef.current) {
          void sigmaRef.current
            .getCamera()
            .animatedZoom({ factor: 1.25, duration: 180 });
          return;
        }
        setFallbackCamera((current) => ({
          ...current,
          ratio: Math.max(0.08, current.ratio * 0.82)
        }));
      },
      zoomOut: () => {
        if (sigmaRef.current) {
          void sigmaRef.current.getCamera().animatedUnzoom({
            factor: 1.25,
            duration: 180
          });
          return;
        }
        setFallbackCamera((current) => ({
          ...current,
          ratio: Math.min(4, current.ratio * 1.22)
        }));
      },
      fit: () => {
        if (sigmaRef.current) {
          void sigmaRef.current.getCamera().animatedReset({ duration: 240 });
          return;
        }
        if (fallbackSnapshot) {
          setFallbackCamera(getFallbackCameraForSnapshot(fallbackSnapshot));
        }
      },
      recenterOnFocus: () => {
        if (!focusNodeIdRef.current || !graphRef.current) {
          return;
        }
        if (!graphRef.current.hasNode(focusNodeIdRef.current)) {
          return;
        }
        const focusRings = buildKnowledgeGraphFocusRings(
          renderedEdges,
          focusNodeIdRef.current
        );
        const cameraTarget = buildKnowledgeGraphFocusCameraTarget({
          positions: buildPositionMapFromGraph(graphRef.current),
          focusNodeId: focusNodeIdRef.current,
          firstRingNodeIds: focusRings.firstRing,
          secondRingNodeIds: focusRings.secondRing,
          currentRatio: sigmaRef.current
            ? sigmaRef.current.getCamera().getState().ratio
            : fallbackCamera.ratio
        });
        if (!cameraTarget) {
          return;
        }
        if (sigmaRef.current) {
          const camera = sigmaRef.current.getCamera();
          void camera.animate(
            {
              x: cameraTarget.x,
              y: cameraTarget.y,
              ratio: cameraTarget.ratio
            },
            { duration: 260 }
          );
          return;
        }
        setFallbackCamera((current) => ({
          ...current,
          x: cameraTarget.x,
          y: cameraTarget.y,
          ratio: cameraTarget.ratio
        }));
      }
    }),
    [fallbackCamera.ratio, renderedEdges]
  );

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      if (graphRef.current) {
        rememberGraphPositions(graphRef.current, positionCacheRef.current);
      }
      if (sigmaRef.current && datasetSignatureRef.current) {
        cameraStateCacheRef.current.set(
          datasetSignatureRef.current,
          sigmaRef.current.getCamera().getState()
        );
      }
      layoutRef.current?.kill();
      layoutRef.current = null;
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      clearKnowledgeGraphDiagnostics();
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!graphDataset || !isContainerReady(container, containerSize)) {
      return;
    }

    const sameDataset =
      datasetSignatureRef.current === graphDataset.datasetSignature &&
      graphRef.current !== null;
    if (sameDataset) {
      const currentGraph = graphRef.current;
      if (!currentGraph) {
        return;
      }
      if (sigmaRef.current) {
        sigmaRef.current.resize();
        sigmaRef.current.refresh();
        publishKnowledgeGraphDiagnostics({
          datasetSignature: graphDataset.datasetSignature,
          focusNodeId: focusNodeIdRef.current,
          draggedNodeId: dragStateRef.current?.nodeId ?? null,
          graph: currentGraph,
          layoutGeneration: layoutGenerationRef.current,
          sigma: sigmaRef.current
        });
      } else if (fallbackSnapshot && datasetSignatureRef.current) {
        publishFallbackKnowledgeGraphDiagnostics({
          datasetSignature: datasetSignatureRef.current,
          focusNodeId: focusNodeIdRef.current,
          draggedNodeId: null,
          layoutGeneration: layoutGenerationRef.current,
          camera: fallbackCamera,
          snapshot: fallbackSnapshot,
          width: containerSize.width,
          height: containerSize.height
        });
      }
      return;
    }

    if (graphRef.current) {
      rememberGraphPositions(graphRef.current, positionCacheRef.current);
    }
    if (sigmaRef.current && datasetSignatureRef.current) {
      cameraStateCacheRef.current.set(
        datasetSignatureRef.current,
        sigmaRef.current.getCamera().getState()
      );
    }
    layoutRef.current?.kill();
    layoutRef.current = null;

    const nextGraph = createGraphFromData(
      graphDataset.nodes,
      graphDataset.renderedEdges,
      positionCacheRef.current
    );
    const cachedPositionCount = graphDataset.nodes.filter((node) =>
      positionCacheRef.current.has(node.id)
    ).length;
    if (cachedPositionCount < Math.ceil(graphDataset.nodes.length * 0.55)) {
      applyWarmStartLayout(nextGraph, graphDataset.nodes.length);
    }
    rememberGraphPositions(nextGraph, positionCacheRef.current);
    const nextFallbackSnapshot = buildFallbackSnapshot(
      nextGraph,
      graphDataset.renderedEdges
    );
    graphRef.current = nextGraph;
    nodeMapRef.current = new Map(
      graphDataset.nodes.map((node) => [node.id, node])
    );
    datasetSignatureRef.current = graphDataset.datasetSignature;
    layoutGenerationRef.current += 1;
    setFallbackSnapshot(nextFallbackSnapshot);

    if (!canUseWebGL()) {
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      setFallbackReason("WebGL is unavailable in this browser context.");
      setFallbackCamera(getFallbackCameraForSnapshot(nextFallbackSnapshot));
      return;
    }

    try {
      if (!sigmaRef.current) {
        if (!container) {
          return;
        }
        sigmaRef.current = new Sigma(nextGraph, container, {
          renderEdgeLabels: false,
          hideEdgesOnMove: false,
          hideLabelsOnMove: true,
          labelRenderedSizeThreshold: 18,
          labelDensity: 0.08,
          labelGridCellSize: 120,
          defaultNodeColor: "#c0c1ff",
          defaultEdgeColor: "rgba(255,255,255,0.16)",
          minCameraRatio: 0.08,
          maxCameraRatio: 4,
          enableEdgeEvents: false,
          enableCameraPanning: true,
          zIndex: true
        });

        sigmaRef.current.on("clickNode", ({ node }) => {
          const nextNode = nodeMapRef.current.get(node) ?? null;
          if (!nextNode) {
            return;
          }
          onSelectNodeRef.current(nextNode);
        });
        sigmaRef.current.on("clickStage", () => {
          onSelectNodeRef.current(null);
        });
        sigmaRef.current.on("downNode", ({ node, event, preventSigmaDefault }) => {
          if (!sigmaRef.current || !graphRef.current?.hasNode(node)) {
            return;
          }
          preventSigmaDefault();
          const graphPosition = sigmaRef.current.viewportToGraph({
            x: event.x,
            y: event.y
          });
          const current = graphRef.current.getNodeAttributes(node);
          dragStateRef.current = {
            nodeId: node,
            offsetX: current.x - graphPosition.x,
            offsetY: current.y - graphPosition.y
          };
      previousPanningEnabledRef.current =
            sigmaRef.current.getSetting("enableCameraPanning") ?? true;
          sigmaRef.current.setSetting("enableCameraPanning", false);
          setDraggedNodeId(node);
          setHoveredNodeId(node);
          restartLayout({ dragging: true });
        });
        sigmaRef.current.on("moveBody", ({ event, preventSigmaDefault }) => {
          if (!sigmaRef.current || !graphRef.current || !dragStateRef.current) {
            return;
          }
          preventSigmaDefault();
          const graphPosition = sigmaRef.current.viewportToGraph({
            x: event.x,
            y: event.y
          });
          const nextX = graphPosition.x + dragStateRef.current.offsetX;
          const nextY = graphPosition.y + dragStateRef.current.offsetY;
          graphRef.current.mergeNodeAttributes(dragStateRef.current.nodeId, {
            x: nextX,
            y: nextY
          });
          positionCacheRef.current.set(dragStateRef.current.nodeId, {
            x: nextX,
            y: nextY
          });
          sigmaRef.current.refresh();
        });
        const releaseDraggedNode = () => {
          if (!sigmaRef.current) {
            dragStateRef.current = null;
            setDraggedNodeId(null);
            return;
          }
          sigmaRef.current.setSetting(
            "enableCameraPanning",
            previousPanningEnabledRef.current
          );
          dragStateRef.current = null;
          setDraggedNodeId(null);
          restartLayout({ dragging: false, durationMs: 900 });
        };
        sigmaRef.current.on("upNode", releaseDraggedNode);
        sigmaRef.current.on("upStage", releaseDraggedNode);
        sigmaRef.current.on("leaveStage", releaseDraggedNode);
        sigmaRef.current.on("enterNode", ({ node }) => {
          setHoveredNodeId(node);
        });
        sigmaRef.current.on("leaveNode", () => {
          setHoveredNodeId(null);
        });
        sigmaRef.current.on("afterRender", () => {
          if (!graphRef.current || !sigmaRef.current || !datasetSignatureRef.current) {
            return;
          }
          publishKnowledgeGraphDiagnostics({
            datasetSignature: datasetSignatureRef.current,
            focusNodeId: focusNodeIdRef.current,
            draggedNodeId: dragStateRef.current?.nodeId ?? null,
            graph: graphRef.current,
            layoutGeneration: layoutGenerationRef.current,
            sigma: sigmaRef.current
          });
        });
      } else {
        sigmaRef.current.setGraph(nextGraph);
        sigmaRef.current.refresh();
      }

      setFallbackReason(null);

      const cachedCameraState = cameraStateCacheRef.current.get(
        graphDataset.datasetSignature
      );
      if (cachedCameraState) {
        sigmaRef.current.getCamera().setState(cachedCameraState);
      }

      if (nextGraph.order > 1) {
        layoutRef.current = new FA2LayoutSupervisor(nextGraph, {
          settings: getKnowledgeGraphLayoutSettings({
            nodeCount: nextGraph.order,
            dragging: false
          })
        });
        restartLayout({ dragging: false, durationMs: 2200 });
      }

      if (sigmaRef.current && !cachedCameraState) {
        if (focusNodeId && nextGraph.hasNode(focusNodeId)) {
          const attributes = nextGraph.getNodeAttributes(focusNodeId);
          void sigmaRef.current.getCamera().animate(
            {
              x: attributes.x,
              y: attributes.y,
              ratio: 0.42
            },
            { duration: 260 }
          );
        } else {
          void sigmaRef.current.getCamera().animatedReset({ duration: 260 });
        }
      }
    } catch (error) {
      layoutRef.current?.kill();
      layoutRef.current = null;
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      clearKnowledgeGraphDiagnostics();
      setFallbackReason(
        error instanceof Error ? error.message : "Graph renderer unavailable."
      );
      setFallbackCamera(getFallbackCameraForSnapshot(nextFallbackSnapshot));
      return;
    }
  }, [
    containerSize.height,
    containerSize.width,
    fallbackCamera,
    fallbackSnapshot,
    graphDataset
  ]);

  useEffect(() => {
    if (!focusNodeId || !graphRef.current) {
      stopLayout();
      if (sigmaRef.current && graphRef.current && datasetSignatureRef.current) {
        publishKnowledgeGraphDiagnostics({
          datasetSignature: datasetSignatureRef.current,
          focusNodeId: null,
          draggedNodeId: dragStateRef.current?.nodeId ?? null,
          graph: graphRef.current,
          layoutGeneration: layoutGenerationRef.current,
          sigma: sigmaRef.current
        });
      }
      if (!focusNodeId && fallbackSnapshot) {
        setFallbackCamera(getFallbackCameraForSnapshot(fallbackSnapshot));
      }
      return;
    }
    if (!graphRef.current.hasNode(focusNodeId)) {
      return;
    }
    stopLayout();
    const focusRings = redistributeFocusNeighborhood({
      graph: graphRef.current,
      edges: renderedEdges,
      focusNodeId,
      cache: positionCacheRef.current
    });
    rememberGraphPositions(graphRef.current, positionCacheRef.current);
    const nextFallbackSnapshot = buildFallbackSnapshot(graphRef.current, renderedEdges);
    setFallbackSnapshot(nextFallbackSnapshot);
    const cameraTarget = focusRings
      ? buildKnowledgeGraphFocusCameraTarget({
          positions: buildPositionMapFromGraph(graphRef.current),
          focusNodeId,
          firstRingNodeIds: focusRings.firstRing,
          secondRingNodeIds: focusRings.secondRing,
          currentRatio: sigmaRef.current
            ? sigmaRef.current.getCamera().getState().ratio
            : fallbackCamera.ratio
        })
      : null;
    if (!sigmaRef.current) {
      setFallbackCamera((current) => ({
        ...current,
        x: cameraTarget?.x ?? current.x,
        y: cameraTarget?.y ?? current.y,
        ratio: cameraTarget?.ratio ?? current.ratio
      }));
      return;
    }
    sigmaRef.current.refresh();
    if (cameraTarget) {
      void sigmaRef.current.getCamera().animate(
        {
          x: cameraTarget.x,
          y: cameraTarget.y,
          ratio: cameraTarget.ratio
        },
        { duration: 260 }
      );
    }
    restartLayout({ dragging: false, durationMs: 900 });
    if (datasetSignatureRef.current) {
      publishKnowledgeGraphDiagnostics({
        datasetSignature: datasetSignatureRef.current,
        focusNodeId,
        draggedNodeId: dragStateRef.current?.nodeId ?? null,
        graph: graphRef.current,
        layoutGeneration: layoutGenerationRef.current,
        sigma: sigmaRef.current
      });
    }
  }, [focusNodeId, renderedEdges]);

  useEffect(() => {
    if (!sigmaRef.current || !graphRef.current) {
      return;
    }

    const sigma = sigmaRef.current;
    sigma.setSetting("nodeReducer", (node, attributes) => {
      const data = graphRef.current?.getNodeAttribute(node, "data") as KnowledgeGraphNode;
      return reduceKnowledgeGraphSigmaNodeAttributes({
        nodeId: node,
        attributes: attributes as SigmaNodeAttributes,
        node: data,
        focusNodeId,
        relatedNodeIds,
        hoveredNodeId,
        draggedNodeId
      });
    });
    sigma.setSetting("edgeReducer", (edge, attributes) => {
      const data = graphRef.current?.getEdgeAttribute(
        edge,
        "data"
      ) as RenderedKnowledgeGraphEdge;
      return reduceKnowledgeGraphSigmaEdgeAttributes({
        attributes: attributes as SigmaEdgeAttributes,
        edge: data,
        focusNodeId,
        relatedNodeIds
      });
    });
    sigma.refresh();
  }, [draggedNodeId, focusNodeId, hoveredNodeId, relatedNodeIds]);

  useEffect(() => {
    if (
      !fallbackSnapshot ||
      !datasetSignatureRef.current ||
      containerSize.width <= 0 ||
      containerSize.height <= 0
    ) {
      return;
    }
    if (!fallbackReason && sigmaRef.current) {
      return;
    }
    publishFallbackKnowledgeGraphDiagnostics({
      datasetSignature: datasetSignatureRef.current,
      focusNodeId,
      draggedNodeId: null,
      layoutGeneration: layoutGenerationRef.current,
      camera: fallbackCamera,
      snapshot: fallbackSnapshot,
      width: containerSize.width,
      height: containerSize.height
    });
  }, [
    containerSize.height,
    containerSize.width,
    fallbackCamera,
    fallbackReason,
    fallbackSnapshot,
    focusNodeId
  ]);

  const fallbackProjectedNodes = useMemo(() => {
    if (
      !fallbackSnapshot ||
      containerSize.width <= 0 ||
      containerSize.height <= 0
    ) {
      return [] as Array<
        FallbackGraphNode & {
          viewportX: number;
          viewportY: number;
          viewportSize: number;
        }
      >;
    }

    return fallbackSnapshot.nodes.map((node) => {
      const projected = projectFallbackNode({
        node,
        snapshot: fallbackSnapshot,
        camera: fallbackCamera,
        width: containerSize.width,
        height: containerSize.height
      });
      return {
        ...node,
        viewportX: projected.x,
        viewportY: projected.y,
        viewportSize: projected.size
      };
    });
  }, [containerSize.height, containerSize.width, fallbackCamera, fallbackSnapshot]);

  const fallbackNodeMap = useMemo(
    () => new Map(fallbackProjectedNodes.map((node) => [node.id, node])),
    [fallbackProjectedNodes]
  );

  return (
    <div className="relative min-h-[calc(100dvh-10rem)] w-full overflow-hidden bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.1),transparent_34%),linear-gradient(180deg,rgba(7,12,23,0.98),rgba(6,11,20,0.98))]">
      {hoveredNode ? (
        <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-[18rem] rounded-[20px] border border-white/10 bg-[rgba(9,14,24,0.92)] px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
            Graph node
          </div>
          <div className="mt-2">
            <EntityBadge
              kind={hoveredNode.entityKind}
              label={hoveredNode.entityKind.replaceAll("_", " ")}
              compact
              gradient={false}
            />
            <div className="mt-2 text-sm font-semibold text-white">
              {hoveredNode.title}
            </div>
            {hoveredNode.subtitle ? (
              <div className="mt-1 text-xs text-white/56">
                {hoveredNode.subtitle}
              </div>
            ) : null}
            {hoveredNode.description ? (
              <div className="mt-2 text-xs leading-5 text-white/62">
                {hoveredNode.description}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        ref={containerRef}
        className="min-h-[calc(100dvh-10rem)] w-full touch-none"
        aria-label="Knowledge graph canvas"
      >
        {fallbackReason && fallbackSnapshot ? (
          <svg
            className="h-full w-full"
            viewBox={`0 0 ${Math.max(containerSize.width, 1)} ${Math.max(containerSize.height, 1)}`}
            aria-hidden="true"
          >
            <title>Knowledge graph fallback canvas</title>
            <rect
              x="0"
              y="0"
              width={Math.max(containerSize.width, 1)}
              height={Math.max(containerSize.height, 1)}
              fill="transparent"
              onClick={() => onSelectNodeRef.current(null)}
            />
            {fallbackSnapshot.edges.map((edge) => {
              const source = fallbackNodeMap.get(edge.source);
              const target = fallbackNodeMap.get(edge.target);
              if (!source || !target) {
                return null;
              }
              const touchesFocus =
                !!focusNodeId &&
                (edge.source === focusNodeId || edge.target === focusNodeId);
              const inNeighborhood =
                !focusNodeId ||
                (relatedNodeIds.has(edge.source) && relatedNodeIds.has(edge.target));
              return (
                <line
                  key={edge.id}
                  x1={source.viewportX}
                  y1={source.viewportY}
                  x2={target.viewportX}
                  y2={target.viewportY}
                  stroke={
                    touchesFocus
                      ? "rgba(238,242,255,0.62)"
                      : inNeighborhood
                        ? "rgba(255,255,255,0.18)"
                        : "rgba(255,255,255,0.04)"
                  }
                  strokeWidth={touchesFocus ? 2.5 : 1.4}
                />
              );
            })}
            {fallbackProjectedNodes.map((node) => {
              const focused = focusNodeId === node.id;
              const related = relatedNodeIds.has(node.id);
              const hovered = hoveredNodeId === node.id;
              const inNeighborhood = !focusNodeId || related;
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.viewportX}, ${node.viewportY})`}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    const nextNode = nodeMapRef.current.get(node.id) ?? null;
                    onSelectNodeRef.current(nextNode);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    r={
                      focused
                        ? node.viewportSize * 1.8
                        : hovered
                          ? node.viewportSize * 1.35
                          : related
                            ? node.viewportSize * 1.16
                            : node.viewportSize
                    }
                    fill={
                      inNeighborhood ? node.color : fadeColor(node.color, 0.18)
                    }
                    stroke={focused ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.12)"}
                    strokeWidth={focused ? 2 : 1}
                  />
                  {(focused || hovered || related) && (
                    <text
                      x={node.viewportSize * 1.6}
                      y={4}
                      fill="rgba(244,247,255,0.92)"
                      fontSize="12"
                    >
                      {node.data.title}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        ) : null}
      </div>
    </div>
  );
});
