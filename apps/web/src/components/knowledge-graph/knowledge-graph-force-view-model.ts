import type { RenderedKnowledgeGraphEdge } from "@/lib/knowledge-graph";
import type { KnowledgeGraphNode } from "@/lib/knowledge-graph-types";
import {
  buildKnowledgeGraphEdgeStroke,
  fadeKnowledgeGraphColor
} from "@/components/knowledge-graph/knowledge-graph-theme";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const PHYLLOTAXIS_STEP = 0.48;
const SIGMA_OVERVIEW_RATIO_BASE = 0.94;
const SIGMA_OVERVIEW_RATIO_SCALE = 0.06;
const SIGMA_OVERVIEW_RATIO_MIN = 1.02;
const SIGMA_OVERVIEW_RATIO_MAX = 1.14;

export type KnowledgeGraphRenderQuality = "full" | "balanced" | "reduced";

export type KnowledgeGraphAdaptiveQualityState = {
  quality: KnowledgeGraphRenderQuality;
  pressuredWindows: number;
  healthyWindows: number;
};

export function isKnowledgeGraphPresentationCompletion({
  beforeKey,
  requestedKey,
  renderedKey
}: {
  beforeKey: string | null;
  requestedKey: string | null;
  renderedKey: string | null;
}) {
  return (
    requestedKey !== null &&
    requestedKey !== beforeKey &&
    renderedKey === requestedKey
  );
}

export type KnowledgeGraphPresentationRenderState = {
  requestedKey: string;
  pendingKey: string | null;
  renderedKey: string | null;
};

export function requestKnowledgeGraphPresentation(
  state: KnowledgeGraphPresentationRenderState,
  key: string
): KnowledgeGraphPresentationRenderState {
  return { ...state, requestedKey: key };
}

export function beginKnowledgeGraphPresentationRender(
  state: KnowledgeGraphPresentationRenderState
): KnowledgeGraphPresentationRenderState {
  return { ...state, pendingKey: state.requestedKey };
}

export function completeKnowledgeGraphPresentationRender(
  state: KnowledgeGraphPresentationRenderState
): KnowledgeGraphPresentationRenderState {
  return state.pendingKey === null
    ? state
    : { ...state, renderedKey: state.pendingKey, pendingKey: null };
}

export function advanceKnowledgeGraphAdaptiveQuality(
  state: KnowledgeGraphAdaptiveQualityState,
  observation: {
    frameP95Ms: number;
    interactionActive: boolean;
    visibleEdgeCount: number;
  }
): KnowledgeGraphAdaptiveQualityState {
  const requested = resolveKnowledgeGraphRenderQuality({
    currentQuality: state.quality,
    ...observation
  });
  const rank = { full: 0, balanced: 1, reduced: 2 } as const;
  if (rank[requested] > rank[state.quality]) {
    const pressuredWindows = state.pressuredWindows + 1;
    return pressuredWindows >= 2
      ? { quality: requested, pressuredWindows: 0, healthyWindows: 0 }
      : { ...state, pressuredWindows, healthyWindows: 0 };
  }
  if (rank[requested] < rank[state.quality]) {
    const healthyWindows = state.healthyWindows + 1;
    return healthyWindows >= 3
      ? { quality: requested, pressuredWindows: 0, healthyWindows: 0 }
      : { ...state, pressuredWindows: 0, healthyWindows };
  }
  return { ...state, pressuredWindows: 0, healthyWindows: 0 };
}

export function buildKnowledgeGraphViewportNodeIds({
  nodes,
  width,
  height,
  padding,
  preserveNodeIds,
  cullAbove = 240,
  preserveAll = false
}: {
  nodes: Array<{ id: string; viewportX: number; viewportY: number }>;
  width: number;
  height: number;
  padding: number;
  preserveNodeIds: ReadonlySet<string>;
  cullAbove?: number;
  preserveAll?: boolean;
}) {
  if (preserveAll || nodes.length <= cullAbove || width <= 0 || height <= 0) {
    return new Set(nodes.map((node) => node.id));
  }
  const visible = new Set(
    nodes
      .filter(
        (node) =>
          node.viewportX >= -padding &&
          node.viewportX <= width + padding &&
          node.viewportY >= -padding &&
          node.viewportY <= height + padding
      )
      .map((node) => node.id)
  );
  preserveNodeIds.forEach((nodeId) => visible.add(nodeId));
  return visible;
}

