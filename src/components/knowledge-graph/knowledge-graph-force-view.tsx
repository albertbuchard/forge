import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import Graph from "graphology";
import type { Attributes } from "graphology-types";
import Sigma from "sigma";
import type { CameraState } from "sigma/types";
import {
  buildKnowledgeGraphFramedGraphPosition,
  buildKnowledgeGraphFocusCameraTarget,
  buildKnowledgeGraphFocusRings,
  buildKnowledgeGraphHopLevels,
  buildKnowledgeGraphOverviewCameraTarget,
  buildKnowledgeGraphSeedPositions,
  reduceKnowledgeGraphSigmaEdgeAttributes,
  reduceKnowledgeGraphSigmaNodeAttributes,
  type KnowledgeGraphSeedPosition
} from "@/components/knowledge-graph/knowledge-graph-force-view-model";
import type { KnowledgeGraphPhysicsSettings } from "@/components/knowledge-graph/knowledge-graph-layout-model";
import type {
  KnowledgeGraphLayoutWorkerMessage,
  KnowledgeGraphLayoutWorkerResponse
} from "@/components/knowledge-graph/knowledge-graph-layout-protocol";
import {
  buildKnowledgeGraphDatasetSignature,
  buildRenderedKnowledgeGraphEdges,
  type RenderedKnowledgeGraphEdge
} from "@/lib/knowledge-graph";
import {
  buildKnowledgeGraphBoundsCenter,
  buildKnowledgeGraphCentroid,
  buildKnowledgeGraphDiagnosticsEventId,
  buildKnowledgeGraphDiagnosticsSnapshotId,
  buildKnowledgeGraphDriftMetrics,
  createKnowledgeGraphUiLogger,
  evaluateKnowledgeGraphStartupInvariant,
  isKnowledgeGraphDevDiagnosticsEnabled,
  KNOWLEDGE_GRAPH_PERIODIC_SNAPSHOT_INTERVAL_MS,
  mirrorKnowledgeGraphDiagnosticsEventToConsole,
  mirrorKnowledgeGraphDiagnosticsSnapshotToConsole,
  mirrorKnowledgeGraphDiagnosticsStatusToConsole,
  recenterKnowledgeGraphPointsAroundOrigin,
  type KnowledgeGraphCameraSnapshot,
  type KnowledgeGraphDiagnosticsPayload,
  type KnowledgeGraphDiagnosticsSnapshot,
  type KnowledgeGraphDiagnosticsStatus,
  type KnowledgeGraphStartupPhase
} from "@/lib/knowledge-graph-dev-diagnostics";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode
} from "@/lib/knowledge-graph-types";
import {
  recordKnowledgeGraphDiagnosticsEvent,
  recordKnowledgeGraphDiagnosticsSnapshot,
  setKnowledgeGraphDiagnosticsStatus
} from "@/store/slices/knowledge-graph-diagnostics-slice";
import { useAppDispatch, useAppSelector } from "@/store/typed-hooks";

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
  startViewportX: number;
  startViewportY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
};

type FallbackGraphNode = SigmaNodeAttributes & {
  id: string;
};

type FallbackGraphSnapshot = {
  nodes: FallbackGraphNode[];
  edges: RenderedKnowledgeGraphEdge[];
};

type DesiredCameraTarget = CameraState & {
  nodeIds?: string[];
};

declare global {
  interface Window {
    __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean;
    __FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__?: KnowledgeGraphDiagnosticsPayload;
    __FORGE_KNOWLEDGE_GRAPH_TEST_API__?: {
      selectNode: (nodeId: string | null) => void;
      moveNodeBy: (nodeId: string, deltaX: number, deltaY: number) => void;
      nudgeCameraBy?: (deltaX: number, deltaY: number) => void;
    };
  }
}

export type KnowledgeGraphForceViewHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  recenterOnFocus: () => void;
};

let WEBGL_SUPPORT_CACHE: boolean | null = null;

function shouldPublishKnowledgeGraphDiagnostics() {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.__FORGE_ENABLE_GRAPH_DIAGNOSTICS__) {
    return true;
  }
  try {
    return new URLSearchParams(window.location.search).get("graphDiagnostics") === "1";
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
  graph.forEachNode((nodeId) => {
    const attributes = graph.getNodeAttributes(nodeId);
    if (Number.isFinite(attributes.x) && Number.isFinite(attributes.y)) {
      cache.set(nodeId, {
        x: attributes.x,
        y: attributes.y
      });
    }
  });
}

function createGraphFromData(
  nodes: KnowledgeGraphNode[],
  edges: RenderedKnowledgeGraphEdge[],
  cache: Map<string, PositionSnapshot>
) {
  const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const orderedNodes = [...nodes].sort(
    (left, right) =>
      right.importance - left.importance ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id)
  );
  const seedPositions = buildKnowledgeGraphSeedPositions({
    nodes: orderedNodes,
    cache: cache as Map<string, KnowledgeGraphSeedPosition>
  });

  orderedNodes.forEach((node) => {
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
      color:
        edge.family === "structural"
          ? "rgba(125, 211, 252, 0.055)"
          : edge.family === "contextual"
            ? "rgba(45, 212, 191, 0.055)"
            : edge.family === "taxonomy"
              ? "rgba(192, 132, 252, 0.055)"
              : edge.family === "workspace"
                ? "rgba(251, 191, 36, 0.055)"
                : "rgba(148, 163, 184, 0.055)",
      label: edge.label,
      hidden: false,
      forceLabel: false,
      zIndex: 0,
      data: edge
    });
  });

  return graph;
}

