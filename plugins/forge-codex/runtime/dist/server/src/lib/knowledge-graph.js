import { getEntityVisual, isEntityKind } from "./entity-visuals.js";
import { KNOWLEDGE_GRAPH_HIERARCHY_LANES, KNOWLEDGE_GRAPH_HIERARCHY_ORDER, KNOWLEDGE_GRAPH_RELATION_FAMILY_LABELS, KNOWLEDGE_GRAPH_RELATION_LABELS, buildKnowledgeGraphNodeId } from "./knowledge-graph-types.js";
export function getKnowledgeGraphNodeVisual(node) {
    const kind = isEntityKind(node.entityKind) ? node.entityKind : "note";
    return getEntityVisual(kind);
}
export function getKnowledgeGraphNodeLayer(kind) {
    const index = KNOWLEDGE_GRAPH_HIERARCHY_ORDER.indexOf(kind);
    return index >= 0 ? index : KNOWLEDGE_GRAPH_HIERARCHY_ORDER.length - 1;
}
export function getKnowledgeGraphNodeLane(kind) {
    const lane = KNOWLEDGE_GRAPH_HIERARCHY_LANES.find((entry) => entry.kinds.some((entryKind) => entryKind === kind)) ??
        KNOWLEDGE_GRAPH_HIERARCHY_LANES[KNOWLEDGE_GRAPH_HIERARCHY_LANES.length - 1];
    return {
        laneId: lane.id,
        laneLabel: lane.label,
        laneIndex: KNOWLEDGE_GRAPH_HIERARCHY_LANES.findIndex((entry) => entry.id === lane.id)
    };
}
function initializeFamilyCounts() {
    return {
        structural: 0,
        contextual: 0,
        taxonomy: 0,
        workspace: 0
    };
}
function buildNeighborMap(edges) {
    const neighborMap = new Map();
    for (const edge of edges) {
        const sourcePeers = neighborMap.get(edge.source) ?? new Set();
        sourcePeers.add(edge.target);
        neighborMap.set(edge.source, sourcePeers);
        const targetPeers = neighborMap.get(edge.target) ?? new Set();
        targetPeers.add(edge.source);
        neighborMap.set(edge.target, targetPeers);
    }
    return neighborMap;
}
function normalizeFilterText(value) {
    return (value ?? "").trim().toLowerCase();
}
function getNodeUpdatedAtValue(node) {
    if (!node.updatedAt) {
        return null;
    }
    const time = Date.parse(node.updatedAt);
    return Number.isFinite(time) ? time : null;
}
export function compareKnowledgeGraphNodes(left, right) {
    return (right.importance - left.importance ||
        right.size - left.size ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id));
}
function compareKnowledgeGraphEdges(left, right) {
    return (right.strength - left.strength ||
        left.relationKind.localeCompare(right.relationKind) ||
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id));
}
export function buildRenderedKnowledgeGraphEdges(edges) {
    const edgesByPair = new Map();
    for (const edge of edges) {
        const pairKey = `${edge.source}→${edge.target}`;
        const current = edgesByPair.get(pairKey) ?? [];
        current.push(edge);
        edgesByPair.set(pairKey, current);
    }
    return Array.from(edgesByPair.entries())
        .map(([pairKey, pairEdges]) => {
        const sortedEdges = [...pairEdges].sort(compareKnowledgeGraphEdges);
        const representative = sortedEdges[0];
        const parallelCount = sortedEdges.length;
        const strength = Math.max(...sortedEdges.map((edge) => edge.strength)) *
            Math.min(1.45, 1 + (parallelCount - 1) * 0.12);
        return {
            id: `${pairKey}#${representative.id}`,
            source: representative.source,
            target: representative.target,
            relationKind: representative.relationKind,
            family: representative.family,
            label: parallelCount > 1
                ? `${representative.label} +${parallelCount - 1}`
                : representative.label,
            strength,
            directional: representative.directional,
            structural: representative.structural,
            parallelCount,
            data: sortedEdges
        };
    })
        .sort((left, right) => left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target) ||
        left.id.localeCompare(right.id));
}
export function buildKnowledgeGraphDatasetSignature(nodes, edges) {
    const renderedEdges = buildRenderedKnowledgeGraphEdges(edges);
    const nodeSignature = [...nodes]
        .sort((left, right) => left.id.localeCompare(right.id) ||
        left.updatedAt?.localeCompare(right.updatedAt ?? "") ||
        0)
        .map((node) => `${node.id}:${node.title}:${node.size}:${node.importance}:${node.updatedAt ?? ""}`)
        .join("|");
    const edgeSignature = renderedEdges
        .map((edge) => `${edge.source}:${edge.target}:${edge.parallelCount}:${edge.label}:${edge.strength.toFixed(3)}`)
        .join("|");
    return `${nodes.length}/${renderedEdges.length}/${nodeSignature}::${edgeSignature}`;
}
export function filterKnowledgeGraphData(graph, query) {
    const normalizedQuery = normalizeFilterText(query.q);
    const selectedKinds = new Set(query.entityKinds ?? []);
    const selectedTags = new Set(query.tags ?? []);
    const selectedOwners = new Set(query.owners ?? []);
    const selectedRelations = new Set(query.relationKinds ?? []);
    const updatedFrom = query.updatedFrom ? Date.parse(query.updatedFrom) : null;
    const updatedTo = query.updatedTo ? Date.parse(query.updatedTo) : null;
    const filteredNodes = graph.nodes.filter((node) => {
        if (selectedKinds.size > 0 && !selectedKinds.has(node.entityKind)) {
            return false;
        }
        if (selectedTags.size > 0 &&
            !node.tags.some((tag) => selectedTags.has(tag.id))) {
            return false;
        }
        if (selectedOwners.size > 0) {
            const ownerId = node.owner?.userId;
            if (!ownerId || !selectedOwners.has(ownerId)) {
                return false;
            }
        }
        const updatedAtValue = getNodeUpdatedAtValue(node);
        if (updatedFrom !== null) {
            if (updatedAtValue === null || updatedAtValue < updatedFrom) {
                return false;
            }
        }
        if (updatedTo !== null) {
            if (updatedAtValue === null || updatedAtValue > updatedTo) {
                return false;
            }
        }
        if (!normalizedQuery) {
            return true;
        }
        const haystack = [
            node.title,
            node.subtitle,
            node.description,
            node.owner?.displayName ?? "",
            ...node.tags.map((tag) => tag.label)
        ]
            .join(" ")
            .toLowerCase();
        return haystack.includes(normalizedQuery);
    });
    const filteredNodeIds = new Set(filteredNodes.map((node) => node.id));
    const candidateEdges = graph.edges.filter((edge) => {
        if (!filteredNodeIds.has(edge.source) || !filteredNodeIds.has(edge.target)) {
            return false;
        }
        if (selectedRelations.size > 0 &&
            !selectedRelations.has(edge.relationKind)) {
            return false;
        }
        return true;
    });
    if (selectedRelations.size === 0) {
        return {
            nodes: filteredNodes,
            edges: candidateEdges
        };
    }
    const connectedNodeIds = new Set();
    for (const edge of candidateEdges) {
        connectedNodeIds.add(edge.source);
        connectedNodeIds.add(edge.target);
    }
    return {
        nodes: filteredNodes.filter((node) => connectedNodeIds.has(node.id)),
        edges: candidateEdges
    };
}
export function selectKnowledgeGraphVisibleNodeIds({ nodes, edges, limit, focusNodeId }) {
    if (!limit || limit <= 0 || nodes.length <= limit) {
        return new Set(nodes.map((node) => node.id));
    }
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    if (focusNodeId && nodeMap.has(focusNodeId)) {
        const neighborMap = buildNeighborMap(edges);
        const visibleIds = new Set();
        const visitedIds = new Set();
        let frontier = [focusNodeId];
        while (frontier.length > 0 && visibleIds.size < limit) {
            const hopNodes = frontier
                .map((nodeId) => nodeMap.get(nodeId) ?? null)
                .filter((node) => Boolean(node))
                .sort(compareKnowledgeGraphNodes);
            for (const node of hopNodes) {
                if (visibleIds.size >= limit) {
                    break;
                }
                visibleIds.add(node.id);
            }
            const nextFrontier = new Set();
            for (const nodeId of frontier) {
                visitedIds.add(nodeId);
                for (const neighborId of neighborMap.get(nodeId) ?? []) {
                    if (visitedIds.has(neighborId) ||
                        visibleIds.has(neighborId) ||
                        !nodeMap.has(neighborId)) {
                        continue;
                    }
                    nextFrontier.add(neighborId);
                }
            }
            frontier = Array.from(nextFrontier);
        }
        if (visibleIds.size < limit) {
            for (const node of [...nodes].sort(compareKnowledgeGraphNodes)) {
                if (visibleIds.has(node.id)) {
                    continue;
                }
                visibleIds.add(node.id);
                if (visibleIds.size >= limit) {
                    break;
                }
            }
        }
        return visibleIds;
    }
    return new Set([...nodes]
        .sort(compareKnowledgeGraphNodes)
        .slice(0, limit)
        .map((node) => node.id));
}
export function buildKnowledgeGraphFacets(nodes, edges) {
    const entityKinds = nodes.reduce((counts, node) => {
        counts[node.entityKind] = (counts[node.entityKind] ?? 0) + 1;
        return counts;
    }, {});
    const relationKinds = edges.reduce((counts, edge) => {
        counts[edge.relationKind] = (counts[edge.relationKind] ?? 0) + 1;
        return counts;
    }, {});
    const tags = new Map();
    const owners = new Map();
    let minUpdatedAt = null;
    let maxUpdatedAt = null;
    for (const node of nodes) {
        for (const tag of node.tags) {
            const current = tags.get(tag.id) ?? { ...tag, count: 0 };
            current.count += 1;
            tags.set(tag.id, current);
        }
        if (node.owner?.userId && node.owner.displayName) {
            const current = owners.get(node.owner.userId) ?? {
                userId: node.owner.userId,
                displayName: node.owner.displayName,
                accentColor: node.owner.accentColor,
                kind: node.owner.kind,
                count: 0
            };
            current.count += 1;
            owners.set(node.owner.userId, current);
        }
        if (node.updatedAt) {
            if (!minUpdatedAt || node.updatedAt < minUpdatedAt) {
                minUpdatedAt = node.updatedAt;
            }
            if (!maxUpdatedAt || node.updatedAt > maxUpdatedAt) {
                maxUpdatedAt = node.updatedAt;
            }
        }
    }
    return {
        entityKinds: Object.entries(entityKinds)
            .map(([value, count]) => ({
            value: value,
            label: getEntityVisual(value).label,
            count
        }))
            .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
        relationKinds: Object.entries(relationKinds)
            .map(([value, count]) => ({
            value: value,
            label: KNOWLEDGE_GRAPH_RELATION_LABELS[value],
            count
        }))
            .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
        tags: Array.from(tags.values()).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
        owners: Array.from(owners.values()).sort((left, right) => right.count - left.count || left.displayName.localeCompare(right.displayName)),
        updatedAt: {
            min: minUpdatedAt,
            max: maxUpdatedAt
        }
    };
}
export function buildKnowledgeGraphHierarchy(nodes, edges) {
    const sortedNodes = [...nodes].sort((left, right) => {
        const layerDelta = getKnowledgeGraphNodeLayer(left.entityKind) -
            getKnowledgeGraphNodeLayer(right.entityKind);
        if (layerDelta !== 0) {
            return layerDelta;
        }
        return (right.importance - left.importance || left.title.localeCompare(right.title));
    });
    const rowsByLayer = new Map();
    const hierarchyNodes = sortedNodes.map((node) => {
        const { laneId, laneIndex, laneLabel } = getKnowledgeGraphNodeLane(node.entityKind);
        const row = rowsByLayer.get(laneIndex) ?? 0;
        rowsByLayer.set(laneIndex, row + 1);
        return {
            ...node,
            layer: laneIndex,
            laneId,
            laneLabel,
            row
        };
    });
    const nodeMap = new Map(hierarchyNodes.map((node) => [node.id, node]));
    const hierarchyEdges = edges.map((edge) => {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        const sourceLayer = sourceNode?.layer ?? 0;
        const targetLayer = targetNode?.layer ?? 0;
        return {
            ...edge,
            secondary: targetLayer <= sourceLayer ||
                (edge.family !== "structural" && edge.family !== "taxonomy")
        };
    });
    return {
        nodes: hierarchyNodes,
        edges: hierarchyEdges
    };
}
export function buildKnowledgeGraphFocusPayload(nodes, edges, focusNodeId) {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const focusNode = focusNodeId ? nodeMap.get(focusNodeId) ?? null : null;
    if (!focusNode) {
        return {
            generatedAt: new Date().toISOString(),
            focusNode: null,
            firstRingNodes: [],
            neighborhoodEdges: [],
            familyGroups: [],
            relationCounts: initializeFamilyCounts(),
            secondRingCounts: initializeFamilyCounts()
        };
    }
    const neighborhoodEdges = edges.filter((edge) => edge.source === focusNode.id || edge.target === focusNode.id);
    const neighborIds = Array.from(new Set(neighborhoodEdges.flatMap((edge) => edge.source === focusNode.id ? [edge.target] : [edge.source])));
    const firstRingNodes = neighborIds
        .map((nodeId) => nodeMap.get(nodeId) ?? null)
        .filter((node) => Boolean(node));
    const groupsByRelation = new Map();
    const relationCounts = initializeFamilyCounts();
    const secondRingCounts = initializeFamilyCounts();
    const allNeighbors = buildNeighborMap(edges);
    for (const nodeId of neighborIds) {
        const secondRingPeers = allNeighbors.get(nodeId) ?? new Set();
        for (const peerId of secondRingPeers) {
            if (peerId === focusNode.id || neighborIds.includes(peerId)) {
                continue;
            }
            const peerEdges = edges.filter((edge) => (edge.source === nodeId && edge.target === peerId) ||
                (edge.target === nodeId && edge.source === peerId));
            for (const edge of peerEdges) {
                secondRingCounts[edge.family] += 1;
            }
        }
    }
    for (const edge of neighborhoodEdges) {
        const peerId = edge.source === focusNode.id ? edge.target : edge.source;
        const peer = nodeMap.get(peerId);
        if (!peer) {
            continue;
        }
        relationCounts[edge.family] += 1;
        const existing = groupsByRelation.get(edge.relationKind);
        if (existing) {
            if (!existing.items.some((item) => item.id === peer.id)) {
                existing.items.push(peer);
            }
            continue;
        }
        groupsByRelation.set(edge.relationKind, {
            relationKind: edge.relationKind,
            family: edge.family,
            label: KNOWLEDGE_GRAPH_RELATION_LABELS[edge.relationKind],
            items: [peer]
        });
    }
    const familyGroupsMap = new Map();
    for (const relation of groupsByRelation.values()) {
        const existing = familyGroupsMap.get(relation.family);
        if (existing) {
            existing.relations.push({
                ...relation,
                items: [...relation.items].sort((left, right) => left.title.localeCompare(right.title))
            });
            existing.itemCount += relation.items.length;
            existing.relationCount += 1;
            continue;
        }
        familyGroupsMap.set(relation.family, {
            family: relation.family,
            label: KNOWLEDGE_GRAPH_RELATION_FAMILY_LABELS[relation.family],
            relationCount: 1,
            itemCount: relation.items.length,
            relations: [
                {
                    ...relation,
                    items: [...relation.items].sort((left, right) => left.title.localeCompare(right.title))
                }
            ]
        });
    }
    return {
        generatedAt: new Date().toISOString(),
        focusNode,
        firstRingNodes: firstRingNodes.sort((left, right) => left.title.localeCompare(right.title)),
        neighborhoodEdges,
        familyGroups: [...familyGroupsMap.values()]
            .map((group) => ({
            ...group,
            relations: group.relations.sort((left, right) => left.label.localeCompare(right.label))
        }))
            .sort((left, right) => left.label.localeCompare(right.label)),
        relationCounts,
        secondRingCounts
    };
}
export function getKnowledgeGraphNodeDegree(nodeId, edges) {
    return edges.reduce((count, edge) => {
        if (edge.source === nodeId || edge.target === nodeId) {
            return count + 1;
        }
        return count;
    }, 0);
}
export function isKnowledgeGraphNodeFocused(nodeId, focusNodeId, edges) {
    if (!focusNodeId) {
        return false;
    }
    if (nodeId === focusNodeId) {
        return true;
    }
    return edges.some((edge) => (edge.source === focusNodeId && edge.target === nodeId) ||
        (edge.target === focusNodeId && edge.source === nodeId));
}
export function buildKnowledgeGraphFocusNodeId(entityType, entityId) {
    return buildKnowledgeGraphNodeId(entityType, entityId);
}
export function getKnowledgeGraphFocusRelatedNodeIds(focusNodeId, edges) {
    if (!focusNodeId) {
        return new Set();
    }
    const related = new Set([focusNodeId]);
    for (const edge of edges) {
        if (edge.source === focusNodeId) {
            related.add(edge.target);
        }
        else if (edge.target === focusNodeId) {
            related.add(edge.source);
        }
    }
    return related;
}