export function resolveKnowledgeGraphRenderQuality({
  currentQuality,
  frameP95Ms,
  interactionActive,
  visibleEdgeCount
}: {
  currentQuality: KnowledgeGraphRenderQuality;
  frameP95Ms: number;
  interactionActive: boolean;
  visibleEdgeCount: number;
}): KnowledgeGraphRenderQuality {
  if (frameP95Ms > 25) {
    return "reduced";
  }
  if (frameP95Ms > 18 || (interactionActive && visibleEdgeCount > 1_500)) {
    return "balanced";
  }
  if (interactionActive) {
    return currentQuality;
  }
  if (currentQuality === "reduced") {
    return frameP95Ms <= 16 ? "balanced" : "reduced";
  }
  if (currentQuality === "balanced") {
    return frameP95Ms <= 14 ? "full" : "balanced";
  }
  return "full";
}

function hashKnowledgeGraphRenderId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function shouldRenderKnowledgeGraphEdgeAtQuality({
  edge,
  quality,
  preserve
}: {
  edge: RenderedKnowledgeGraphEdge;
  quality: KnowledgeGraphRenderQuality;
  preserve: boolean;
}) {
  if (preserve || quality === "full" || edge.structural) {
    return true;
  }
  if (edge.strength >= 1.1) {
    return true;
  }
  const divisor = quality === "balanced" ? 2 : 4;
  return hashKnowledgeGraphRenderId(edge.id) % divisor === 0;
}

export function buildVisibleRenderedKnowledgeGraphEdgeIds(
  renderedEdges: RenderedKnowledgeGraphEdge[],
  visibleSourceEdgeIds: ReadonlySet<string>
) {
  return new Set(
    renderedEdges
      .filter((edge) =>
        edge.data.some((sourceEdge) => visibleSourceEdgeIds.has(sourceEdge.id))
      )
      .map((edge) => edge.id)
  );
}

export function buildKnowledgeGraphFallbackKeyboardPositions(
  nodes: Array<{ id: string; viewportX: number; viewportY: number }>
) {
  return new Map(
    nodes.map((node) => [node.id, { x: node.viewportX, y: node.viewportY }])
  );
}

