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
  const childrenById = new Map<string, string[]>();
  const forwardEdges = hierarchy.edges
    .filter((edge) => !edge.secondary)
    .sort(
      (left, right) =>
        Number(right.structural) - Number(left.structural) ||
        right.strength - left.strength ||
        left.id.localeCompare(right.id)
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
    ...primaryChildrenById.values()
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
  expandAll
}: {
  model: KnowledgeGraphHierarchyModel;
  focusNodeId: string;
  expandAll: boolean;
}) {
  if (!model.nodeById.has(focusNodeId)) {
    return new Set<string>();
  }

  if (!expandAll) {
    return new Set([
      focusNodeId,
      ...(model.primaryChildrenById.get(focusNodeId) ?? [])
    ]);
  }

  return new Set([
    focusNodeId,
    ...getKnowledgeGraphHierarchyPrimaryDescendants(model, focusNodeId)
  ]);
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