function recenterGraphAroundOrigin(
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>
) {
  if (graph.order === 0) {
    return;
  }

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  graph.forEachNode((nodeId) => {
    const attributes = graph.getNodeAttributes(nodeId);
    sumX += attributes.x;
    sumY += attributes.y;
    count += 1;
  });

  if (count === 0) {
    return;
  }

  const centerX = sumX / count;
  const centerY = sumY / count;
  if (Math.abs(centerX) < 0.0001 && Math.abs(centerY) < 0.0001) {
    return;
  }

  graph.updateEachNodeAttributes(
    (_nodeId, attributes) => ({
      ...attributes,
      x: attributes.x - centerX,
      y: attributes.y - centerY
    }),
    {
      attributes: ["x", "y"]
    }
  );
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

function getFallbackCameraForSnapshot(_snapshot: FallbackGraphSnapshot): CameraState {
  const overview = buildKnowledgeGraphOverviewCameraTarget({
    positions: new Map(
      _snapshot.nodes.map((node) => [
        node.id,
        {
          x: node.x,
          y: node.y
        }
      ])
    ),
    currentRatio: 1
  });
  return {
    x: overview.x,
    y: overview.y,
    angle: 0,
    ratio: overview.ratio
  };
}

function recenterPositionArraysAroundOrigin({
  x,
  y
}: {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
}) {
  const positions = Array.from({ length: x.length }, (_, index) => ({
    x: x[index] ?? 0,
    y: y[index] ?? 0
  }));
  const recentered = recenterKnowledgeGraphPointsAroundOrigin(positions);
  if (!recentered.changed) {
    return {
      changed: false,
      offsetX: 0,
      offsetY: 0,
      x: new Float32Array(x),
      y: new Float32Array(y)
    };
  }
  return {
    changed: true,
    offsetX: recentered.offset.x,
    offsetY: recentered.offset.y,
    x: new Float32Array(recentered.positions.map((position) => position.x)),
    y: new Float32Array(recentered.positions.map((position) => position.y))
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
  primaryFocusedNodeId,
  draggedNodeId,
  graph,
  layoutGeneration,
  sigma,
  startupPhase,
  startupInvariantSatisfied,
  simulationPhase,
  focusSources,
  focusPressure,
  centroid,
  cameraTarget,
  latestSnapshotAt,
  latestSnapshotNodeCount
}: {
  datasetSignature: string;
  focusNodeId: string | null;
  primaryFocusedNodeId: string | null;
  draggedNodeId: string | null;
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>;
  layoutGeneration: number;
  sigma: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>;
  startupPhase: KnowledgeGraphStartupPhase;
  startupInvariantSatisfied: boolean;
  simulationPhase: KnowledgeGraphDiagnosticsPayload["simulationPhase"];
  focusSources: KnowledgeGraphDiagnosticsPayload["focusSources"];
  focusPressure: Float32Array;
  centroid: KnowledgeGraphDiagnosticsPayload["graphCentroid"];
  cameraTarget: KnowledgeGraphDiagnosticsPayload["cameraTarget"];
  latestSnapshotAt: string | null;
  latestSnapshotNodeCount: number | null;
}) {
  const visibleNodeIds: string[] = [];
  const nodeScreenPositions: KnowledgeGraphDiagnosticsPayload["nodeScreenPositions"] = {};
  const focusPressureByNodeId: KnowledgeGraphDiagnosticsPayload["focusPressureByNodeId"] = {};
  let focusedNodePosition: KnowledgeGraphDiagnosticsPayload["focusedNodePosition"] = null;

  graph.forEachNode((nodeId) => {
    visibleNodeIds.push(nodeId);
    const displayData = sigma.getNodeDisplayData(nodeId);
    const attributes = graph.getNodeAttributes(nodeId);
    const viewport = sigma.graphToViewport({
      x: attributes.x,
      y: attributes.y
    });
    nodeScreenPositions[nodeId] = {
      x: viewport.x,
      y: viewport.y,
      size: displayData?.size ?? attributes.size
    };
    focusPressureByNodeId[nodeId] = Number((focusPressure[visibleNodeIds.length - 1] ?? 0).toFixed(4));
    if (nodeId === primaryFocusedNodeId) {
      focusedNodePosition = {
        x: attributes.x,
        y: attributes.y
      };
    }
  });

  const boundsCenter = buildKnowledgeGraphBoundsCenter(
    visibleNodeIds.map((nodeId) => {
      const attributes = graph.getNodeAttributes(nodeId);
      return {
        x: attributes.x,
        y: attributes.y
      };
    })
  );
  const camera = sigma.getCamera().getState();
  const driftMetrics = buildKnowledgeGraphDriftMetrics({
    centroid,
    boundsCenter,
    camera
  });

  window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__ = {
    datasetSignature,
    visibleNodeIds,
    visibleNodeCount: visibleNodeIds.length,
    focusedNodeId: focusNodeId,
    primaryFocusedNodeId,
    draggedNodeId,
    layoutGeneration,
    rendererMode: "sigma",
    startupPhase,
    startupInvariantSatisfied,
    simulationPhase,
    focusSources,
    focusPressureByNodeId,
    graphCentroid: centroid,
    boundsCenter,
    focusedNodePosition,
    cameraTarget,
    cameraFollowError: cameraTarget
      ? {
          x: Number((camera.x - cameraTarget.x).toFixed(4)),
          y: Number((camera.y - cameraTarget.y).toFixed(4)),
          ratio: Number((camera.ratio - cameraTarget.ratio).toFixed(4))
        }
      : null,
    camera,
    nodeScreenPositions,
    centroidDistanceFromOrigin: driftMetrics.centroidDistanceFromOrigin,
    boundsCenterDistanceFromOrigin: driftMetrics.boundsCenterDistanceFromOrigin,
    cameraDistanceFromOrigin: driftMetrics.cameraDistanceFromOrigin,
    cameraToCentroidDistance: driftMetrics.cameraToCentroidDistance,
    latestSnapshotAt,
    latestSnapshotNodeCount
  };
}

function publishFallbackKnowledgeGraphDiagnostics({
  datasetSignature,
  focusNodeId,
  primaryFocusedNodeId,
  draggedNodeId,
  layoutGeneration,
  camera,
  snapshot,
  width,
  height,
  startupPhase,
  startupInvariantSatisfied,
  simulationPhase,
  focusSources,
  focusPressure,
  centroid,
  cameraTarget,
  latestSnapshotAt,
  latestSnapshotNodeCount
}: {
  datasetSignature: string;
  focusNodeId: string | null;
  primaryFocusedNodeId: string | null;
  draggedNodeId: string | null;
  layoutGeneration: number;
  camera: CameraState;
  snapshot: FallbackGraphSnapshot;
  width: number;
  height: number;
  startupPhase: KnowledgeGraphStartupPhase;
  startupInvariantSatisfied: boolean;
  simulationPhase: KnowledgeGraphDiagnosticsPayload["simulationPhase"];
  focusSources: KnowledgeGraphDiagnosticsPayload["focusSources"];
  focusPressure: Float32Array;
  centroid: KnowledgeGraphDiagnosticsPayload["graphCentroid"];
  cameraTarget: KnowledgeGraphDiagnosticsPayload["cameraTarget"];
  latestSnapshotAt: string | null;
  latestSnapshotNodeCount: number | null;
}) {
  const visibleNodeIds = snapshot.nodes.map((node) => node.id);
  const nodeScreenPositions: KnowledgeGraphDiagnosticsPayload["nodeScreenPositions"] = {};
  const focusPressureByNodeId: KnowledgeGraphDiagnosticsPayload["focusPressureByNodeId"] = {};
  let focusedNodePosition: KnowledgeGraphDiagnosticsPayload["focusedNodePosition"] = null;

  snapshot.nodes.forEach((node, index) => {
    nodeScreenPositions[node.id] = projectFallbackNode({
      node,
      snapshot,
      camera,
      width,
      height
    });
    focusPressureByNodeId[node.id] = Number((focusPressure[index] ?? 0).toFixed(4));
    if (node.id === primaryFocusedNodeId) {
      focusedNodePosition = {
        x: node.x,
        y: node.y
      };
    }
  });

  const boundsCenter = buildKnowledgeGraphBoundsCenter(
    snapshot.nodes.map((node) => ({
      x: node.x,
      y: node.y
    }))
  );
  const driftMetrics = buildKnowledgeGraphDriftMetrics({
    centroid,
    boundsCenter,
    camera
  });

  window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__ = {
    datasetSignature,
    visibleNodeIds,
    visibleNodeCount: visibleNodeIds.length,
    focusedNodeId: focusNodeId,
    primaryFocusedNodeId,
    draggedNodeId,
    layoutGeneration,
    rendererMode: "fallback",
    startupPhase,
    startupInvariantSatisfied,
    simulationPhase,
    focusSources,
    focusPressureByNodeId,
    graphCentroid: centroid,
    boundsCenter,
    focusedNodePosition,
    cameraTarget,
    cameraFollowError: cameraTarget
      ? {
          x: Number((camera.x - cameraTarget.x).toFixed(4)),
          y: Number((camera.y - cameraTarget.y).toFixed(4)),
          ratio: Number((camera.ratio - cameraTarget.ratio).toFixed(4))
        }
      : null,
    camera,
    nodeScreenPositions,
    centroidDistanceFromOrigin: driftMetrics.centroidDistanceFromOrigin,
    boundsCenterDistanceFromOrigin: driftMetrics.boundsCenterDistanceFromOrigin,
    cameraDistanceFromOrigin: driftMetrics.cameraDistanceFromOrigin,
    cameraToCentroidDistance: driftMetrics.cameraToCentroidDistance,
    latestSnapshotAt,
    latestSnapshotNodeCount
  };
}

function isContainerReady(
  container: HTMLDivElement | null,
  size: { width: number; height: number }
) {
  if (!container) {
    return false;
  }
  const liveWidth = container.clientWidth;
  const liveHeight = container.clientHeight;
  const rect = container.getBoundingClientRect();
  return (
    container.isConnected &&
    size.width > 0 &&
    size.height > 0 &&
    liveWidth > 0 &&
    liveHeight > 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    container.getClientRects().length > 0
  );
}

function findNearestViewportNode({
  sigma,
  graph,
  viewportX,
  viewportY
}: {
  sigma: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>;
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>;
  viewportX: number;
  viewportY: number;
}) {
  let nearestNodeId: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  graph.forEachNode((nodeId) => {
    const attributes = graph.getNodeAttributes(nodeId);
    const displayData = sigma.getNodeDisplayData(nodeId);
    if (!displayData || attributes.hidden) {
      return;
    }
    const viewport = sigma.graphToViewport({
      x: attributes.x,
      y: attributes.y
    });
    const dx = viewport.x - viewportX;
    const dy = viewport.y - viewportY;
    const distance = Math.hypot(dx, dy);
    const threshold = Math.max(displayData.size * 1.8, 18);
    if (distance <= threshold && distance < nearestDistance) {
      nearestNodeId = nodeId;
      nearestDistance = distance;
    }
  });

  return nearestNodeId;
}

function buildKnowledgeGraphEdgeStroke(
  edge: RenderedKnowledgeGraphEdge,
  alpha: number
) {
  const rgb =
    edge.family === "structural"
      ? "125, 211, 252"
      : edge.family === "contextual"
        ? "45, 212, 191"
        : edge.family === "taxonomy"
          ? "192, 132, 252"
          : edge.family === "workspace"
            ? "251, 191, 36"
            : "148, 163, 184";
  return `rgba(${rgb}, ${alpha})`;
}

export const KnowledgeGraphForceView = forwardRef<
  KnowledgeGraphForceViewHandle,
  {
    nodes: KnowledgeGraphNode[];
    edges: KnowledgeGraphEdge[];
    focusNodeId: string | null;
    physicsSettings: KnowledgeGraphPhysicsSettings;
    onSelectNode: (node: KnowledgeGraphNode | null) => void;
  }
>(function KnowledgeGraphForceView(
  { nodes, edges, focusNodeId, physicsSettings, onSelectNode },
  ref
) {
  const dispatch = useAppDispatch();
  const diagnosticsPanelOpen = useAppSelector(
    (state) => state.knowledgeGraphDiagnostics.panelOpen
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const graphRef = useRef<Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null);
  const positionCacheRef = useRef<Map<string, PositionSnapshot>>(new Map());
  const cameraStateCacheRef = useRef<Map<string, CameraState>>(new Map());
  const nodeMapRef = useRef<Map<string, KnowledgeGraphNode>>(new Map());
  const onSelectNodeRef = useRef(onSelectNode);
  const focusNodeIdRef = useRef<string | null>(focusNodeId);
  const datasetSignatureRef = useRef<string | null>(null);
  const layoutGenerationRef = useRef(0);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressSelectionUntilRef = useRef(0);
  const previousPanningEnabledRef = useRef(true);
  const desiredCameraRef = useRef<DesiredCameraTarget | null>(null);
  const manualRatioHoldUntilRef = useRef(0);
  const simulationPhaseRef =
    useRef<KnowledgeGraphDiagnosticsPayload["simulationPhase"]>("global");
  const primaryFocusedNodeIdRef = useRef<string | null>(null);
  const focusSourcesRef = useRef<KnowledgeGraphDiagnosticsPayload["focusSources"]>([]);
  const focusPressureRef = useRef<Float32Array>(new Float32Array(0));
  const centroidRef = useRef<KnowledgeGraphDiagnosticsPayload["graphCentroid"]>({
    x: 0,
    y: 0
  });
  const startupPhaseRef = useRef<KnowledgeGraphStartupPhase>("boot");
  const startupCorrectionAppliedRef = useRef(false);
  const startupFirstFrameHandledRef = useRef(false);
  const startupWorkerVerificationHandledRef = useRef(false);
  const latestSnapshotAtRef = useRef<string | null>(null);
  const latestSnapshotNodeCountRef = useRef<number | null>(null);
  const anomalyPublishedAtRef = useRef(0);
  const lastDiagnosticsPublishAtRef = useRef(0);
  const lastStatusMirrorAtRef = useRef(0);
  const lifecycleLoggerRef = useRef(
    createKnowledgeGraphUiLogger("/knowledge-graph")
  );
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [fallbackCamera, setFallbackCamera] = useState<CameraState>({
    x: 0,
    y: 0,
    angle: 0,
    ratio: 1
  });
  const [fallbackSnapshot, setFallbackSnapshot] = useState<FallbackGraphSnapshot | null>(null);
  const [containerSize, setContainerSize] = useState({
    width: 0,
    height: 0
  });
  const diagnosticsAvailable = isKnowledgeGraphDevDiagnosticsEnabled();
  const diagnosticsEnabled =
    diagnosticsAvailable && diagnosticsPanelOpen;
  const buildGraphOverviewRatio = (
    currentGraph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null = graphRef.current
  ) => {
    const overview = buildKnowledgeGraphOverviewCameraTarget({
      positions: currentGraph ? buildPositionMapFromGraph(currentGraph) : new Map(),
      currentRatio: 1
    });
    return overview.ratio;
  };
  const buildSigmaOverviewCameraState = (
    currentGraph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null = graphRef.current
  ) =>
    ({
      x: 0.5,
      y: 0.5,
      angle: 0,
      ratio: buildGraphOverviewRatio(currentGraph)
    }) satisfies CameraState;
  const buildFallbackOverviewCameraState = (
    currentGraph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null = graphRef.current
  ) =>
    ({
      x: 0,
      y: 0,
      angle: 0,
      ratio: buildGraphOverviewRatio(currentGraph)
    }) satisfies CameraState;
  const getCurrentRendererMode = (): "sigma" | "fallback" =>
    sigmaRef.current ? "sigma" : "fallback";

  const renderedEdges = useMemo(() => buildRenderedKnowledgeGraphEdges(edges), [edges]);
  const datasetSignature = useMemo(
    () => buildKnowledgeGraphDatasetSignature(nodes, edges),
    [edges, nodes]
  );
  const focusRings = useMemo(
    () => (focusNodeId ? buildKnowledgeGraphFocusRings(renderedEdges, focusNodeId) : null),
    [focusNodeId, renderedEdges]
  );
  const detailNodeIds = useMemo(() => {
    if (!focusNodeId) {
      return new Set<string>();
    }
    return new Set<string>([focusNodeId, ...(focusRings?.firstRing ?? [])]);
  }, [focusNodeId, focusRings]);
  const relatedNodeIds = useMemo(() => {
    if (!focusNodeId) {
      return new Set<string>();
    }
    return new Set<string>([
      focusNodeId,
      ...(focusRings?.firstRing ?? []),
      ...(focusRings?.secondRing ?? [])
    ]);
  }, [focusNodeId, focusRings]);

  const isSigmaContainerReady = () =>
    isContainerReady(containerRef.current, containerSize);

  const safeRefreshSigma = ({
    resize = false
  }: {
    resize?: boolean;
  } = {}) => {
    if (!sigmaRef.current || !isSigmaContainerReady()) {
      return false;
    }
    try {
      if (resize) {
        sigmaRef.current.resize();
      }
      sigmaRef.current.refresh();
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Container has no width")
      ) {
        return false;
      }
      throw error;
    }
  };

  const isSelectionSuppressedAfterDrag = () =>
    Date.now() < suppressSelectionUntilRef.current;

  const recordDiagnosticsEvent = ({
    level,
    eventKey,
    message,
    details,
    publishBackend = false
  }: {
    level: "debug" | "info" | "warning" | "error";
    eventKey: string;
    message: string;
    details?: Record<string, unknown>;
    publishBackend?: boolean;
  }) => {
    if (!diagnosticsEnabled) {
      return;
    }
    if (diagnosticsPanelOpen) {
      dispatch(
        recordKnowledgeGraphDiagnosticsEvent({
          id: buildKnowledgeGraphDiagnosticsEventId(),
          createdAt: new Date().toISOString(),
          level,
          eventKey,
          message,
          route: "/knowledge-graph",
          details: details ?? {}
        })
      );
    }
    mirrorKnowledgeGraphDiagnosticsEventToConsole({
      id: "console-mirror",
      createdAt: new Date().toISOString(),
      level,
      eventKey,
      message,
      route: "/knowledge-graph",
      details: details ?? {}
    });
    if (!publishBackend) {
      return;
    }
    void lifecycleLoggerRef.current({
      level,
      eventKey,
      message,
      functionName: "KnowledgeGraphForceView",
      details
    });
  };

  const buildCurrentCameraSnapshot = (): KnowledgeGraphCameraSnapshot =>
    sigmaRef.current
      ? {
          ...sigmaRef.current.getCamera().getState()
        }
      : {
          ...fallbackCamera
        };

  const buildCurrentStatus = ({
    rendererMode
  }: {
    rendererMode: "sigma" | "fallback";
  }): KnowledgeGraphDiagnosticsStatus | null => {
    if (!graphRef.current || !datasetSignatureRef.current) {
      return null;
    }
    const graph = graphRef.current;
    const positions = graph.nodes().map((nodeId) => {
      const attributes = graph.getNodeAttributes(nodeId);
      return {
        id: nodeId,
        x: attributes.x,
        y: attributes.y
      };
    });
    const centroid = buildKnowledgeGraphCentroid(positions);
    const boundsCenter = buildKnowledgeGraphBoundsCenter(positions);
    const camera = buildCurrentCameraSnapshot();
    const driftCamera =
      rendererMode === "sigma"
        ? {
            ...camera,
            x: Number((camera.x - 0.5).toFixed(4)),
            y: Number((camera.y - 0.5).toFixed(4))
          }
        : camera;
    const driftMetrics = buildKnowledgeGraphDriftMetrics({
      centroid,
      boundsCenter,
      camera: driftCamera
    });

    return {
      datasetSignature: datasetSignatureRef.current,
      route: "/knowledge-graph",
      rendererMode,
      startupPhase: startupPhaseRef.current,
      startupInvariantSatisfied:
        evaluateKnowledgeGraphStartupInvariant(driftMetrics),
      visibleNodeCount: positions.length,
      focusedNodeId: focusNodeIdRef.current,
      primaryFocusedNodeId: primaryFocusedNodeIdRef.current,
      graphCentroid: centroid,
      boundsCenter,
      camera,
      cameraTarget: desiredCameraRef.current
        ? {
            x: desiredCameraRef.current.x,
            y: desiredCameraRef.current.y,
            ratio: desiredCameraRef.current.ratio
          }
        : null,
      driftMetrics,
      latestSnapshotAt: latestSnapshotAtRef.current,
      lastVerifiedAt: new Date().toISOString()
    };
  };

  const publishStatusToStore = (
    status: KnowledgeGraphDiagnosticsStatus | null,
    {
      mirrorToConsole = false
    }: {
      mirrorToConsole?: boolean;
    } = {}
  ) => {
    if (!diagnosticsEnabled) {
      return;
    }
    if (diagnosticsPanelOpen) {
      dispatch(setKnowledgeGraphDiagnosticsStatus(status));
    }
    if (mirrorToConsole && Date.now() - lastStatusMirrorAtRef.current >= 1_000) {
      lastStatusMirrorAtRef.current = Date.now();
      mirrorKnowledgeGraphDiagnosticsStatusToConsole(status);
    }
  };

  const buildSnapshot = ({
    rendererMode
  }: {
    rendererMode: "sigma" | "fallback";
  }): KnowledgeGraphDiagnosticsSnapshot | null => {
    const status = buildCurrentStatus({ rendererMode });
    if (!status || !graphRef.current) {
      return null;
    }
    const nodePositions = graphRef.current.nodes().map((nodeId) => {
      const attributes = graphRef.current!.getNodeAttributes(nodeId);
      return {
        id: nodeId,
        x: Number(attributes.x.toFixed(4)),
        y: Number(attributes.y.toFixed(4))
      };
    });
    return {
      id: buildKnowledgeGraphDiagnosticsSnapshotId(),
      capturedAt: new Date().toISOString(),
      datasetSignature: status.datasetSignature,
      route: status.route,
      rendererMode: status.rendererMode,
      startupPhase: status.startupPhase,
      startupInvariantSatisfied: status.startupInvariantSatisfied,
      focusedNodeId: status.focusedNodeId,
      primaryFocusedNodeId: status.primaryFocusedNodeId,
      graphCentroid: status.graphCentroid,
      boundsCenter: status.boundsCenter,
      camera: status.camera,
      cameraTarget: status.cameraTarget,
      driftMetrics: status.driftMetrics,
      nodeCount: nodePositions.length,
      viewportSize: {
        width: containerSize.width,
        height: containerSize.height
      },
      nodePositions
    };
  };

  const recordSnapshot = ({
    rendererMode,
    publishAnomaly
  }: {
    rendererMode: "sigma" | "fallback";
    publishAnomaly?: boolean;
  }) => {
    if (!diagnosticsEnabled) {
      return;
    }
    const snapshot = buildSnapshot({ rendererMode });
    if (!snapshot) {
      return;
    }
    latestSnapshotAtRef.current = snapshot.capturedAt;
    latestSnapshotNodeCountRef.current = snapshot.nodeCount;
    if (diagnosticsPanelOpen) {
      dispatch(recordKnowledgeGraphDiagnosticsSnapshot(snapshot));
    }
    mirrorKnowledgeGraphDiagnosticsSnapshotToConsole(snapshot);
    publishStatusToStore({
      ...buildCurrentStatus({ rendererMode })!,
      latestSnapshotAt: snapshot.capturedAt
    }, {
      mirrorToConsole: true
    });

    if (
      publishAnomaly &&
      !snapshot.startupInvariantSatisfied &&
      Date.now() - anomalyPublishedAtRef.current > 15_000
    ) {
      anomalyPublishedAtRef.current = Date.now();
      recordDiagnosticsEvent({
        level: "warning",
        eventKey: "snapshot_drift_detected",
        message: "Knowledge graph drift exceeded the startup tolerance during dev diagnostics sampling.",
        publishBackend: true,
        details: {
          datasetSignature: snapshot.datasetSignature,
          driftMetrics: snapshot.driftMetrics,
          startupPhase: snapshot.startupPhase,
          nodeCount: snapshot.nodeCount
        }
      });
    }
  };

  const resetCameraToOrigin = () => {
    const originCamera = sigmaRef.current
      ? buildSigmaOverviewCameraState()
      : buildFallbackOverviewCameraState();
    if (sigmaRef.current) {
      sigmaRef.current.getCamera().setState(originCamera);
      return;
    }
    setFallbackCamera(originCamera);
  };

  const recenterGraphStateAroundOrigin = (reason: string) => {
    if (!graphRef.current) {
      return false;
    }
    const statusBefore = buildCurrentStatus({
      rendererMode: getCurrentRendererMode()
    });
    if (!statusBefore) {
      return false;
    }
    const offsetX = statusBefore.graphCentroid.x;
    const offsetY = statusBefore.graphCentroid.y;
    if (Math.abs(offsetX) < 0.0001 && Math.abs(offsetY) < 0.0001) {
      return false;
    }

    recenterGraphAroundOrigin(graphRef.current);
    rememberGraphPositions(graphRef.current, positionCacheRef.current);
    workerRef.current?.postMessage({
      type: "recenter-graph",
      offsetX,
      offsetY
    } satisfies KnowledgeGraphLayoutWorkerMessage);
    setFallbackSnapshot(buildFallbackSnapshot(graphRef.current, renderedEdges));
    resetCameraToOrigin();
    startupPhaseRef.current = "startup_corrected";
    recordDiagnosticsEvent({
      level: "warning",
      eventKey: "startup_corrected",
      message: "Corrected the knowledge graph startup bias back to graph-space origin.",
      publishBackend: true,
      details: {
        reason,
        offsetX,
        offsetY,
        datasetSignature: datasetSignatureRef.current
      }
    });
    return true;
  };

  const verifyStartupInvariant = ({
    phase,
    allowCorrection,
    publishBackendOnFailure = false
  }: {
    phase: KnowledgeGraphStartupPhase;
    allowCorrection: boolean;
    publishBackendOnFailure?: boolean;
  }) => {
    if (!graphRef.current || !datasetSignatureRef.current) {
      return;
    }
    startupPhaseRef.current = phase;
    const rendererMode = sigmaRef.current ? "sigma" : "fallback";
    const status = buildCurrentStatus({ rendererMode });
    if (!status) {
      return;
    }
    publishStatusToStore(status, {
      mirrorToConsole: true
    });
    if (status.startupInvariantSatisfied) {
      startupPhaseRef.current = "startup_verified";
      publishStatusToStore({
        ...status,
        startupPhase: "startup_verified"
      }, {
        mirrorToConsole: true
      });
      recordDiagnosticsEvent({
        level: "info",
        eventKey: "startup_verified",
        message: "Knowledge graph startup invariant passed.",
        details: {
          datasetSignature: status.datasetSignature,
          driftMetrics: status.driftMetrics,
          phase
        }
      });
      return;
    }

    recordDiagnosticsEvent({
      level: "warning",
      eventKey: "startup_invariant_failed",
      message: "Knowledge graph startup invariant failed before correction.",
      publishBackend: publishBackendOnFailure,
      details: {
        datasetSignature: status.datasetSignature,
        phase,
        driftMetrics: status.driftMetrics,
        centroid: status.graphCentroid,
        boundsCenter: status.boundsCenter,
        camera: status.camera
      }
    });

    if (!allowCorrection || startupCorrectionAppliedRef.current) {
      return;
    }

    startupCorrectionAppliedRef.current = true;
    const corrected = recenterGraphStateAroundOrigin(phase);
    if (!corrected) {
      return;
    }
    safeRefreshSigma();
    const correctedStatus = buildCurrentStatus({ rendererMode });
    if (!correctedStatus) {
      return;
    }
    publishStatusToStore(correctedStatus, {
      mirrorToConsole: true
    });
    if (correctedStatus.startupInvariantSatisfied) {
      startupPhaseRef.current = "startup_verified";
      publishStatusToStore({
        ...correctedStatus,
        startupPhase: "startup_verified"
      }, {
        mirrorToConsole: true
      });
      recordDiagnosticsEvent({
        level: "info",
        eventKey: "startup_verified_after_correction",
        message: "Knowledge graph startup invariant passed after correction.",
        details: {
          datasetSignature: correctedStatus.datasetSignature,
          driftMetrics: correctedStatus.driftMetrics
        }
      });
      return;
    }
    recordDiagnosticsEvent({
      level: "error",
      eventKey: "startup_correction_failed",
      message: "Knowledge graph startup correction did not restore the origin invariant.",
      publishBackend: true,
      details: {
        datasetSignature: correctedStatus.datasetSignature,
        driftMetrics: correctedStatus.driftMetrics,
        centroid: correctedStatus.graphCentroid,
        boundsCenter: correctedStatus.boundsCenter,
        camera: correctedStatus.camera
      }
    });
  };

  const publishCurrentDiagnostics = () => {
    if (!datasetSignatureRef.current || !graphRef.current) {
      return;
    }
    const now = Date.now();
    if (now - lastDiagnosticsPublishAtRef.current < 1_500) {
      return;
    }
    lastDiagnosticsPublishAtRef.current = now;
    if (sigmaRef.current) {
      publishKnowledgeGraphDiagnostics({
        datasetSignature: datasetSignatureRef.current,
        focusNodeId: focusNodeIdRef.current,
        primaryFocusedNodeId: primaryFocusedNodeIdRef.current,
        draggedNodeId: dragStateRef.current?.nodeId ?? null,
        graph: graphRef.current,
        layoutGeneration: layoutGenerationRef.current,
        sigma: sigmaRef.current,
        startupPhase: startupPhaseRef.current,
        startupInvariantSatisfied:
          buildCurrentStatus({ rendererMode: "sigma" })?.startupInvariantSatisfied ??
          false,
        simulationPhase: simulationPhaseRef.current,
        focusSources: focusSourcesRef.current,
        focusPressure: focusPressureRef.current,
        centroid: centroidRef.current,
        cameraTarget: desiredCameraRef.current
          ? {
              x: desiredCameraRef.current.x,
              y: desiredCameraRef.current.y,
              ratio: desiredCameraRef.current.ratio
            }
          : null,
        latestSnapshotAt: latestSnapshotAtRef.current,
        latestSnapshotNodeCount: latestSnapshotNodeCountRef.current
      });
      return;
    }
    if (!fallbackSnapshot) {
      return;
    }
    publishFallbackKnowledgeGraphDiagnostics({
      datasetSignature: datasetSignatureRef.current,
      focusNodeId: focusNodeIdRef.current,
      primaryFocusedNodeId: primaryFocusedNodeIdRef.current,
      draggedNodeId: dragStateRef.current?.nodeId ?? null,
      layoutGeneration: layoutGenerationRef.current,
      camera: fallbackCamera,
      snapshot: fallbackSnapshot,
      width: containerSize.width,
      height: containerSize.height,
      startupPhase: startupPhaseRef.current,
      startupInvariantSatisfied:
        buildCurrentStatus({ rendererMode: "fallback" })?.startupInvariantSatisfied ??
        false,
      simulationPhase: simulationPhaseRef.current,
      focusSources: focusSourcesRef.current,
      focusPressure: focusPressureRef.current,
      centroid: centroidRef.current,
      cameraTarget: desiredCameraRef.current
        ? {
            x: desiredCameraRef.current.x,
            y: desiredCameraRef.current.y,
            ratio: desiredCameraRef.current.ratio
          }
        : null,
      latestSnapshotAt: latestSnapshotAtRef.current,
      latestSnapshotNodeCount: latestSnapshotNodeCountRef.current
    });
  };

  const updateDesiredCameraFromGraph = () => {
    if (!graphRef.current || !focusNodeIdRef.current) {
      desiredCameraRef.current = null;
      return;
    }
    const currentGraph = graphRef.current;
    if (!currentGraph.hasNode(focusNodeIdRef.current)) {
      desiredCameraRef.current = null;
      return;
    }
    const positions = buildPositionMapFromGraph(currentGraph);
    const rings = buildKnowledgeGraphFocusRings(renderedEdges, focusNodeIdRef.current);
    const currentRatio = sigmaRef.current
      ? sigmaRef.current.getCamera().getState().ratio
      : fallbackCamera.ratio;
    const target = buildKnowledgeGraphFocusCameraTarget({
      positions,
      focusNodeId: focusNodeIdRef.current,
      firstRingNodeIds: rings.firstRing,
      secondRingNodeIds: rings.secondRing,
      currentRatio
    });
    const sigmaTarget =
      sigmaRef.current && target
        ? buildKnowledgeGraphFramedGraphPosition({
            positions,
            point: {
              x: target.x,
              y: target.y
            }
          })
        : null;
    desiredCameraRef.current = target
      ? {
          x: sigmaTarget?.x ?? target.x,
          y: sigmaTarget?.y ?? target.y,
          angle: 0,
          ratio: target.ratio,
          nodeIds: target.nodeIds
        }
      : null;
  };

  const animateCameraToDesired = (duration = 220) => {
    if (!desiredCameraRef.current) {
      return;
    }
    const target = desiredCameraRef.current;
    if (sigmaRef.current) {
      const camera = sigmaRef.current.getCamera();
      const current = camera.getState();
      const shouldRespectManualRatio = Date.now() < manualRatioHoldUntilRef.current;
      void camera.animate(
        {
          x: target.x,
          y: target.y,
          ratio: shouldRespectManualRatio ? current.ratio : target.ratio,
          angle: 0
        },
        { duration }
      );
      return;
    }
    setFallbackCamera((current) => ({
      ...current,
      x: target.x,
      y: target.y,
      ratio:
        Date.now() < manualRatioHoldUntilRef.current ? current.ratio : target.ratio
    }));
  };

  useEffect(() => {
    onSelectNodeRef.current = onSelectNode;
  }, [onSelectNode]);

  useEffect(() => {
    focusNodeIdRef.current = focusNodeId;
    desiredCameraRef.current = null;
  }, [focusNodeId]);

  useEffect(() => {
    if (!diagnosticsEnabled) {
      clearKnowledgeGraphDiagnostics();
    }
  }, [diagnosticsEnabled]);

  useEffect(() => {
    if (!shouldPublishKnowledgeGraphDiagnostics() || typeof window === "undefined") {
      return;
    }
    window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__ = {
      selectNode: (nodeId) => {
        const nextNode =
          nodeId
            ? nodeMapRef.current.get(nodeId) ??
              (graphRef.current?.hasNode(nodeId)
                ? ((graphRef.current.getNodeAttribute(
                    nodeId,
                    "data"
                  ) as KnowledgeGraphNode | undefined) ?? null)
                : null)
            : null;
        onSelectNodeRef.current(nextNode);
      },
      moveNodeBy: (nodeId, deltaX, deltaY) => {
        if (!graphRef.current?.hasNode(nodeId)) {
          return;
        }
        const attributes = graphRef.current.getNodeAttributes(nodeId);
        const nextX = attributes.x + deltaX;
        const nextY = attributes.y + deltaY;
        graphRef.current.mergeNodeAttributes(nodeId, {
          x: nextX,
          y: nextY
        });
        positionCacheRef.current.set(nodeId, {
          x: nextX,
          y: nextY
        });
        workerRef.current?.postMessage({
          type: "nudge-node",
          nodeId,
          x: nextX,
          y: nextY
        } satisfies KnowledgeGraphLayoutWorkerMessage);
        safeRefreshSigma();
        if (!sigmaRef.current && graphRef.current) {
          setFallbackSnapshot(buildFallbackSnapshot(graphRef.current, renderedEdges));
        }
      },
      nudgeCameraBy: (deltaX, deltaY) => {
        if (sigmaRef.current) {
          const camera = sigmaRef.current.getCamera();
          const current = camera.getState();
          void camera.animate(
            {
              x: current.x + deltaX,
              y: current.y + deltaY,
              ratio: current.ratio,
              angle: current.angle
            },
            { duration: 140 }
          );
          return;
        }
        setFallbackCamera((current) => ({
          ...current,
          x: current.x + deltaX,
          y: current.y + deltaY
        }));
      }
    };
    return () => {
      delete window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__;
    };
  }, [renderedEdges]);

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
        manualRatioHoldUntilRef.current = Date.now() + 1200;
        if (sigmaRef.current) {
          void sigmaRef.current.getCamera().animatedZoom({
            factor: 1.25,
            duration: 160
          });
          return;
        }
        setFallbackCamera((current) => ({
          ...current,
          ratio: Math.max(0.08, current.ratio * 0.82)
        }));
      },
      zoomOut: () => {
        manualRatioHoldUntilRef.current = Date.now() + 1200;
        if (sigmaRef.current) {
          void sigmaRef.current.getCamera().animatedUnzoom({
            factor: 1.25,
            duration: 160
          });
          return;
        }
        setFallbackCamera((current) => ({
          ...current,
          ratio: Math.min(4, current.ratio * 1.22)
        }));
      },
      fit: () => {
        desiredCameraRef.current = null;
        if (sigmaRef.current) {
          void sigmaRef.current
            .getCamera()
            .animate(buildSigmaOverviewCameraState(), { duration: 220 });
          return;
        }
        if (fallbackSnapshot) {
          setFallbackCamera(getFallbackCameraForSnapshot(fallbackSnapshot));
        }
      },
      recenterOnFocus: () => {
        updateDesiredCameraFromGraph();
        if (!desiredCameraRef.current) {
          return;
        }
        animateCameraToDesired(220);
      }
    }),
    [fallbackSnapshot, renderedEdges]
  );

  useEffect(() => {
    return () => {
      if (graphRef.current) {
        rememberGraphPositions(graphRef.current, positionCacheRef.current);
      }
      if (sigmaRef.current && datasetSignatureRef.current) {
        cameraStateCacheRef.current.set(
          datasetSignatureRef.current,
          sigmaRef.current.getCamera().getState()
        );
      }
      workerRef.current?.postMessage({ type: "dispose" } satisfies KnowledgeGraphLayoutWorkerMessage);
      workerRef.current?.terminate();
      workerRef.current = null;
      if (diagnosticsEnabled) {
        recordDiagnosticsEvent({
          level: "debug",
          eventKey: "sigma_killed",
          message: "Disposed the knowledge graph renderer."
        });
      }
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      clearKnowledgeGraphDiagnostics();
    };
  }, [diagnosticsEnabled]);

  useEffect(() => {
    if (!containerRef.current || !isContainerReady(containerRef.current, containerSize)) {
      return;
    }

    const sameDataset =
      datasetSignatureRef.current === datasetSignature && graphRef.current !== null;

    if (sameDataset) {
      safeRefreshSigma({ resize: true });
      if (diagnosticsEnabled) {
        recordDiagnosticsEvent({
          level: "debug",
          eventKey: "graph_refresh",
          message: "Reused the current graph dataset and refreshed the renderer.",
          details: {
            datasetSignature,
            width: containerSize.width,
            height: containerSize.height,
            focusNodeId,
            physicsSettings
          }
        });
      }
      publishCurrentDiagnostics();
      return;
    }

    startupPhaseRef.current = "boot";
    startupCorrectionAppliedRef.current = false;
    startupFirstFrameHandledRef.current = false;
    startupWorkerVerificationHandledRef.current = false;
    latestSnapshotAtRef.current = null;
    latestSnapshotNodeCountRef.current = null;
    anomalyPublishedAtRef.current = 0;
    desiredCameraRef.current = null;

    recordDiagnosticsEvent({
      level: "info",
      eventKey: "graph_boot",
      message: "Bootstrapping a fresh knowledge graph dataset.",
      details: {
        datasetSignature,
        nodeCount: nodes.length,
        edgeCount: renderedEdges.length
      }
    });

    if (graphRef.current) {
      rememberGraphPositions(graphRef.current, positionCacheRef.current);
    }
    if (sigmaRef.current && datasetSignatureRef.current) {
      cameraStateCacheRef.current.set(
        datasetSignatureRef.current,
        sigmaRef.current.getCamera().getState()
      );
    }

    const nextGraph = createGraphFromData(nodes, renderedEdges, positionCacheRef.current);
    recenterGraphAroundOrigin(nextGraph);
    rememberGraphPositions(nextGraph, positionCacheRef.current);
    graphRef.current = nextGraph;
    nodeMapRef.current = new Map(nodes.map((node) => [node.id, node]));
    datasetSignatureRef.current = datasetSignature;
    layoutGenerationRef.current += 1;
    setFallbackSnapshot(buildFallbackSnapshot(nextGraph, renderedEdges));
    startupPhaseRef.current = "graph_built";
    recordDiagnosticsEvent({
      level: "info",
      eventKey: "graph_built",
      message: "Built and centered the knowledge graph structure.",
      details: {
        datasetSignature,
        layoutGeneration: layoutGenerationRef.current
      }
    });

    if (!canUseWebGL()) {
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      setFallbackReason("WebGL is unavailable in this browser context.");
      setFallbackCamera(buildFallbackOverviewCameraState(nextGraph));
      verifyStartupInvariant({
        phase: "graph_built",
        allowCorrection: true,
        publishBackendOnFailure: true
      });
    } else {
      try {
        if (!sigmaRef.current) {
          sigmaRef.current = new Sigma(nextGraph, containerRef.current, {
            renderEdgeLabels: false,
            hideEdgesOnMove: true,
            hideLabelsOnMove: true,
            labelRenderedSizeThreshold: 20,
            labelDensity: 0.04,
            labelGridCellSize: 120,
            defaultNodeColor: "#c0c1ff",
            defaultEdgeColor: "rgba(125, 211, 252, 0.1)",
            minCameraRatio: 0.08,
            maxCameraRatio: 4,
            autoRescale: false,
            autoCenter: false,
            enableEdgeEvents: false,
            enableCameraPanning: true,
            zIndex: true
          });
          recordDiagnosticsEvent({
            level: "info",
            eventKey: "sigma_initialized",
            message: "Initialized Sigma for the knowledge graph.",
            details: {
              datasetSignature
            }
          });

          sigmaRef.current.on("clickNode", ({ node }) => {
            if (isSelectionSuppressedAfterDrag()) {
              return;
            }
            const nextNode = nodeMapRef.current.get(node) ?? null;
            onSelectNodeRef.current(nextNode);
          });
          sigmaRef.current.on("clickStage", ({ event }) => {
            if (isSelectionSuppressedAfterDrag()) {
              return;
            }
            if (!sigmaRef.current || !graphRef.current) {
              onSelectNodeRef.current(null);
              return;
            }
            const nearestNodeId = findNearestViewportNode({
              sigma: sigmaRef.current,
              graph: graphRef.current,
              viewportX: event.x,
              viewportY: event.y
            });
            if (nearestNodeId) {
              onSelectNodeRef.current(nodeMapRef.current.get(nearestNodeId) ?? null);
              return;
            }
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
              offsetY: current.y - graphPosition.y,
              startViewportX: event.x,
              startViewportY: event.y,
              currentX: current.x,
              currentY: current.y,
              moved: false
            };
            previousPanningEnabledRef.current =
              sigmaRef.current.getSetting("enableCameraPanning") ?? true;
            sigmaRef.current.setSetting("enableCameraPanning", false);
            setDraggedNodeId(node);
            setHoveredNodeId(node);
            recordDiagnosticsEvent({
              level: "debug",
              eventKey: "drag_start",
              message: "Started dragging a knowledge graph node.",
              details: {
                nodeId: node
              }
            });
            workerRef.current?.postMessage({
              type: "drag-start",
              nodeId: node
            } satisfies KnowledgeGraphLayoutWorkerMessage);
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
            const movedDistance = Math.hypot(
              event.x - dragStateRef.current.startViewportX,
              event.y - dragStateRef.current.startViewportY
            );
            if (movedDistance > 3) {
              dragStateRef.current = {
                ...dragStateRef.current,
                moved: true
              };
            }
            const nextX = graphPosition.x + dragStateRef.current.offsetX;
            const nextY = graphPosition.y + dragStateRef.current.offsetY;
            dragStateRef.current = {
              ...dragStateRef.current,
              currentX: nextX,
              currentY: nextY
            };
            graphRef.current.mergeNodeAttributes(dragStateRef.current.nodeId, {
              x: nextX,
              y: nextY
            });
            positionCacheRef.current.set(dragStateRef.current.nodeId, {
              x: nextX,
              y: nextY
            });
            workerRef.current?.postMessage({
              type: "drag-move",
              nodeId: dragStateRef.current.nodeId,
              x: nextX,
              y: nextY
            } satisfies KnowledgeGraphLayoutWorkerMessage);
            safeRefreshSigma();
          });
          const releaseDraggedNode = () => {
            if (!sigmaRef.current || !dragStateRef.current) {
              dragStateRef.current = null;
              setDraggedNodeId(null);
              return;
            }
            const releasedNodeId = dragStateRef.current.nodeId;
            const didMove = dragStateRef.current.moved;
            sigmaRef.current.setSetting(
              "enableCameraPanning",
              previousPanningEnabledRef.current
            );
            workerRef.current?.postMessage({
              type: "drag-end",
              nodeId: releasedNodeId
            } satisfies KnowledgeGraphLayoutWorkerMessage);
            recordDiagnosticsEvent({
              level: "debug",
              eventKey: "drag_end",
              message: "Released a dragged knowledge graph node.",
              details: {
                nodeId: releasedNodeId,
                moved: didMove
              }
            });
            dragStateRef.current = null;
            setDraggedNodeId(null);
            if (didMove) {
              suppressSelectionUntilRef.current = Date.now() + 220;
              onSelectNodeRef.current(
                nodeMapRef.current.get(releasedNodeId) ?? null
              );
            }
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
            if (!startupFirstFrameHandledRef.current) {
              startupFirstFrameHandledRef.current = true;
              startupPhaseRef.current = "first_frame";
              recordDiagnosticsEvent({
                level: "info",
                eventKey: "first_frame",
                message: "Knowledge graph rendered its first frame.",
                details: {
                  datasetSignature: datasetSignatureRef.current
                }
              });
              verifyStartupInvariant({
                phase: "first_frame",
                allowCorrection: true,
                publishBackendOnFailure: true
              });
              recordSnapshot({
                rendererMode: "sigma",
                publishAnomaly: true
              });
            }
            publishCurrentDiagnostics();
          });
        } else {
          sigmaRef.current.setGraph(nextGraph);
          safeRefreshSigma();
        }

        setFallbackReason(null);
        setFallbackSnapshot(buildFallbackSnapshot(nextGraph, renderedEdges));
        sigmaRef.current.getCamera().setState(buildSigmaOverviewCameraState(nextGraph));
      } catch (error) {
        sigmaRef.current?.kill();
        sigmaRef.current = null;
        setFallbackReason(
          error instanceof Error ? error.message : "Graph renderer unavailable."
        );
        setFallbackSnapshot(buildFallbackSnapshot(nextGraph, renderedEdges));
        setFallbackCamera(buildFallbackOverviewCameraState(nextGraph));
        recordDiagnosticsEvent({
          level: "error",
          eventKey: "sigma_fallback",
          message: "Fell back from Sigma to the SVG renderer.",
          publishBackend: true,
          details: {
            datasetSignature,
            reason: error instanceof Error ? error.message : "unknown"
          }
        });
        verifyStartupInvariant({
          phase: "graph_built",
          allowCorrection: true,
          publishBackendOnFailure: true
        });
      }
    }

    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("./knowledge-graph-layout.worker.ts", import.meta.url),
        { type: "module" }
      );
      workerRef.current.onmessage = (
        event: MessageEvent<KnowledgeGraphLayoutWorkerResponse>
      ) => {
        if (!graphRef.current) {
          return;
        }
        const message = event.data;
        if (message.type === "stats") {
          simulationPhaseRef.current = message.phase;
          primaryFocusedNodeIdRef.current = message.primaryFocusedNodeId;
          focusSourcesRef.current = message.focusSources;
          focusPressureRef.current = message.focusPressure;
          centroidRef.current = message.centroid;
          if (!startupWorkerVerificationHandledRef.current) {
            startupWorkerVerificationHandledRef.current = true;
            startupPhaseRef.current = "worker_started";
            recordDiagnosticsEvent({
              level: "info",
              eventKey: "worker_started",
              message: "Knowledge graph worker reported its first simulation stats.",
              details: {
                datasetSignature: datasetSignatureRef.current,
                phase: message.phase
              }
            });
            verifyStartupInvariant({
              phase: "worker_started",
              allowCorrection: true,
              publishBackendOnFailure: true
            });
          }
          return;
        }
        const currentGraph = graphRef.current;
        let nextX = message.x;
        let nextY = message.y;
        if (startupPhaseRef.current !== "startup_verified") {
          const recentered = recenterPositionArraysAroundOrigin({
            x: message.x,
            y: message.y
          });
          if (recentered.changed) {
            nextX = recentered.x;
            nextY = recentered.y;
            workerRef.current?.postMessage({
              type: "recenter-graph",
              offsetX: recentered.offsetX,
              offsetY: recentered.offsetY
            } satisfies KnowledgeGraphLayoutWorkerMessage);
            resetCameraToOrigin();
            recordDiagnosticsEvent({
              level: "warning",
              eventKey: "worker_startup_recenter",
              message:
                "Recentering worker positions during startup because the graph drifted away from origin.",
              details: {
                datasetSignature: datasetSignatureRef.current,
                startupPhase: startupPhaseRef.current,
                offsetX: recentered.offsetX,
                offsetY: recentered.offsetY
              }
            });
          }
        }
        let nodeIndex = 0;
        currentGraph.updateEachNodeAttributes(
          (nodeId, attributes) => ({
            ...attributes,
            x: nextX[nodeIndex],
            y: nextY[nodeIndex++]
          }),
          {
            attributes: ["x", "y"]
          }
        );
        if (dragStateRef.current && currentGraph.hasNode(dragStateRef.current.nodeId)) {
          const draggedNodeId = dragStateRef.current.nodeId;
          currentGraph.mergeNodeAttributes(draggedNodeId, {
            x: dragStateRef.current.currentX,
            y: dragStateRef.current.currentY
          });
        }
        rememberGraphPositions(currentGraph, positionCacheRef.current);
        if (sigmaRef.current) {
          safeRefreshSigma();
        } else {
          setFallbackSnapshot(buildFallbackSnapshot(currentGraph, renderedEdges));
        }
      };
    }

    const nodeOrder = nextGraph.nodes();
    const nodeIndexById = new Map(nodeOrder.map((nodeId, index) => [nodeId, index]));
    const hopLevels = buildKnowledgeGraphHopLevels(nodeOrder, renderedEdges, focusNodeId);
    workerRef.current.postMessage({
      type: "init-graph",
      nodes: nodeOrder.map((nodeId) => {
        const attributes = nextGraph.getNodeAttributes(nodeId);
        return {
          id: nodeId,
          x: attributes.x,
          y: attributes.y,
          size: attributes.size,
          mass: Math.max(1, attributes.data.importance / 42),
          importance: attributes.data.importance
        };
      }),
      edges: renderedEdges
        .filter((edge) => nodeIndexById.has(edge.source) && nodeIndexById.has(edge.target))
        .map((edge) => ({
          source: nodeIndexById.get(edge.source)!,
          target: nodeIndexById.get(edge.target)!,
          weight: Math.max(0.6, edge.strength)
        })),
      focusNodeId,
      hopLevels,
      physics: physicsSettings
    } satisfies KnowledgeGraphLayoutWorkerMessage);
    recordDiagnosticsEvent({
      level: "debug",
      eventKey: "worker_init",
      message: "Posted the graph payload to the layout worker.",
      details: {
        datasetSignature,
        nodeCount: nodeOrder.length,
        edgeCount: renderedEdges.length
      }
    });
  }, [
    containerSize.height,
    containerSize.width,
    datasetSignature,
    focusNodeId,
    nodes,
    physicsSettings,
    renderedEdges
  ]);

  useEffect(() => {
    if (!workerRef.current || !graphRef.current) {
      return;
    }
    const hopLevels = buildKnowledgeGraphHopLevels(
      graphRef.current.nodes(),
      renderedEdges,
      focusNodeId
    );
    workerRef.current.postMessage({
      type: "set-focus",
      focusNodeId,
      hopLevels
    } satisfies KnowledgeGraphLayoutWorkerMessage);
    recordDiagnosticsEvent({
      level: "debug",
      eventKey: "focus_set",
      message: "Updated the focused node in the graph worker.",
      details: {
        focusNodeId
      }
    });

    if (!focusNodeId) {
      desiredCameraRef.current = null;
    }
  }, [focusNodeId, renderedEdges]);

  useEffect(() => {
    if (!workerRef.current) {
      return;
    }
    workerRef.current.postMessage({
      type: "update-physics",
      physics: physicsSettings
    } satisfies KnowledgeGraphLayoutWorkerMessage);
  }, [physicsSettings]);

  useEffect(() => {
    if (!diagnosticsEnabled || !graphRef.current || !datasetSignatureRef.current) {
      return;
    }
    const interval = window.setInterval(() => {
      lastDiagnosticsPublishAtRef.current = 0;
      publishCurrentDiagnostics();
      recordSnapshot({
        rendererMode: getCurrentRendererMode(),
        publishAnomaly: true
      });
    }, KNOWLEDGE_GRAPH_PERIODIC_SNAPSHOT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [datasetSignature, diagnosticsEnabled]);

  useEffect(() => {
    if (!sigmaRef.current || !graphRef.current) {
      return;
    }

    sigmaRef.current.setSetting("nodeReducer", (nodeId, attributes) => {
      const node = graphRef.current?.getNodeAttribute(nodeId, "data") as KnowledgeGraphNode;
      return reduceKnowledgeGraphSigmaNodeAttributes({
        nodeId,
        attributes: attributes as SigmaNodeAttributes,
        node,
        focusNodeId,
        relatedNodeIds,
        detailNodeIds,
        hoveredNodeId,
        draggedNodeId
      });
    });
    sigmaRef.current.setSetting("edgeReducer", (edgeId, attributes) => {
      const edge = graphRef.current?.getEdgeAttribute(
        edgeId,
        "data"
      ) as RenderedKnowledgeGraphEdge;
      return reduceKnowledgeGraphSigmaEdgeAttributes({
        attributes: attributes as SigmaEdgeAttributes,
        edge,
        focusNodeId,
        detailNodeIds,
        relatedNodeIds,
        hoveredNodeId
      });
    });
    safeRefreshSigma();
  }, [detailNodeIds, draggedNodeId, focusNodeId, hoveredNodeId, relatedNodeIds]);

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
    if (!startupFirstFrameHandledRef.current) {
      startupFirstFrameHandledRef.current = true;
      startupPhaseRef.current = "first_frame";
      recordDiagnosticsEvent({
        level: "info",
        eventKey: "fallback_first_frame",
        message: "Knowledge graph rendered its first fallback frame.",
        details: {
          datasetSignature: datasetSignatureRef.current,
          reason: fallbackReason
        }
      });
      verifyStartupInvariant({
        phase: "first_frame",
        allowCorrection: true,
        publishBackendOnFailure: true
      });
      recordSnapshot({
        rendererMode: "fallback",
        publishAnomaly: true
      });
    }
    publishFallbackKnowledgeGraphDiagnostics({
      datasetSignature: datasetSignatureRef.current,
      focusNodeId,
      primaryFocusedNodeId: primaryFocusedNodeIdRef.current,
      draggedNodeId: dragStateRef.current?.nodeId ?? null,
      layoutGeneration: layoutGenerationRef.current,
      camera: fallbackCamera,
      snapshot: fallbackSnapshot,
      width: containerSize.width,
      height: containerSize.height,
      startupPhase: startupPhaseRef.current,
      startupInvariantSatisfied:
        buildCurrentStatus({ rendererMode: "fallback" })?.startupInvariantSatisfied ??
        false,
      simulationPhase: simulationPhaseRef.current,
      focusSources: focusSourcesRef.current,
      focusPressure: focusPressureRef.current,
      centroid: centroidRef.current,
      cameraTarget: desiredCameraRef.current
        ? {
            x: desiredCameraRef.current.x,
            y: desiredCameraRef.current.y,
            ratio: desiredCameraRef.current.ratio
          }
        : null,
      latestSnapshotAt: latestSnapshotAtRef.current,
      latestSnapshotNodeCount: latestSnapshotNodeCountRef.current
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
    if (!fallbackSnapshot || containerSize.width <= 0 || containerSize.height <= 0) {
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
    <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.1),transparent_34%),linear-gradient(180deg,rgba(7,12,23,0.98),rgba(6,11,20,0.98))]">
      <div
        ref={containerRef}
        className="h-full w-full touch-none"
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
              const touchesHover =
                !!hoveredNodeId &&
                (edge.source === hoveredNodeId || edge.target === hoveredNodeId);
              const sourceDistance =
                !focusNodeId
                  ? 0
                  : edge.source === focusNodeId
                    ? 0
                    : detailNodeIds.has(edge.source)
                      ? 1
                      : relatedNodeIds.has(edge.source)
                        ? 2
                        : 3;
              const targetDistance =
                !focusNodeId
                  ? 0
                  : edge.target === focusNodeId
                    ? 0
                    : detailNodeIds.has(edge.target)
                      ? 1
                      : relatedNodeIds.has(edge.target)
                        ? 2
                        : 3;
              const edgeDistance = focusNodeId
                ? Math.max(sourceDistance, targetDistance)
                : 0;
              return (
                <line
                  key={edge.id}
                  x1={source.viewportX}
                  y1={source.viewportY}
                  x2={target.viewportX}
                  y2={target.viewportY}
                  stroke={
                    touchesFocus
                      ? buildKnowledgeGraphEdgeStroke(edge, 0.24)
                      : touchesHover
                        ? buildKnowledgeGraphEdgeStroke(edge, 0.14)
                        : !focusNodeId
                          ? buildKnowledgeGraphEdgeStroke(edge, 0.055)
                          : edgeDistance <= 1
                            ? buildKnowledgeGraphEdgeStroke(edge, 0.09)
                            : edgeDistance === 2
                              ? buildKnowledgeGraphEdgeStroke(edge, 0.05)
                              : buildKnowledgeGraphEdgeStroke(edge, 0.016)
                  }
                  strokeWidth={touchesFocus ? 1.7 : touchesHover ? 1.3 : 0.95}
                />
              );
            })}
            {fallbackProjectedNodes.map((node) => {
              const focused = focusNodeId === node.id;
              const related = relatedNodeIds.has(node.id);
              const detailed = detailNodeIds.has(node.id);
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
                        ? node.viewportSize * 1.9
                        : hovered
                          ? node.viewportSize * 1.3
                          : detailed
                            ? node.viewportSize * 1.15
                            : related
                              ? node.viewportSize * 1.05
                              : node.viewportSize
                    }
                    fill={inNeighborhood ? node.color : fadeColor(node.color, 0.3)}
                    stroke={focused ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0.12)"}
                    strokeWidth={focused ? 2 : 1}
                  />
                  {(focused || hovered || detailed) && (
                    <text
                      x={node.viewportSize * 1.5}
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