export function resolveKnowledgeGraphKeyboardTarget({
  key,
  nodeIds,
  focusNodeId,
  nodePositions
}: {
  key: string;
  nodeIds: string[];
  focusNodeId: string | null;
  nodePositions?: ReadonlyMap<string, { x: number; y: number }>;
}): { handled: boolean; targetNodeId: string | null } {
  if (nodeIds.length === 0) {
    return { handled: false, targetNodeId: null };
  }
  const currentIndex = focusNodeId ? nodeIds.indexOf(focusNodeId) : -1;
  if (key === "Escape") {
    return { handled: true, targetNodeId: null };
  }
  if (key === "Enter" || key === " ") {
    return {
      handled: true,
      targetNodeId: nodeIds[Math.max(currentIndex, 0)] ?? null
    };
  }
  if (key === "Home") {
    return { handled: true, targetNodeId: nodeIds[0] ?? null };
  }
  if (key === "End") {
    return {
      handled: true,
      targetNodeId: nodeIds[nodeIds.length - 1] ?? null
    };
  }
  const direction =
    key === "ArrowRight"
      ? { x: 1, y: 0 }
      : key === "ArrowLeft"
        ? { x: -1, y: 0 }
        : key === "ArrowDown"
          ? { x: 0, y: 1 }
          : key === "ArrowUp"
            ? { x: 0, y: -1 }
            : null;
  if (direction) {
    if (currentIndex < 0) {
      return { handled: true, targetNodeId: nodeIds[0] ?? null };
    }
    const currentPosition = focusNodeId
      ? nodePositions?.get(focusNodeId)
      : undefined;
    if (currentPosition && nodePositions) {
      const spatialTarget = nodeIds
        .filter((nodeId) => nodeId !== focusNodeId)
        .map((nodeId) => {
          const position = nodePositions.get(nodeId);
          if (!position) {
            return null;
          }
          const deltaX = position.x - currentPosition.x;
          const deltaY = position.y - currentPosition.y;
          const projection = deltaX * direction.x + deltaY * direction.y;
          if (projection <= 0) {
            return null;
          }
          const perpendicular = Math.abs(
            deltaX * direction.y - deltaY * direction.x
          );
          const distance = Math.hypot(deltaX, deltaY);
          return {
            nodeId,
            score: distance * (1 + (perpendicular / projection) * 2)
          };
        })
        .filter(
          (candidate): candidate is { nodeId: string; score: number } =>
            candidate !== null
        )
        .sort(
          (left, right) =>
            left.score - right.score || left.nodeId.localeCompare(right.nodeId)
        )[0];
      return {
        handled: true,
        targetNodeId: spatialTarget?.nodeId ?? focusNodeId
      };
    }
    return {
      handled: true,
      targetNodeId:
        nodeIds[
          key === "ArrowRight" || key === "ArrowDown"
            ? (currentIndex + 1) % nodeIds.length
            : (currentIndex - 1 + nodeIds.length) % nodeIds.length
        ] ?? null
    };
  }
  return { handled: false, targetNodeId: focusNodeId };
}

