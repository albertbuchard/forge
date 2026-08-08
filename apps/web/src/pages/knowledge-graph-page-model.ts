import {
  DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS,
  sanitizeKnowledgeGraphPhysicsSettings,
  type KnowledgeGraphPhysicsSettings
} from "@/components/knowledge-graph/knowledge-graph-layout-model";
import {
  formatKnowledgeGraphFocusValue,
  KNOWLEDGE_GRAPH_HIERARCHY_ORDER,
  KNOWLEDGE_GRAPH_RELATION_LABELS,
  parseKnowledgeGraphFocusValue,
  type KnowledgeGraphEntityKind,
  type KnowledgeGraphNode,
  type KnowledgeGraphPayload,
  type KnowledgeGraphQuery,
  type KnowledgeGraphRelationKind,
  type KnowledgeGraphView
} from "@/lib/knowledge-graph-types";
import {
  buildKnowledgeGraphFocusNodeId,
  filterKnowledgeGraphData,
  selectKnowledgeGraphVisibleNodeIds
} from "@/lib/knowledge-graph";
import { getEntityNotesHref } from "@/lib/note-helpers";
import type { KnowledgeGraphDisplayMode } from "@/lib/knowledge-graph-visibility-policy";
import type { UserSummary } from "@/lib/types";

export const DEFAULT_KNOWLEDGE_GRAPH_MAX_NODES = 2000;
export const MIN_KNOWLEDGE_GRAPH_MAX_NODES = 40;
export const MAX_KNOWLEDGE_GRAPH_MAX_NODES = 2000;
const KNOWLEDGE_GRAPH_PHYSICS_STORAGE_KEY = "forge.knowledge-graph.physics";

export type KnowledgeGraphPageState = {
  selectedView: KnowledgeGraphView;
  displayMode: KnowledgeGraphDisplayMode;
  focusNodeId: string | null;
  selectedKinds: KnowledgeGraphEntityKind[];
  selectedRelations: KnowledgeGraphRelationKind[];
  unavailableKinds: string[];
  unavailableRelations: string[];
  selectedTags: string[];
  selectedOwners: string[];
  showHierarchyCrossLinks: boolean;
  showAllVisibleEdges: boolean;
  queryText: string;
  updatedFrom: string | null;
  updatedTo: string | null;
  maxNodes: number;
};

export function shouldPublishKnowledgeGraphPageDiagnostics() {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.__FORGE_ENABLE_GRAPH_DIAGNOSTICS__) {
    return true;
  }
  try {
    return (
      new URLSearchParams(window.location.search).get("graphDiagnostics") ===
      "1"
    );
  } catch {
    return false;
  }
}

