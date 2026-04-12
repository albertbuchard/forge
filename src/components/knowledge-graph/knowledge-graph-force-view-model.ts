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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

  orderedNodes.forEach((node, index) => {
    const cached = cache.get(node.id);
    if (cached) {
      positions.set(node.id, cached);
      return;
    }

    const jitter = ((hashString(node.id) % 1000) / 1000 - 0.5) * 0.22;
    const angle = index * GOLDEN_ANGLE + jitter;
    const radius = PHYLLOTAXIS_STEP * Math.sqrt(index + 1);
    positions.set(node.id, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    });
  });

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

export function reduceKnowledgeGraphSigmaNodeAttributes({
  nodeId,
  attributes,
  node,
  focusNodeId,
  relatedNodeIds,
  hoveredNodeId,
  draggedNodeId
}: {
  nodeId: string;
  attributes: SigmaNodeDisplayAttributesLike;
  node: KnowledgeGraphNode;
  focusNodeId: string | null;
  relatedNodeIds: Set<string>;
  hoveredNodeId: string | null;
  draggedNodeId?: string | null;
}): SigmaNodeDisplayAttributesLike {
  const focused = focusNodeId === nodeId;
  const related = relatedNodeIds.has(nodeId);
  const hovered = hoveredNodeId === nodeId;
  const dragged = draggedNodeId === nodeId;
  const inNeighborhood = !focusNodeId || related;
  const baseColor = attributes.color;

  return {
    ...attributes,
    label: focused || hovered || related || dragged ? node.title : "",
    forceLabel: focused || hovered || related || dragged,
    highlighted: focused || hovered || related || dragged,
    color: inNeighborhood ? baseColor : fadeColor(baseColor, 0.18),
    size: dragged
      ? attributes.size * 2
      : focused
      ? attributes.size * 1.8
      : hovered
        ? attributes.size * 1.35
        : related
          ? attributes.size * 1.16
          : attributes.size,
    zIndex: dragged ? 4 : focused ? 3 : related || hovered ? 2 : 1
  };
}

export function reduceKnowledgeGraphSigmaEdgeAttributes({
  attributes,
  edge,
  focusNodeId,
  relatedNodeIds
}: {
  attributes: SigmaEdgeDisplayAttributesLike;
  edge: RenderedKnowledgeGraphEdge;
  focusNodeId: string | null;
  relatedNodeIds: Set<string>;
}): SigmaEdgeDisplayAttributesLike {
  const touchesFocus =
    !!focusNodeId &&
    (edge.source === focusNodeId || edge.target === focusNodeId);
  const inNeighborhood =
    !focusNodeId ||
    (relatedNodeIds.has(edge.source) && relatedNodeIds.has(edge.target));

  return {
    ...attributes,
    color: touchesFocus
      ? "rgba(238,242,255,0.62)"
      : inNeighborhood
        ? "rgba(255,255,255,0.18)"
        : "rgba(255,255,255,0.04)",
    size: touchesFocus ? attributes.size * 1.3 : attributes.size,
    zIndex: touchesFocus ? 2 : 0
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
    ? clamp(Math.min(currentRatio, 0.3), 0.18, 0.3)
    : clamp((localSpan / globalSpan) * 1.55, 0.2, Math.max(currentRatio, 0.95));

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    ratio,
    nodeIds: neighborhoodNodeIds
  };
}