export type SigmaNodeDisplayAttributesLike = {
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

export type SigmaEdgeDisplayAttributesLike = {
  size: number;
  color: string;
  hidden: boolean;
  label: string;
  forceLabel: boolean;
  zIndex: number;
  data: RenderedKnowledgeGraphEdge;
};

export type KnowledgeGraphSeedPosition = {
  x: number;
  y: number;
};

export type KnowledgeGraphPositionLike = {
  x: number;
  y: number;
};

type KnowledgeGraphNodeFocusDistanceContext = {
  focusNodeId: string | null;
  detailNodeIds: Set<string>;
  relatedNodeIds: Set<string>;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function buildKnowledgeGraphFramedGraphPosition({
  positions,
  point
}: {
  positions: Map<string, KnowledgeGraphPositionLike>;
  point: KnowledgeGraphPositionLike;
}) {
  const values = [...positions.values()];
  if (values.length === 0) {
    return {
      x: 0.5,
      y: 0.5
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const position of values) {
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x);
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y);
  }

  const spanX = Math.max(maxX - minX, 0);
  const spanY = Math.max(maxY - minY, 0);
  const dominantSpan = Math.max(spanX, spanY, 1);
  const insetX = (1 - spanX / dominantSpan) / 2;
  const insetY = (1 - spanY / dominantSpan) / 2;
  const safeSpanX = spanX || 1;
  const safeSpanY = spanY || 1;

  return {
    x: clamp(
      ((point.x - minX) / safeSpanX) * (spanX / dominantSpan) + insetX,
      0,
      1
    ),
    y: clamp(
      ((point.y - minY) / safeSpanY) * (spanY / dominantSpan) + insetY,
      0,
      1
    )
  };
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildKnowledgeGraphSeedPositions({
  nodes,
  cache
}: {
  nodes: KnowledgeGraphNode[];
  cache: Map<string, KnowledgeGraphSeedPosition>;
}) {
  const positions = new Map<string, KnowledgeGraphSeedPosition>();
  const orderedNodes = [...nodes].sort(
    (left, right) =>
      right.importance - left.importance ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id)
  );

  let sumX = 0;
  let sumY = 0;
  let counted = 0;

  orderedNodes.forEach((node, index) => {
    const cached = cache.get(node.id);
    if (cached) {
      positions.set(node.id, cached);
      sumX += cached.x;
      sumY += cached.y;
      counted += 1;
      return;
    }

    const jitter = ((hashString(node.id) % 1000) / 1000 - 0.5) * 0.22;
    const angle = index * GOLDEN_ANGLE + jitter;
    const radius = PHYLLOTAXIS_STEP * Math.sqrt(index + 1);
    const seeded = {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
    positions.set(node.id, seeded);
    sumX += seeded.x;
    sumY += seeded.y;
    counted += 1;
  });

  if (counted > 0) {
    const centerX = sumX / counted;
    const centerY = sumY / counted;
    positions.forEach((position, nodeId) => {
      positions.set(nodeId, {
        x: position.x - centerX,
        y: position.y - centerY
      });
    });
  }

  return positions;
}

function getKnowledgeGraphNodeFocusDistance(
  nodeId: string,
  context: KnowledgeGraphNodeFocusDistanceContext
) {
  if (!context.focusNodeId) {
    return 0;
  }
  if (nodeId === context.focusNodeId) {
    return 0;
  }
  if (context.detailNodeIds.has(nodeId)) {
    return 1;
  }
  if (context.relatedNodeIds.has(nodeId)) {
    return 2;
  }
  return 3;
}

export function reduceKnowledgeGraphSigmaNodeAttributes({
  nodeId,
  attributes,
  node,
  focusNodeId,
  relatedNodeIds,
  detailNodeIds,
  hoveredNodeId,
  draggedNodeId,
  presentationVisible = true,
  ambientLabelVisible = false
}: {
  nodeId: string;
  attributes: SigmaNodeDisplayAttributesLike;
  node: KnowledgeGraphNode;
  focusNodeId: string | null;
  relatedNodeIds: Set<string>;
  detailNodeIds: Set<string>;
  hoveredNodeId: string | null;
  draggedNodeId?: string | null;
  presentationVisible?: boolean;
  ambientLabelVisible?: boolean;
}): SigmaNodeDisplayAttributesLike {
  const focused = focusNodeId === nodeId;
  const related = relatedNodeIds.has(nodeId);
  const detailed = detailNodeIds.has(nodeId);
  const hovered = hoveredNodeId === nodeId;
  const dragged = draggedNodeId === nodeId;
  const inNeighborhood = !focusNodeId || related;
  const baseColor = attributes.color;

  return {
    ...attributes,
    hidden: !presentationVisible,
    label:
      focused || hovered || dragged || ambientLabelVisible ? node.title : "",
    forceLabel: focused || hovered || dragged,
    highlighted: focused || hovered || dragged,
    color: inNeighborhood
      ? baseColor
      : fadeKnowledgeGraphColor(baseColor, 0.34),
    size: dragged
      ? attributes.size * 2
      : focused
        ? attributes.size * 1.8
        : hovered
          ? attributes.size * 1.35
          : detailed
            ? attributes.size * 1.16
            : related
              ? attributes.size * 1.06
              : attributes.size,
    zIndex: dragged ? 4 : focused ? 3 : detailed || hovered ? 2 : 1
  };
}

export function reduceKnowledgeGraphSigmaEdgeAttributes({
  attributes,
  edge,
  focusNodeId,
  detailNodeIds,
  relatedNodeIds,
  hoveredNodeId,
  presentationVisible = true
}: {
  attributes: SigmaEdgeDisplayAttributesLike;
  edge: RenderedKnowledgeGraphEdge;
  focusNodeId: string | null;
  detailNodeIds: Set<string>;
  relatedNodeIds: Set<string>;
  hoveredNodeId?: string | null;
  presentationVisible?: boolean;
}): SigmaEdgeDisplayAttributesLike {
  const touchesFocus =
    !!focusNodeId &&
    (edge.source === focusNodeId || edge.target === focusNodeId);
  const touchesHover =
    !!hoveredNodeId &&
    (edge.source === hoveredNodeId || edge.target === hoveredNodeId);
  const distanceContext = {
    focusNodeId,
    detailNodeIds,
    relatedNodeIds
  } satisfies KnowledgeGraphNodeFocusDistanceContext;
  const edgeDistance = focusNodeId
    ? Math.max(
        getKnowledgeGraphNodeFocusDistance(edge.source, distanceContext),
        getKnowledgeGraphNodeFocusDistance(edge.target, distanceContext)
      )
    : 0;
  const color = touchesFocus
    ? buildKnowledgeGraphEdgeStroke(edge, 0.24)
    : touchesHover
      ? buildKnowledgeGraphEdgeStroke(edge, 0.14)
      : !focusNodeId
        ? buildKnowledgeGraphEdgeStroke(edge, 0.055)
        : edgeDistance <= 1
          ? buildKnowledgeGraphEdgeStroke(edge, 0.09)
          : edgeDistance === 2
            ? buildKnowledgeGraphEdgeStroke(edge, 0.05)
            : buildKnowledgeGraphEdgeStroke(edge, 0.016);

  return {
    ...attributes,
    hidden: !presentationVisible,
    color,
    size: touchesFocus
      ? attributes.size * 1.18
      : touchesHover
        ? attributes.size * 1.08
        : attributes.size,
    zIndex: touchesFocus ? 2 : touchesHover ? 1 : 0
  };
}

export function buildKnowledgeGraphFocusRings(
  edges: Array<Pick<RenderedKnowledgeGraphEdge, "source" | "target">>,
  focusNodeId: string
) {
  const nodeIds = Array.from(
    new Set(edges.flatMap((edge) => [edge.source, edge.target]))
  );
  return buildKnowledgeGraphFocusRingsFromAdjacency(
    buildKnowledgeGraphAdjacency(nodeIds, edges),
    focusNodeId
  );
}

export type KnowledgeGraphAdjacency = ReadonlyMap<string, ReadonlySet<string>>;

export function buildKnowledgeGraphAdjacency(
  nodeIds: string[],
  edges: Array<Pick<RenderedKnowledgeGraphEdge, "source" | "target">>
): KnowledgeGraphAdjacency {
  const nodeIdSet = new Set(nodeIds);
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) {
      continue;
    }
    const sourceSet = neighbors.get(edge.source) ?? new Set<string>();
    sourceSet.add(edge.target);
    neighbors.set(edge.source, sourceSet);
    const targetSet = neighbors.get(edge.target) ?? new Set<string>();
    targetSet.add(edge.source);
    neighbors.set(edge.target, targetSet);
  }
  return neighbors;
}