export function readKnowledgeGraphMultiParam(
  searchParams: URLSearchParams,
  key: string
) {
  return Array.from(
    new Set(
      searchParams
        .getAll(key)
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

export function writeKnowledgeGraphMultiParam(
  searchParams: URLSearchParams,
  key: string,
  values: string[]
) {
  searchParams.delete(key);
  values.forEach((value) => searchParams.append(key, value));
}

export function getKnowledgeGraphNodeNotesHref(node: KnowledgeGraphNode) {
  switch (node.entityType) {
    case "workbench_flow":
    case "workbench_surface":
    case "wiki_space":
      return null;
    default:
      return getEntityNotesHref(node.entityType, node.entityId);
  }
}

export function formatKnowledgeGraphDateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

export function loadKnowledgeGraphPhysicsSettings() {
  if (typeof window === "undefined") {
    return DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(
      KNOWLEDGE_GRAPH_PHYSICS_STORAGE_KEY
    );
    if (!raw) {
      return DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS;
    }
    return sanitizeKnowledgeGraphPhysicsSettings(
      JSON.parse(raw) as Partial<KnowledgeGraphPhysicsSettings>
    );
  } catch {
    return DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS;
  }
}

export function saveKnowledgeGraphPhysicsSettings(
  physicsSettings: KnowledgeGraphPhysicsSettings
) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    KNOWLEDGE_GRAPH_PHYSICS_STORAGE_KEY,
    JSON.stringify(physicsSettings)
  );
}

export function findKnowledgeGraphUserSummary(
  users: UserSummary[],
  userId: string | null | undefined,
  fallbackLabel: string | null | undefined,
  fallbackKind: "human" | "bot" | null | undefined,
  fallbackAccent: string | null | undefined
) {
  const matched = users.find((user) => user.id === userId);
  if (matched) {
    return matched;
  }
  if (!userId || !fallbackLabel) {
    return null;
  }
  return {
    id: userId,
    displayName: fallbackLabel,
    kind: fallbackKind ?? "human",
    accentColor: fallbackAccent ?? "",
    handle: fallbackLabel.toLowerCase().replace(/\s+/g, "-"),
    description: "",
    createdAt: "",
    updatedAt: ""
  } satisfies UserSummary;
}

export function buildKnowledgeGraphQuickFilterSelectionIds({
  entityKinds,
  relationKinds,
  tags,
  owners
}: {
  entityKinds: string[];
  relationKinds: string[];
  tags: string[];
  owners: string[];
}) {
  return [
    ...entityKinds.map((value) => `entity:${value}`),
    ...relationKinds.map((value) => `relation:${value}`),
    ...tags.map((value) => `tag:${value}`),
    ...owners.map((value) => `owner:${value}`)
  ];
}

export function parseKnowledgeGraphQuickFilterSelectionIds(
  selectedOptionIds: string[]
) {
  const entityKinds: string[] = [];
  const relationKinds: string[] = [];
  const tags: string[] = [];
  const owners: string[] = [];

  for (const optionId of selectedOptionIds) {
    const [prefix, ...valueParts] = optionId.split(":");
    const value = valueParts.join(":").trim();
    if (!value) {
      continue;
    }
    if (prefix === "entity") {
      entityKinds.push(value);
    } else if (prefix === "relation") {
      relationKinds.push(value);
    } else if (prefix === "tag") {
      tags.push(value);
    } else if (prefix === "owner") {
      owners.push(value);
    }
  }

  return {
    entityKinds,
    relationKinds,
    tags,
    owners
  };
}

export function parseKnowledgeGraphPageState(searchParamsKey: string) {
  const params = new URLSearchParams(searchParamsKey);
  const selectedView: KnowledgeGraphView =
    params.get("view") === "hierarchy" ? "hierarchy" : "graph";
  const displayMode: KnowledgeGraphDisplayMode =
    params.get("display") === "all" ? "all" : "default";
  const focusSpec = parseKnowledgeGraphFocusValue(params.get("focus"));
  const focusNodeId = focusSpec
    ? buildKnowledgeGraphFocusNodeId(focusSpec.entityType, focusSpec.entityId)
    : null;
  const requestedKinds = readKnowledgeGraphMultiParam(params, "entityKind");
  const selectedKinds = requestedKinds.filter(
    (value): value is KnowledgeGraphEntityKind =>
      KNOWLEDGE_GRAPH_HIERARCHY_ORDER.includes(
        value as KnowledgeGraphEntityKind
      )
  );
  const requestedRelations = readKnowledgeGraphMultiParam(
    params,
    "relationKind"
  );
  const selectedRelations = requestedRelations.filter(
    (value): value is KnowledgeGraphRelationKind =>
      Object.prototype.hasOwnProperty.call(
        KNOWLEDGE_GRAPH_RELATION_LABELS,
        value
      )
  );
  const selectedTags = readKnowledgeGraphMultiParam(params, "tag");
  const selectedOwners = readKnowledgeGraphMultiParam(params, "owner");
  const queryText = params.get("q") ?? "";
  const updatedFrom = params.get("updatedFrom");
  const updatedTo = params.get("updatedTo");
  const parsedLimit = Number(
    params.get("limit") ?? DEFAULT_KNOWLEDGE_GRAPH_MAX_NODES
  );
  const maxNodes = Number.isFinite(parsedLimit)
    ? Math.max(
        MIN_KNOWLEDGE_GRAPH_MAX_NODES,
        Math.min(MAX_KNOWLEDGE_GRAPH_MAX_NODES, parsedLimit)
      )
    : DEFAULT_KNOWLEDGE_GRAPH_MAX_NODES;

  return {
    selectedView,
    displayMode,
    focusNodeId,
    selectedKinds,
    selectedRelations,
    unavailableKinds: requestedKinds.filter(
      (value) => !selectedKinds.includes(value as KnowledgeGraphEntityKind)
    ),
    unavailableRelations: requestedRelations.filter(
      (value) =>
        !selectedRelations.includes(value as KnowledgeGraphRelationKind)
    ),
    selectedTags,
    selectedOwners,
    showHierarchyCrossLinks: params.get("cross") !== "0",
    showAllVisibleEdges: params.get("edges") === "all",
    queryText,
    updatedFrom,
    updatedTo,
    maxNodes
  } satisfies KnowledgeGraphPageState;
}

export function buildKnowledgeGraphQueryFromPageState(
  state: KnowledgeGraphPageState
) {
  return {
    q: state.queryText.trim() || null,
    entityKinds: [...state.selectedKinds].sort(),
    relationKinds: [...state.selectedRelations].sort(),
    tags: [...state.selectedTags].sort(),
    owners: [...state.selectedOwners].sort(),
    updatedFrom: state.updatedFrom,
    updatedTo: state.updatedTo,
    limit: state.maxNodes,
    focusNodeId: state.focusNodeId
  } satisfies KnowledgeGraphQuery;
}

export function buildOptimisticKnowledgeGraphPayload(
  source: KnowledgeGraphPayload,
  query: KnowledgeGraphQuery
): KnowledgeGraphPayload {
  const filtered = filterKnowledgeGraphData(source, query);
  const visibleNodeIds = selectKnowledgeGraphVisibleNodeIds({
    nodes: filtered.nodes,
    edges: filtered.edges,
    limit: query.limit,
    focusNodeId: query.focusNodeId
  });
  const nodes = filtered.nodes.filter((node) => visibleNodeIds.has(node.id));
  const edges = filtered.edges.filter(
    (edge) =>
      visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  );
  const kinds = nodes.reduce<Record<string, number>>((counts, node) => {
    counts[node.entityKind] = (counts[node.entityKind] ?? 0) + 1;
    return counts;
  }, {});
  const relationKinds = edges.reduce<Record<string, number>>(
    (counts, edge) => {
      counts[edge.relationKind] = (counts[edge.relationKind] ?? 0) + 1;
      return counts;
    },
    {}
  );

  return {
    ...source,
    nodes,
    edges,
    counts: {
      ...source.counts,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      filteredNodeCount: filtered.nodes.length,
      filteredEdgeCount: filtered.edges.length,
      kinds,
      relationKinds,
      limited:
        source.counts.limited ||
        nodes.length < filtered.nodes.length ||
        edges.length < filtered.edges.length
    }
  };
}

export function writeKnowledgeGraphFocusParam(
  searchParams: URLSearchParams,
  node: KnowledgeGraphNode | null
) {
  if (!node) {
    searchParams.delete("focus");
    return;
  }
  searchParams.set(
    "focus",
    formatKnowledgeGraphFocusValue(node.entityType, node.entityId)
  );
}

export function resolveKnowledgeGraphFocusInteraction({
  isMobile,
  currentFocusNodeId,
  nextNodeId
}: {
  isMobile: boolean;
  currentFocusNodeId: string | null;
  nextNodeId: string | null;
}) {
  if (!nextNodeId) {
    return {
      nextFocusNodeId: null,
      nextMobileSheetOpen: false,
      shouldUpdateFocus: currentFocusNodeId !== null
    };
  }

  if (!isMobile) {
    return {
      nextFocusNodeId: nextNodeId,
      nextMobileSheetOpen: false,
      shouldUpdateFocus: currentFocusNodeId !== nextNodeId
    };
  }

  if (currentFocusNodeId === nextNodeId) {
    return {
      nextFocusNodeId: nextNodeId,
      nextMobileSheetOpen: true,
      shouldUpdateFocus: false
    };
  }

  return {
    nextFocusNodeId: nextNodeId,
    nextMobileSheetOpen: false,
    shouldUpdateFocus: true
  };
}

const CLEAR_OVERLAY_REQUEST_KEY = "__clear__";

export function resolveKnowledgeGraphOverlaySyncAction({
  isMobile,
  focusNodeId,
  shellOverlayFocusNodeId,
  lastRequestedKey
}: {
  isMobile: boolean;
  focusNodeId: string | null;
  shellOverlayFocusNodeId: string | null;
  lastRequestedKey: string | null;
}) {
  const desiredFocusNodeId = isMobile ? null : focusNodeId;
  const desiredRequestKey = desiredFocusNodeId ?? CLEAR_OVERLAY_REQUEST_KEY;
  const currentRequestKey =
    shellOverlayFocusNodeId ?? CLEAR_OVERLAY_REQUEST_KEY;

  if (desiredRequestKey === currentRequestKey) {
    return {
      action: "none" as const,
      nextRequestedKey: desiredRequestKey
    };
  }

  if (lastRequestedKey === desiredRequestKey) {
    return {
      action: "none" as const,
      nextRequestedKey: desiredRequestKey
    };
  }

  return {
    action: desiredFocusNodeId ? ("set" as const) : ("clear" as const),
    nextRequestedKey: desiredRequestKey
  };
}
