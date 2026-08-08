import { buildKnowledgeGraphHierarchy } from "@/lib/knowledge-graph";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode
} from "@/lib/knowledge-graph-types";

type BuiltKnowledgeGraphHierarchy = ReturnType<
  typeof buildKnowledgeGraphHierarchy
>;

export type KnowledgeGraphHierarchyModel = {
  nodes: BuiltKnowledgeGraphHierarchy["nodes"];
  edges: BuiltKnowledgeGraphHierarchy["edges"];
  nodeById: ReadonlyMap<string, BuiltKnowledgeGraphHierarchy["nodes"][number]>;
  parentById: ReadonlyMap<string, string>;
  parentEdgeByChildId: ReadonlyMap<
    string,
    BuiltKnowledgeGraphHierarchy["edges"][number]
  >;
  primaryEdgeByPair: ReadonlyMap<
    string,
    BuiltKnowledgeGraphHierarchy["edges"][number]
  >;
  primaryChildrenById: ReadonlyMap<string, string[]>;
  primaryParentsById: ReadonlyMap<string, string[]>;
  linkedNodeIdsById: ReadonlyMap<string, string[]>;
  childrenById: ReadonlyMap<string, string[]>;
  rootNodeIds: string[];
};

export function buildKnowledgeGraphHierarchyModel(
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[]
): KnowledgeGraphHierarchyModel {
  const hierarchy = buildKnowledgeGraphHierarchy(nodes, edges);
  const nodeById = new Map(hierarchy.nodes.map((node) => [node.id, node]));
  const parentById = new Map<string, string>();
  const parentEdgeByChildId = new Map<
    string,
    BuiltKnowledgeGraphHierarchy["edges"][number]
  >();
  const primaryEdgeByPair = new Map<
    string,
    BuiltKnowledgeGraphHierarchy["edges"][number]
  >();
  const primaryChildrenById = new Map<string, string[]>();
  const primaryParentsById = new Map<string, string[]>();
  const linkedNodeIdSetsById = new Map<string, Set<string>>();
  const childrenById = new Map<string, string[]>();
  const forwardEdges = hierarchy.edges
    .filter((edge) => !edge.secondary)
    .sort(
      (left, right) =>
        Number(right.structural) - Number(left.structural) ||
        right.strength - left.strength ||
        left.id.localeCompare(right.id)
    );

  for (const edge of hierarchy.edges) {
    const sourceLinks = linkedNodeIdSetsById.get(edge.source) ?? new Set();
    sourceLinks.add(edge.target);
    linkedNodeIdSetsById.set(edge.source, sourceLinks);
    const targetLinks = linkedNodeIdSetsById.get(edge.target) ?? new Set();
    targetLinks.add(edge.source);
    linkedNodeIdSetsById.set(edge.target, targetLinks);
  }
  const linkedNodeIdsById = new Map(
    [...linkedNodeIdSetsById].map(([nodeId, linkedIds]) => [
      nodeId,
      [...linkedIds]
    ])
  );

  for (const edge of forwardEdges) {
    const pairKey = `${edge.source}\u0000${edge.target}`;
    if (primaryEdgeByPair.has(pairKey)) continue;
    primaryEdgeByPair.set(pairKey, edge);
    const children = primaryChildrenById.get(edge.source) ?? [];
    children.push(edge.target);
    primaryChildrenById.set(edge.source, children);
    const parents = primaryParentsById.get(edge.target) ?? [];
    parents.push(edge.source);
    primaryParentsById.set(edge.target, parents);
  }

  for (const edge of forwardEdges) {
    if (parentById.has(edge.target)) continue;
    parentById.set(edge.target, edge.source);
    parentEdgeByChildId.set(edge.target, edge);
    const children = childrenById.get(edge.source) ?? [];
    children.push(edge.target);
    childrenById.set(edge.source, children);
  }
  for (const children of [
    ...childrenById.values(),
    ...primaryChildrenById.values(),
    ...linkedNodeIdsById.values()
  ]) {
    children.sort((leftId, rightId) => {
      const left = nodeById.get(leftId)!;
      const right = nodeById.get(rightId)!;
      return (
        right.importance - left.importance ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id)
      );
    });
  }

  const rootNodeIds = hierarchy.nodes
    .filter((node) => !parentById.has(node.id))
    .map((node) => node.id);

  return {
    nodes: hierarchy.nodes,
    edges: hierarchy.edges,
    nodeById,
    parentById,
    parentEdgeByChildId,
    primaryEdgeByPair,
    primaryChildrenById,
    primaryParentsById,
    linkedNodeIdsById,
    childrenById,
    rootNodeIds
  };
}

export function getKnowledgeGraphHierarchyAncestors(
  model: KnowledgeGraphHierarchyModel,
  nodeId: string
) {
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let currentId = model.parentById.get(nodeId) ?? null;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    ancestors.unshift(currentId);
    currentId = model.parentById.get(currentId) ?? null;
  }
  return ancestors;
}