export function buildKnowledgeGraphFocusRingsFromAdjacency(
  adjacency: KnowledgeGraphAdjacency,
  focusNodeId: string
) {
  const firstRing = new Set(adjacency.get(focusNodeId) ?? []);
  const secondRing = new Set<string>();
  for (const firstRingNodeId of firstRing) {
    for (const neighborId of adjacency.get(firstRingNodeId) ?? []) {
      if (neighborId !== focusNodeId && !firstRing.has(neighborId)) {
        secondRing.add(neighborId);
      }
    }
  }
  return {
    firstRing: [...firstRing].sort(),
    secondRing: [...secondRing].sort()
  };
}

export function buildKnowledgeGraphHopLevels(
  nodeIds: string[],
  edges: Array<Pick<RenderedKnowledgeGraphEdge, "source" | "target">>,
  focusNodeId: string | null
) {
  return buildKnowledgeGraphHopLevelsFromAdjacency(
    nodeIds,
    buildKnowledgeGraphAdjacency(nodeIds, edges),
    focusNodeId
  );
}

export function buildKnowledgeGraphHopLevelsFromAdjacency(
  nodeIds: string[],
  neighbors: KnowledgeGraphAdjacency,
  focusNodeId: string | null
) {
  if (!focusNodeId) {
    return nodeIds.map(() => -1);
  }

  const nodeIdSet = new Set(nodeIds);
  if (!nodeIdSet.has(focusNodeId)) {
    return nodeIds.map(() => -1);
  }

  const levels = new Map<string, number>([[focusNodeId, 0]]);
  let frontier = [focusNodeId];

  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      const currentLevel = levels.get(nodeId)!;
      for (const neighborId of neighbors.get(nodeId) ?? []) {
        if (levels.has(neighborId)) {
          continue;
        }
        levels.set(neighborId, currentLevel + 1);
        nextFrontier.push(neighborId);
      }
    }
    frontier = nextFrontier;
  }

  return nodeIds.map((nodeId) => levels.get(nodeId) ?? -1);
}

