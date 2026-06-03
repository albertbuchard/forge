import Graph from "graphology";
import type { Attributes } from "graphology-types";
import type Sigma from "sigma";
import type { CameraState } from "sigma/types";
import {
  buildKnowledgeGraphOverviewCameraTarget,
  buildKnowledgeGraphSeedPositions,
  type KnowledgeGraphSeedPosition
} from "@/components/knowledge-graph/knowledge-graph-force-view-model";
import { recenterKnowledgeGraphPointsAroundOrigin } from "@/lib/knowledge-graph-dev-diagnostics";
import type { RenderedKnowledgeGraphEdge } from "@/lib/knowledge-graph";
import type { KnowledgeGraphNode } from "@/lib/knowledge-graph-types";

export type SigmaNodeAttributes = Attributes & {
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

export type SigmaEdgeAttributes = Attributes & {
  size: number;
  color: string;
  hidden: boolean;
  label: string;
  forceLabel: boolean;
  zIndex: number;
  data: RenderedKnowledgeGraphEdge;
};

export type PositionSnapshot = {
  x: number;
  y: number;
};

export type DragState = {
  nodeId: string;
  offsetX: number;
  offsetY: number;
  startViewportX: number;
  startViewportY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
};

export type FallbackGraphNode = SigmaNodeAttributes & {
  id: string;
};

export type FallbackGraphSnapshot = {
  nodes: FallbackGraphNode[];
  edges: RenderedKnowledgeGraphEdge[];
};

export type DesiredCameraTarget = CameraState & {
  nodeIds?: string[];
};

let WEBGL_SUPPORT_CACHE: boolean | null = null;

export function canUseWebGL() {
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
  const bodyValue = document.body
    ? getComputedStyle(document.body).getPropertyValue(token).trim()
    : "";
  const rootValue = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  const value = bodyValue || rootValue;
  if (!value) {
    return "#c0c1ff";
  }
  return `rgb(${value})`;
}

export function fadeColor(color: string, alpha: number) {
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

export function rememberGraphPositions(
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

export function createGraphFromData(
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

export function recenterGraphAroundOrigin(
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

export function buildPositionMapFromGraph(
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

export function buildFallbackSnapshot(
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

export function getFallbackCameraForSnapshot(
  snapshot: FallbackGraphSnapshot
): CameraState {
  const overview = buildKnowledgeGraphOverviewCameraTarget({
    positions: new Map(
      snapshot.nodes.map((node) => [
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

export function recenterPositionArraysAroundOrigin({
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

export function projectFallbackNode({
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

export function isContainerReady(
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

export function findNearestViewportNode({
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

export function buildKnowledgeGraphEdgeStroke(
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
