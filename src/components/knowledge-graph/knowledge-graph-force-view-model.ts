import type { RenderedKnowledgeGraphEdge } from "@/lib/knowledge-graph";
import type { KnowledgeGraphNode } from "@/lib/knowledge-graph-types";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const PHYLLOTAXIS_STEP = 0.48;

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
    x: clamp(((point.x - minX) / safeSpanX) * (spanX / dominantSpan) + insetX, 0, 1),
    y: clamp(((point.y - minY) / safeSpanY) * (spanY / dominantSpan) + insetY, 0, 1)
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

function buildKnowledgeGraphEdgeColor(
  family: RenderedKnowledgeGraphEdge["family"],
  alpha: number
) {
  const rgb =
    family === "structural"
      ? "125, 211, 252"
      : family === "contextual"
        ? "45, 212, 191"
        : family === "taxonomy"
          ? "192, 132, 252"
          : family === "workspace"
            ? "251, 191, 36"
            : "148, 163, 184";
  return `rgba(${rgb}, ${alpha})`;
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
  draggedNodeId
}: {
  nodeId: string;
  attributes: SigmaNodeDisplayAttributesLike;
  node: KnowledgeGraphNode;
  focusNodeId: string | null;
  relatedNodeIds: Set<string>;
  detailNodeIds: Set<string>;
  hoveredNodeId: string | null;
  draggedNodeId?: string | null;
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
    label: focused || hovered || dragged || detailed ? node.title : "",
    forceLabel: focused || hovered || dragged || detailed,
    highlighted: focused || hovered || dragged || detailed,
    color: inNeighborhood ? baseColor : fadeColor(baseColor, 0.34),
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
  hoveredNodeId
}: {
  attributes: SigmaEdgeDisplayAttributesLike;
  edge: RenderedKnowledgeGraphEdge;
  focusNodeId: string | null;
  detailNodeIds: Set<string>;
  relatedNodeIds: Set<string>;
  hoveredNodeId?: string | null;
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
    ? buildKnowledgeGraphEdgeColor(edge.family, 0.24)
    : touchesHover
      ? buildKnowledgeGraphEdgeColor(edge.family, 0.14)
      : !focusNodeId
        ? buildKnowledgeGraphEdgeColor(edge.family, 0.055)
        : edgeDistance <= 1
          ? buildKnowledgeGraphEdgeColor(edge.family, 0.09)
          : edgeDistance === 2
            ? buildKnowledgeGraphEdgeColor(edge.family, 0.05)
            : buildKnowledgeGraphEdgeColor(edge.family, 0.016);

  return {
    ...attributes,
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
  const firstRing = new Set<string>();
  const secondRing = new Set<string>();

  for (const edge of edges) {
    if (edge.source === focusNodeId) {
      firstRing.add(edge.target);
    } else if (edge.target === focusNodeId) {
      firstRing.add(edge.source);
    }
  }

  for (const edge of edges) {
    if (edge.source !== focusNodeId && firstRing.has(edge.source)) {
      secondRing.add(edge.target);
    }
    if (edge.target !== focusNodeId && firstRing.has(edge.target)) {
      secondRing.add(edge.source);
    }
  }

  secondRing.delete(focusNodeId);
  firstRing.forEach((nodeId) => secondRing.delete(nodeId));

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
  if (!focusNodeId) {
    return nodeIds.map(() => -1);
  }

  const nodeIdSet = new Set(nodeIds);
  if (!nodeIdSet.has(focusNodeId)) {
    return nodeIds.map(() => -1);
  }

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
  const globalSpan = Math.max(globalMaxX - globalMinX, globalMaxY - globalMinY, localSpan);
  const ratio = neighborhoodPositions.length <= 1
    ? clamp(Math.max(currentRatio, 0.48), 0.38, 0.6)
    : clamp((localSpan / globalSpan) * 3.2, 0.42, Math.max(currentRatio, 1.12));

  return {
    x: focusPosition.x,
    y: focusPosition.y,
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