export function getKnowledgeGraphHierarchyDescendants(
  model: KnowledgeGraphHierarchyModel,
  nodeId: string
) {
  const descendants = new Set<string>();
  const queue = [...(model.childrenById.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (descendants.has(currentId)) continue;
    descendants.add(currentId);
    queue.push(...(model.childrenById.get(currentId) ?? []));
  }
  return descendants;
}

export function getKnowledgeGraphHierarchyPrimaryDescendants(
  model: KnowledgeGraphHierarchyModel,
  nodeId: string
) {
  const descendants = new Set<string>();
  const queue = [...(model.primaryChildrenById.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (descendants.has(currentId) || currentId === nodeId) continue;
    descendants.add(currentId);
    queue.push(...(model.primaryChildrenById.get(currentId) ?? []));
  }
  return descendants;
}

export function getKnowledgeGraphHierarchyConnectedNodeIds(
  model: KnowledgeGraphHierarchyModel,
  nodeId: string,
  includeSecondary = true
) {
  const connected = new Set<string>();
  const linkedNodeIds = (currentId: string) =>
    includeSecondary
      ? (model.linkedNodeIdsById.get(currentId) ?? [])
      : [
          ...(model.primaryChildrenById.get(currentId) ?? []),
          ...(model.primaryParentsById.get(currentId) ?? [])
        ];
  const queue = [...linkedNodeIds(nodeId)];
  for (let index = 0; index < queue.length; index += 1) {
    const currentId = queue[index]!;
    if (connected.has(currentId) || currentId === nodeId) continue;
    connected.add(currentId);
    queue.push(...linkedNodeIds(currentId));
  }
  return connected;
}

export function getKnowledgeGraphHierarchyDirectLinkedNodeIds(
  model: KnowledgeGraphHierarchyModel,
  nodeId: string,
  includeSecondary: boolean
) {
  return new Set(
    includeSecondary
      ? (model.linkedNodeIdsById.get(nodeId) ?? [])
      : [
          ...(model.primaryChildrenById.get(nodeId) ?? []),
          ...(model.primaryParentsById.get(nodeId) ?? [])
        ]
  );
}

export function resolveKnowledgeGraphHierarchyVisibleIds({
  model,
  expandedNodeIds,
  expandAll,
  focusNodeId
}: {
  model: KnowledgeGraphHierarchyModel;
  expandedNodeIds: ReadonlySet<string>;
  expandAll: boolean;
  focusNodeId: string | null;
}) {
  if (expandAll) return new Set(model.nodes.map((node) => node.id));

  const visibleIds = new Set(model.rootNodeIds);
  const effectiveExpandedIds = new Set(expandedNodeIds);
  if (focusNodeId && model.nodeById.has(focusNodeId)) {
    for (const ancestorId of getKnowledgeGraphHierarchyAncestors(
      model,
      focusNodeId
    )) {
      effectiveExpandedIds.add(ancestorId);
    }
    visibleIds.add(focusNodeId);
  }

  const queue = [...visibleIds];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    if (!effectiveExpandedIds.has(currentId)) continue;
    for (const childId of model.childrenById.get(currentId) ?? []) {
      visibleIds.add(childId);
      queue.push(childId);
    }
  }
  return visibleIds;
}

export function resolveKnowledgeGraphFocusedHierarchyVisibleIds({
  model,
  focusNodeId,
  expandAll,
  includeSecondary = true
}: {
  model: KnowledgeGraphHierarchyModel;
  focusNodeId: string;
  expandAll: boolean;
  includeSecondary?: boolean;
}) {
  if (!model.nodeById.has(focusNodeId)) {
    return new Set<string>();
  }

  if (!expandAll) {
    return new Set([
      focusNodeId,
      ...getKnowledgeGraphHierarchyDirectLinkedNodeIds(
        model,
        focusNodeId,
        includeSecondary
      )
    ]);
  }

  return new Set([
    focusNodeId,
    ...getKnowledgeGraphHierarchyConnectedNodeIds(
      model,
      focusNodeId,
      includeSecondary
    )
  ]);
}

export function resolveKnowledgeGraphHierarchyVisibleEdges({
  model,
  visibleNodeIds,
  includeSecondary
}: {
  model: KnowledgeGraphHierarchyModel;
  visibleNodeIds: ReadonlySet<string>;
  includeSecondary: boolean;
}) {
  if (includeSecondary) {
    return model.edges.filter(
      (edge) =>
        visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    );
  }
  const primaryEdgeIds = new Set(
    [...model.primaryEdgeByPair.values()].map((edge) => edge.id)
  );
  return model.edges.filter(
    (edge) =>
      visibleNodeIds.has(edge.source) &&
      visibleNodeIds.has(edge.target) &&
      primaryEdgeIds.has(edge.id)
  );
}

export function toggleKnowledgeGraphHierarchyBranch(
  model: KnowledgeGraphHierarchyModel,
  expandedNodeIds: ReadonlySet<string>,
  nodeId: string
) {
  if (expandedNodeIds.has(nodeId)) {
    const next = new Set(expandedNodeIds);
    next.delete(nodeId);
    for (const descendantId of getKnowledgeGraphHierarchyDescendants(
      model,
      nodeId
    )) {
      next.delete(descendantId);
    }
    return next;
  }
  return new Set([
    ...getKnowledgeGraphHierarchyAncestors(model, nodeId),
    nodeId
  ]);
}