export function buildKnowledgeGraphFocusCameraTarget({
  positions,
  focusNodeId,
  firstRingNodeIds,
  secondRingNodeIds,
  currentRatio
}: {
  positions: Map<string, KnowledgeGraphPositionLike>;
  focusNodeId: string;
  firstRingNodeIds: string[];
  secondRingNodeIds: string[];
  currentRatio: number;
}) {
  const focusPosition = positions.get(focusNodeId);
  if (!focusPosition) {
    return null;
  }

  const neighborhoodNodeIds = [
    focusNodeId,
    ...firstRingNodeIds,
    ...secondRingNodeIds
  ].filter((nodeId, index, values) => values.indexOf(nodeId) === index);

  const neighborhoodPositions = neighborhoodNodeIds
    .map((nodeId) => positions.get(nodeId))
    .filter(Boolean) as KnowledgeGraphPositionLike[];

  if (neighborhoodPositions.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let globalMinX = Number.POSITIVE_INFINITY;
  let globalMaxX = Number.NEGATIVE_INFINITY;
  let globalMinY = Number.POSITIVE_INFINITY;
  let globalMaxY = Number.NEGATIVE_INFINITY;

  for (const position of positions.values()) {
    globalMinX = Math.min(globalMinX, position.x);
    globalMaxX = Math.max(globalMaxX, position.x);
    globalMinY = Math.min(globalMinY, position.y);
    globalMaxY = Math.max(globalMaxY, position.y);
  }

  for (const position of neighborhoodPositions) {
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x);
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y);
  }

  const localSpan = Math.max(maxX - minX, maxY - minY, 0.75);
  const globalSpan = Math.max(
    globalMaxX - globalMinX,
    globalMaxY - globalMinY,
    localSpan
  );
  const ratio =
    neighborhoodPositions.length <= 1
      ? clamp(Math.max(currentRatio, 0.48), 0.38, 0.6)
      : clamp((localSpan / globalSpan) * 1.65, 0.38, 1.45);

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    ratio,
    nodeIds: neighborhoodNodeIds
  };
}

export function buildKnowledgeGraphOverviewCameraTarget({
  positions,
  currentRatio = 1
}: {
  positions: Map<string, KnowledgeGraphPositionLike>;
  currentRatio?: number;
}) {
  const values = [...positions.values()];
  if (values.length === 0) {
    return {
      x: 0,
      y: 0,
      ratio: currentRatio
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const position of values) {
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x);
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y);
  }

  const span = Math.max(maxX - minX, maxY - minY, 1);
  const overviewRatio = clamp(span / 6.4, 0.72, 2.8);

  return {
    x: 0,
    y: 0,
    ratio: Math.max(currentRatio, overviewRatio)
  };
}

export function buildKnowledgeGraphSigmaOverviewRatio(
  fittedOverviewRatio: number
) {
  return clamp(
    SIGMA_OVERVIEW_RATIO_BASE +
      fittedOverviewRatio * SIGMA_OVERVIEW_RATIO_SCALE,
    SIGMA_OVERVIEW_RATIO_MIN,
    SIGMA_OVERVIEW_RATIO_MAX
  );
}
