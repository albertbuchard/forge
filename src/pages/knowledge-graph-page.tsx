import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bug,
  Crosshair,
  Minus,
  Plus,
  Rows3,
  ScanSearch,
  Settings2,
  SlidersHorizontal
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { KnowledgeGraphEntityPanel } from "@/components/knowledge-graph/knowledge-graph-entity-panel";
import {
  KnowledgeGraphForceView,
  type KnowledgeGraphForceViewHandle
} from "@/components/knowledge-graph/knowledge-graph-force-view";
import { KnowledgeGraphHierarchyView } from "@/components/knowledge-graph/knowledge-graph-hierarchy-view";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import { EntityLinkMultiSelect } from "@/components/psyche/entity-link-multiselect";
import {
  FacetedTokenSearch,
  type FacetedTokenOption
} from "@/components/search/faceted-token-search";
import { useForgeShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { Input } from "@/components/ui/input";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { UserBadge } from "@/components/ui/user-badge";
import { getKnowledgeGraph } from "@/lib/api";
import {
  formatKnowledgeGraphFocusValue,
  KNOWLEDGE_GRAPH_HIERARCHY_ORDER,
  parseKnowledgeGraphFocusValue,
  type KnowledgeGraphEntityKind,
  type KnowledgeGraphNode,
  type KnowledgeGraphQuery,
  type KnowledgeGraphRelationKind,
  type KnowledgeGraphView
} from "@/lib/knowledge-graph-types";
import {
  buildKnowledgeGraphFocusNodeId,
  buildKnowledgeGraphFocusPayload
} from "@/lib/knowledge-graph";
import {
  DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS,
  KNOWLEDGE_GRAPH_MAX_EDGE_SPRING_STRENGTH,
  KNOWLEDGE_GRAPH_MAX_FOCUS_DIFFUSION,
  KNOWLEDGE_GRAPH_MAX_FOCUS_REPULSION,
  KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_DIFFUSION,
  KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_REDUCTION,
  KNOWLEDGE_GRAPH_MAX_FOCUS_SHELL_SPACING,
  KNOWLEDGE_GRAPH_MAX_GRAVITY_STRENGTH,
  KNOWLEDGE_GRAPH_MIN_EDGE_SPRING_STRENGTH,
  KNOWLEDGE_GRAPH_MIN_FOCUS_SHELL_SPACING,
  sanitizeKnowledgeGraphPhysicsSettings,
  type KnowledgeGraphPhysicsSettings
} from "@/components/knowledge-graph/knowledge-graph-layout-model";
import {
  buildKnowledgeGraphDiagnosticsEventId,
  buildKnowledgeGraphOverlayFocusEventDetails,
  createKnowledgeGraphUiLogger,
  isKnowledgeGraphDevDiagnosticsEnabled,
  mirrorKnowledgeGraphDiagnosticsEventToConsole
} from "@/lib/knowledge-graph-dev-diagnostics";
import {
  resolveKnowledgeGraphFocusInteraction,
  resolveKnowledgeGraphOverlaySyncAction
} from "@/pages/knowledge-graph-page-model";
import {
  setKnowledgeGraphDiagnosticsPanelOpen
} from "@/store/slices/knowledge-graph-diagnostics-slice";
import {
  clearKnowledgeGraphOverlayFocus,
  setKnowledgeGraphOverlayFocus
} from "@/store/slices/shell-slice";
import { useAppDispatch, useAppSelector } from "@/store/typed-hooks";
import type { UserSummary } from "@/lib/types";
import { getEntityNotesHref } from "@/lib/note-helpers";
import { getEntityVisual } from "@/lib/entity-visuals";

const DEFAULT_MAX_NODES = 2000;
const MIN_MAX_NODES = 40;
const MAX_MAX_NODES = 2000;
const KNOWLEDGE_GRAPH_PHYSICS_STORAGE_KEY = "forge.knowledge-graph.physics";

declare global {
  interface Window {
    __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean;
    __FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?: {
      isMobile: boolean;
      mobileSheetOpen: boolean;
      focusNodeId: string | null;
      selectedView: KnowledgeGraphView;
      selectNodeById?: (nodeId: string | null) => void;
      activateFocusedNode?: () => void;
    };
  }
}

function shouldPublishKnowledgeGraphPageDiagnostics() {
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

function readMultiParam(searchParams: URLSearchParams, key: string) {
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

function writeMultiParam(
  searchParams: URLSearchParams,
  key: string,
  values: string[]
) {
  searchParams.delete(key);
  values.forEach((value) => searchParams.append(key, value));
}

function getNodeNotesHref(node: KnowledgeGraphNode) {
  switch (node.entityType) {
    case "workbench_flow":
    case "workbench_surface":
    case "wiki_space":
      return null;
    default:
      return getEntityNotesHref(node.entityType, node.entityId);
  }
}

function formatDateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function loadKnowledgeGraphPhysicsSettings() {
  if (typeof window === "undefined") {
    return DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(KNOWLEDGE_GRAPH_PHYSICS_STORAGE_KEY);
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

function findUserSummary(
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

function buildQuickFilterSelectionIds({
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

function parseQuickFilterSelectionIds(selectedOptionIds: string[]) {
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

class KnowledgeGraphRendererBoundary extends Component<
  {
    resetKey: string;
    fallback: (error: Error) => ReactNode;
    children: ReactNode;
  },
  { error: Error | null }
> {
  constructor(props: {
    resetKey: string;
    fallback: (error: Error) => ReactNode;
    children: ReactNode;
  }) {
    super(props);
    this.state = {
      error: null
    };
  }

  static getDerivedStateFromError(error: Error) {
    return {
      error
    };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {}

  componentDidUpdate(prevProps: Readonly<{ resetKey: string }>) {
    if (
      prevProps.resetKey !== this.props.resetKey &&
      this.state.error !== null
    ) {
      this.setState({
        error: null
      });
    }
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error);
    }
    return this.props.children;
  }
}

export function KnowledgeGraphPage() {
  const shell = useForgeShell();
  const dispatch = useAppDispatch();
  const knowledgeGraphDiagnostics = useAppSelector(
    (state) => state.knowledgeGraphDiagnostics
  );
  const shellOverlayFocusNodeId = useAppSelector(
    (state) => state.shell.knowledgeGraphOverlayFocus?.focusNode?.id ?? null
  );
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const graphViewRef = useRef<KnowledgeGraphForceViewHandle | null>(null);
  const pendingMobileSheetNodeIdRef = useRef<string | null>(null);
  const overlayFocusNodeIdRef = useRef<string | null>(null);
  const overlaySyncRequestKeyRef = useRef<string | null>(null);
  const graphQueryDiagnosticsSignatureRef = useRef<string | null>(null);
  const diagnosticsLoggerRef = useRef(
    createKnowledgeGraphUiLogger("/knowledge-graph")
  );
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 1023px)").matches
      : false
  );
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [appearanceDialogOpen, setAppearanceDialogOpen] = useState(false);
  const [draftQueryText, setDraftQueryText] = useState("");
  const [physicsSettings, setPhysicsSettings] = useState<KnowledgeGraphPhysicsSettings>(
    () => loadKnowledgeGraphPhysicsSettings()
  );
  const diagnosticsAvailable = isKnowledgeGraphDevDiagnosticsEnabled();
  const diagnosticsEnabled =
    diagnosticsAvailable && knowledgeGraphDiagnostics.panelOpen;

  const recordPageDiagnosticsEvent = ({
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
    const diagnosticsEvent = {
      id: buildKnowledgeGraphDiagnosticsEventId(),
      createdAt: new Date().toISOString(),
      level,
      eventKey,
      message,
      route: "/knowledge-graph",
      details: details ?? {}
    } as const;
    mirrorKnowledgeGraphDiagnosticsEventToConsole({
      id: diagnosticsEvent.id,
      createdAt: diagnosticsEvent.createdAt,
      level: diagnosticsEvent.level,
      eventKey: diagnosticsEvent.eventKey,
      message: diagnosticsEvent.message,
      route: diagnosticsEvent.route,
      details: diagnosticsEvent.details
    });
    if (!publishBackend) {
      return;
    }
    void diagnosticsLoggerRef.current({
      level,
      eventKey,
      message,
      functionName: "KnowledgeGraphPage",
      details
    });
  };

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const sync = (event?: MediaQueryListEvent) =>
      setIsMobile(event ? event.matches : mediaQuery.matches);
    sync();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", sync);
      return () => mediaQuery.removeEventListener("change", sync);
    }
    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setMobilePanelOpen(false);
      setMobileFiltersOpen(false);
      pendingMobileSheetNodeIdRef.current = null;
    }
  }, [isMobile]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      KNOWLEDGE_GRAPH_PHYSICS_STORAGE_KEY,
      JSON.stringify(physicsSettings)
    );
  }, [physicsSettings]);

  const searchParamsKey = searchParams.toString();
  const parsedPageState = useMemo(() => {
    const params = new URLSearchParams(searchParamsKey);
    const selectedView: KnowledgeGraphView =
      params.get("view") === "hierarchy" ? "hierarchy" : "graph";
    const focusSpec = parseKnowledgeGraphFocusValue(params.get("focus"));
    const focusNodeId = focusSpec
      ? buildKnowledgeGraphFocusNodeId(focusSpec.entityType, focusSpec.entityId)
      : null;
    const selectedKinds = readMultiParam(
      params,
      "entityKind"
    ) as KnowledgeGraphEntityKind[];
    const selectedRelations = readMultiParam(
      params,
      "relationKind"
    ) as KnowledgeGraphRelationKind[];
    const selectedTags = readMultiParam(params, "tag");
    const selectedOwners = readMultiParam(params, "owner");
    const queryText = params.get("q") ?? "";
    const updatedFrom = params.get("updatedFrom");
    const updatedTo = params.get("updatedTo");
    const parsedLimit = Number(params.get("limit") ?? DEFAULT_MAX_NODES);
    const maxNodes = Number.isFinite(parsedLimit)
      ? Math.max(MIN_MAX_NODES, Math.min(MAX_MAX_NODES, parsedLimit))
      : DEFAULT_MAX_NODES;

    return {
      selectedView,
      focusSpec,
      focusNodeId,
      selectedKinds,
      selectedRelations,
      selectedTags,
      selectedOwners,
      showHierarchyCrossLinks: params.get("cross") === "1",
      queryText,
      updatedFrom,
      updatedTo,
      maxNodes
    };
  }, [searchParamsKey]);

  const {
    selectedView,
    focusSpec,
    focusNodeId,
    selectedKinds,
    selectedRelations,
    selectedTags,
    selectedOwners,
    showHierarchyCrossLinks,
    queryText,
    updatedFrom,
    updatedTo,
    maxNodes
  } = parsedPageState;

  useEffect(() => {
    setDraftQueryText(queryText);
  }, [queryText]);

  const query = useMemo<KnowledgeGraphQuery>(
    () => ({
      q: queryText.trim() || null,
      entityKinds: [...selectedKinds].sort(),
      relationKinds: [...selectedRelations].sort(),
      tags: [...selectedTags].sort(),
      owners: [...selectedOwners].sort(),
      updatedFrom,
      updatedTo,
      limit: maxNodes,
      focusNodeId: null
    }),
    [
      maxNodes,
      queryText,
      selectedKinds,
      selectedOwners,
      selectedRelations,
      selectedTags,
      updatedFrom,
      updatedTo
    ]
  );

  const queryKey = useMemo(
    () => [
      "forge-knowledge-graph",
      ...shell.selectedUserIds,
      JSON.stringify(query)
    ],
    [query, shell.selectedUserIds]
  );

  const graphQuery = useQuery({
    queryKey,
    queryFn: () => getKnowledgeGraph(shell.selectedUserIds, query),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    refetchOnWindowFocus: false
  });

  const graph = graphQuery.data;

  useEffect(() => {
    recordPageDiagnosticsEvent({
      level: "info",
      eventKey: "route_arrival",
      message: "Arrived on the Knowledge Graph page.",
      details: {
        search: searchParams.toString()
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!graphQuery.isSuccess || !graph) {
      return;
    }
    const nextSignature = JSON.stringify({
      q: query.q,
      entityKinds: query.entityKinds,
      relationKinds: query.relationKinds,
      tags: query.tags,
      owners: query.owners,
      updatedFrom: query.updatedFrom,
      updatedTo: query.updatedTo,
      limit: query.limit,
      nodeCount: graph.counts.nodeCount,
      edgeCount: graph.counts.edgeCount,
      filteredNodeCount: graph.counts.filteredNodeCount,
      limited: graph.counts.limited
    });
    if (graphQueryDiagnosticsSignatureRef.current === nextSignature) {
      return;
    }
    graphQueryDiagnosticsSignatureRef.current = nextSignature;
    recordPageDiagnosticsEvent({
      level: "info",
      eventKey: "graph_query_resolved",
      message: "Knowledge graph query resolved.",
      details: {
        nodeCount: graph.counts.nodeCount,
        edgeCount: graph.counts.edgeCount,
        filteredNodeCount: graph.counts.filteredNodeCount,
        limited: graph.counts.limited,
        query
      }
    });
  }, [graph, graphQuery.isSuccess, query]);

  useEffect(() => {
    if (!graph || !focusNodeId) {
      return;
    }
    if (graph.nodes.some((node) => node.id === focusNodeId)) {
      return;
    }
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("focus");
      return next;
    }, { replace: true });
    setMobilePanelOpen(false);
    pendingMobileSheetNodeIdRef.current = null;
  }, [focusNodeId, graph, setSearchParams]);

  useEffect(() => {
    if (!isMobile) {
      return;
    }
    if (!focusNodeId) {
      pendingMobileSheetNodeIdRef.current = null;
      setMobilePanelOpen(false);
      return;
    }
    if (
      pendingMobileSheetNodeIdRef.current === focusNodeId &&
      !mobilePanelOpen
    ) {
      setMobilePanelOpen(true);
      pendingMobileSheetNodeIdRef.current = null;
    }
  }, [focusNodeId, isMobile, mobilePanelOpen]);

  const focusPayload = useMemo(() => {
    if (!graph || !focusNodeId) {
      return buildKnowledgeGraphFocusPayload([], [], null);
    }
    return buildKnowledgeGraphFocusPayload(graph.nodes, graph.edges, focusNodeId);
  }, [focusNodeId, graph]);

  useEffect(() => {
    const overlaySync = resolveKnowledgeGraphOverlaySyncAction({
      isMobile,
      focusNodeId: focusPayload.focusNode?.id ?? null,
      shellOverlayFocusNodeId,
      lastRequestedKey: overlaySyncRequestKeyRef.current
    });

    overlaySyncRequestKeyRef.current = overlaySync.nextRequestedKey;

    if (overlaySync.action === "none") {
      return;
    }

    if (overlaySync.action === "clear") {
      dispatch(clearKnowledgeGraphOverlayFocus());
      return;
    }

    dispatch(setKnowledgeGraphOverlayFocus(focusPayload));
  }, [dispatch, focusPayload, isMobile, shellOverlayFocusNodeId]);

  useEffect(() => {
    if (!diagnosticsEnabled || isMobile) {
      overlayFocusNodeIdRef.current = null;
      return;
    }
    const nextFocusNodeId = focusPayload.focusNode?.id ?? null;
    const previousFocusNodeId = overlayFocusNodeIdRef.current;
    if (previousFocusNodeId === nextFocusNodeId) {
      return;
    }
    overlayFocusNodeIdRef.current = nextFocusNodeId;
    recordPageDiagnosticsEvent({
      level: "debug",
      eventKey: nextFocusNodeId ? "drawer_open" : "drawer_close",
      message: nextFocusNodeId
        ? "Opened the shell-side Knowledge Graph drawer."
        : "Closed the shell-side Knowledge Graph drawer.",
      details: buildKnowledgeGraphOverlayFocusEventDetails(
        nextFocusNodeId ? focusPayload : null
      )
    });
  }, [diagnosticsEnabled, focusNodeId, focusPayload, isMobile]);

  useEffect(() => {
    return () => {
      dispatch(clearKnowledgeGraphOverlayFocus());
    };
  }, [dispatch]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!shouldPublishKnowledgeGraphPageDiagnostics()) {
      delete window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__;
      return;
    }
    window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__ = {
      isMobile,
      mobileSheetOpen: mobilePanelOpen,
      focusNodeId,
      selectedView,
      selectNodeById: (nodeId) => {
        if (!graph) {
          return;
        }
        const nextNode = nodeId
          ? graph.nodes.find((node) => node.id === nodeId) ?? null
          : null;
        handleFocusNode(nextNode);
      },
      activateFocusedNode: () => {
        if (!focusNodeId || !graph) {
          return;
        }
        const nextNode = graph.nodes.find((node) => node.id === focusNodeId) ?? null;
        if (nextNode) {
          handleFocusNode(nextNode);
        }
      }
    };
    return () => {
      delete window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__;
    };
  }, [focusNodeId, isMobile, mobilePanelOpen, selectedView]);

  const setParam = (mutate: (next: URLSearchParams) => void) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      mutate(next);
      return next;
    }, { replace: true });
  };

  const submitGraphSearch = (value: string) => {
    const nextValue = value.trim();
    setDraftQueryText(value);
    setParam((next) => {
      if (nextValue.length > 0) {
        next.set("q", nextValue);
      } else {
        next.delete("q");
      }
    });
  };

  const handleFocusNode = (node: KnowledgeGraphNode | null) => {
    const interaction = resolveKnowledgeGraphFocusInteraction({
      isMobile,
      currentFocusNodeId: focusNodeId,
      mobileSheetOpen: mobilePanelOpen,
      nextNodeId: node?.id ?? null
    });

    pendingMobileSheetNodeIdRef.current =
      isMobile && interaction.nextMobileSheetOpen ? node?.id ?? null : null;
    setMobilePanelOpen(interaction.nextMobileSheetOpen);
    if (!interaction.shouldUpdateFocus) {
      return;
    }

    setParam((next) => {
      if (!node) {
        next.delete("focus");
        return;
      }
      next.set(
        "focus",
        formatKnowledgeGraphFocusValue(node.entityType, node.entityId)
      );
    });
    if (isMobile) {
      setMobileFiltersOpen(false);
    }
  };

  const handleNavigateNode = (node: KnowledgeGraphNode) => {
    if (node.href) {
      navigate(node.href);
    }
  };

  const updatePhysicsSetting = <
    Key extends keyof KnowledgeGraphPhysicsSettings
  >(
    key: Key,
    value: number
  ) => {
    setPhysicsSettings((current) =>
      sanitizeKnowledgeGraphPhysicsSettings({
        ...current,
        [key]: value
      })
    );
  };

  const handleOpenNotes = (node: KnowledgeGraphNode) => {
    const href = getNodeNotesHref(node);
    if (href) {
      navigate(href);
    }
  };

  const handleOpenHierarchy = (node: KnowledgeGraphNode) => {
    setParam((next) => {
      next.set("view", "hierarchy");
      next.set("focus", formatKnowledgeGraphFocusValue(node.entityType, node.entityId));
    });
  };

  const resetFilters = () => {
    setParam((next) => {
      [
        "q",
        "entityKind",
        "relationKind",
        "tag",
        "owner",
        "updatedFrom",
        "updatedTo",
        "focus"
      ].forEach((key) => next.delete(key));
      next.set("limit", String(DEFAULT_MAX_NODES));
    });
    setAdvancedFiltersOpen(false);
  };

  if (graphQuery.isLoading && !graph) {
    return (
      <LoadingState
        eyebrow="Knowledge Graph"
        title="Loading the Forge world model"
        description="Gathering goals, projects, KarpaWiki pages, psyche entities, calendar context, and Workbench flows into one graph."
      />
    );
  }

  if (graphQuery.isError) {
    return (
      <ErrorState
        eyebrow="Knowledge Graph"
        error={graphQuery.error}
        onRetry={() => void graphQuery.refetch()}
      />
    );
  }

  if (!graph) {
    return null;
  }

  const entityKindFacetCounts = new Map(
    graph.facets.entityKinds.map((entry) => [entry.value, entry] as const)
  );
  const kindOptions = KNOWLEDGE_GRAPH_HIERARCHY_ORDER.map((kind) => {
    const visual = getEntityVisual(kind);
    const facet = entityKindFacetCounts.get(kind);
    const count = facet?.count ?? 0;
    return {
      value: kind,
      label: facet?.label ?? visual.label,
      description: count === 1 ? "1 node" : `${count} nodes`,
      kind
    };
  });
  const relationOptions = graph.facets.relationKinds.map((entry) => ({
    value: entry.value,
    label: entry.label,
    description: `${entry.count} links`
  }));
  const tagOptions = graph.facets.tags.map((entry) => ({
    value: entry.id,
    label: entry.label,
    description: `${entry.count} linked nodes`,
    badge: (
      <EntityBadge
        kind="tag"
        label={entry.label}
        compact
        gradient={false}
      />
    ),
    menuBadge: (
      <EntityBadge
        kind="tag"
        label={entry.label}
        compact
        gradient={false}
      />
    )
  }));
  const ownerOptions = graph.facets.owners.map((entry) => {
    const user = findUserSummary(
      shell.snapshot.users,
      entry.userId,
      entry.displayName,
      entry.kind,
      entry.accentColor
    );
    return {
      value: entry.userId,
      label: entry.displayName,
      description: `${entry.count} nodes`,
      badge: <UserBadge user={user} compact />,
      menuBadge: <UserBadge user={user} compact />
    };
  });
  const quickFilterOptions = [
    ...kindOptions.map((entry) => ({
      id: `entity:${entry.value}`,
      label: entry.label,
      description: entry.description,
      searchText: `entity kind ${entry.label}`,
      badge: (
        <EntityBadge
          kind={entry.kind ?? "note"}
          label={entry.label}
          compact
          gradient={false}
        />
      )
    })),
    ...relationOptions.map((entry) => ({
      id: `relation:${entry.value}`,
      label: entry.label,
      description: entry.description,
      searchText: `relation kind ${entry.label}`
    })),
    ...tagOptions.map((entry) => ({
      id: `tag:${entry.value}`,
      label: entry.label,
      description: entry.description,
      searchText: `tag ${entry.label}`,
      badge: entry.menuBadge ?? entry.badge
    })),
    ...ownerOptions.map((entry) => ({
      id: `owner:${entry.value}`,
      label: entry.label,
      description: entry.description,
      searchText: `owner ${entry.label}`,
      badge: entry.menuBadge ?? entry.badge
    }))
  ] satisfies FacetedTokenOption[];
  const quickFilterSelectionIds = buildQuickFilterSelectionIds({
    entityKinds: selectedKinds,
    relationKinds: selectedRelations,
    tags: selectedTags,
    owners: selectedOwners
  });

  const summaryBadge = graph.counts.limited
    ? `${graph.counts.nodeCount}/${graph.counts.filteredNodeCount} nodes`
    : `${graph.counts.nodeCount}n · ${graph.counts.edgeCount}e`;
  const summaryBadgeTitle = graph.counts.limited
    ? `${graph.counts.nodeCount} visible nodes from ${graph.counts.filteredNodeCount} filtered matches`
    : `${graph.counts.nodeCount} nodes and ${graph.counts.edgeCount} edges`;
  const filtersActive =
    queryText.trim().length > 0 ||
    selectedKinds.length > 0 ||
    selectedRelations.length > 0 ||
    selectedTags.length > 0 ||
    selectedOwners.length > 0 ||
    Boolean(updatedFrom) ||
    Boolean(updatedTo) ||
    maxNodes !== DEFAULT_MAX_NODES;

  const showDesktopGraphChrome = !isMobile;
  const graphSurfaceResetKey = `${selectedView}:${graph.nodes
    .map((node) => node.id)
    .join("|")}::${graph.edges.map((edge) => edge.id).join("|")}`;

  return (
    <div className="-mx-4 -mb-2.5 h-[calc(100dvh-var(--forge-mobile-nav-clearance)-5.25rem)] overflow-hidden lg:-mx-6 lg:-mb-3 lg:-mt-3 lg:h-[calc(100dvh-10rem)]">
      <div className="relative h-full bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.08),transparent_26%),linear-gradient(180deg,rgba(7,12,23,0.98),rgba(5,10,19,1))]">
        <KnowledgeGraphRendererBoundary
          resetKey={graphSurfaceResetKey}
          fallback={(error) => (
            <div className="grid h-full place-items-center p-6 text-center">
              <div className="grid max-w-lg gap-4 rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-[rgba(8,12,22,0.92)] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.36)]">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-[var(--warning)]">
                  <AlertTriangle className="size-5" />
                </div>
                <div className="grid gap-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                    Graph renderer fallback
                  </div>
                  <h2 className="text-lg font-semibold text-[var(--ui-ink-strong)]">
                    The graph renderer hit a display error.
                  </h2>
                  <p className="text-sm leading-6 text-[var(--ui-ink-soft)]">
                    Switch to the hierarchy view or reset the current graph filters. The graph will recover automatically when the dataset changes.
                  </p>
                  <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[rgba(255,255,255,0.04)] px-4 py-3 text-left text-xs text-[var(--ui-ink-faint)]">
                    {error.message}
                  </div>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      setParam((next) => {
                        next.set("view", "hierarchy");
                      })
                    }
                  >
                    <Rows3 className="size-4" />
                    Open hierarchy
                  </Button>
                  <Button variant="secondary" size="sm" onClick={resetFilters}>
                    Reset graph filters
                  </Button>
                </div>
              </div>
            </div>
          )}
        >
          {selectedView === "graph" ? (
            <KnowledgeGraphForceView
              ref={graphViewRef}
              nodes={graph.nodes}
              edges={graph.edges}
              focusNodeId={focusNodeId}
              physicsSettings={physicsSettings}
              onSelectNode={handleFocusNode}
            />
          ) : (
            <div className="h-full overflow-y-auto px-4 py-4 lg:px-6">
              <KnowledgeGraphHierarchyView
                nodes={graph.nodes}
                edges={graph.edges}
                focusNodeId={focusNodeId}
                showSecondaryEdges={showHierarchyCrossLinks}
                isMobile={isMobile}
                onSelectNode={handleFocusNode}
                onOpenNode={handleFocusNode}
                onNavigateNode={handleNavigateNode}
              />
            </div>
          )}
        </KnowledgeGraphRendererBoundary>

        {isMobile ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-2 lg:hidden">
            <div className="pointer-events-auto flex items-center gap-1.5">
              <div
                title={summaryBadgeTitle}
                className="shrink-0 rounded-full border border-white/10 bg-[rgba(8,12,20,0.78)] px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-white/48 backdrop-blur"
              >
                {summaryBadge}
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <div className="flex shrink-0 rounded-full border border-white/10 bg-[rgba(8,12,20,0.78)] p-0.5 shadow-[0_14px_42px_rgba(0,0,0,0.24)] backdrop-blur">
                  <button
                    type="button"
                    className={`rounded-full px-2 py-1 text-[10px] transition ${
                      selectedView === "graph"
                        ? "bg-white/[0.14] text-white"
                        : "text-white/52 hover:text-white"
                    }`}
                    onClick={() =>
                      setParam((next) => {
                        next.set("view", "graph");
                      })
                    }
                  >
                    Graph
                  </button>
                  <button
                    type="button"
                    className={`rounded-full px-2 py-1 text-[10px] transition ${
                      selectedView === "hierarchy"
                        ? "bg-white/[0.14] text-white"
                        : "text-white/52 hover:text-white"
                    }`}
                    onClick={() =>
                      setParam((next) => {
                        next.set("view", "hierarchy");
                      })
                    }
                  >
                    Hierarchy
                  </button>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 rounded-full border-white/10 bg-[rgba(8,12,20,0.78)] px-2 text-[10px] text-white/68 backdrop-blur hover:text-white"
                  onClick={() => setAppearanceDialogOpen(true)}
                  aria-label="Open graph appearance settings"
                  title="Graph appearance settings"
                >
                  <Settings2 className="size-3" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 rounded-full border-white/10 bg-[rgba(8,12,20,0.78)] px-2 text-[10px] text-white/68 backdrop-blur hover:text-white"
                  onClick={() => {
                    setMobilePanelOpen(false);
                    setMobileFiltersOpen(true);
                  }}
                  aria-label="Open graph filters"
                >
                  <SlidersHorizontal className="size-3" />
                  Search
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {showDesktopGraphChrome ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-3 lg:px-6">
            <div
              data-testid="knowledge-graph-desktop-toolbar"
              className="pointer-events-auto flex items-center gap-1.5"
            >
              <div
                data-testid="knowledge-graph-count-pill"
                title={summaryBadgeTitle}
                className="shrink-0 rounded-full border border-white/10 bg-[rgba(8,12,20,0.78)] px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-white/48 backdrop-blur"
              >
                {summaryBadge}
              </div>
              <div className="min-w-0 flex-1">
                <FacetedTokenSearch
                  title=""
                  description=""
                  compact
                  minimal
                  hideSummary
                  query={draftQueryText}
                  onQueryChange={setDraftQueryText}
                  onQuerySubmit={submitGraphSearch}
                  submitLabel="Search graph"
                  options={quickFilterOptions}
                  selectedOptionIds={quickFilterSelectionIds}
                  onSelectedOptionIdsChange={(selectedOptionIds) => {
                    const parsed = parseQuickFilterSelectionIds(selectedOptionIds);
                    setParam((next) => {
                      writeMultiParam(next, "entityKind", parsed.entityKinds);
                      writeMultiParam(next, "relationKind", parsed.relationKinds);
                      writeMultiParam(next, "tag", parsed.tags);
                      writeMultiParam(next, "owner", parsed.owners);
                    });
                  }}
                  resultSummary=""
                  placeholder="Type a graph search, then press Enter or the search button"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 rounded-full border-white/10 bg-[rgba(8,12,20,0.78)] px-2 text-[10px] text-white/68 backdrop-blur hover:text-white"
                onClick={() => setAdvancedFiltersOpen((current) => !current)}
              >
                <SlidersHorizontal className="size-3" />
                Advanced
              </Button>
              {filtersActive ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 rounded-full border-white/10 bg-[rgba(8,12,20,0.78)] px-2 text-[10px] text-white/68 backdrop-blur hover:text-white"
                  onClick={resetFilters}
                >
                  Reset
                </Button>
              ) : null}
            </div>

            <AnimatePresence initial={false}>
              {advancedFiltersOpen ? (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="pointer-events-auto mt-2 ml-auto max-w-[min(54rem,calc(100%-3.5rem))] rounded-[20px] border border-white/10 bg-[rgba(8,12,20,0.88)] p-3 shadow-[0_20px_60px_rgba(0,0,0,0.32)] backdrop-blur"
                >
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(17rem,1fr)]">
                    <div className="grid gap-3">
                      <EntityLinkMultiSelect
                        options={kindOptions}
                        selectedValues={selectedKinds}
                        onChange={(values) =>
                          setParam((next) => {
                            writeMultiParam(next, "entityKind", values);
                          })
                        }
                        placeholder="Filter by entity type"
                        emptyMessage="No entity kinds match the current graph."
                      />
                      <EntityLinkMultiSelect
                        options={relationOptions}
                        selectedValues={selectedRelations}
                        onChange={(values) =>
                          setParam((next) => {
                            writeMultiParam(next, "relationKind", values);
                          })
                        }
                        placeholder="Filter by relation type"
                        emptyMessage="No relation kinds match the current graph."
                      />
                      <EntityLinkMultiSelect
                        options={tagOptions}
                        selectedValues={selectedTags}
                        onChange={(values) =>
                          setParam((next) => {
                            writeMultiParam(next, "tag", values);
                          })
                        }
                        placeholder="Filter by tag"
                        emptyMessage="No tags are available in the current filtered graph."
                      />
                      <EntityLinkMultiSelect
                        options={ownerOptions}
                        selectedValues={selectedOwners}
                        onChange={(values) =>
                          setParam((next) => {
                            writeMultiParam(next, "owner", values);
                          })
                        }
                        placeholder="Filter by owner"
                        emptyMessage="No owners match the current graph."
                      />
                    </div>

                    <div className="grid gap-3 rounded-[20px] border border-white/10 bg-white/[0.03] p-3">
                      <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-white/46">
                          <span>Max nodes shown</span>
                          <span>{maxNodes}</span>
                        </div>
                        <input
                          type="range"
                          min={MIN_MAX_NODES}
                          max={MAX_MAX_NODES}
                          step={20}
                          value={maxNodes}
                          onChange={(event) =>
                            setParam((next) => {
                              next.set("limit", event.target.value);
                            })
                          }
                          className="w-full accent-[var(--secondary)]"
                        />
                        <div className="text-xs text-white/42">
                          The graph stays deterministic under the cap and focus mode redistributes the visible neighborhood around the selected node.
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">
                            Updated from
                          </div>
                          <Input
                            type="date"
                            value={formatDateInput(updatedFrom)}
                            min={formatDateInput(graph.facets.updatedAt.min)}
                            max={formatDateInput(updatedTo ?? graph.facets.updatedAt.max)}
                            onChange={(event) =>
                              setParam((next) => {
                                if (event.target.value) {
                                  next.set("updatedFrom", event.target.value);
                                } else {
                                  next.delete("updatedFrom");
                                }
                              })
                            }
                          />
                        </div>
                        <div className="grid gap-2">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">
                            Updated to
                          </div>
                          <Input
                            type="date"
                            value={formatDateInput(updatedTo)}
                            min={formatDateInput(updatedFrom ?? graph.facets.updatedAt.min)}
                            max={formatDateInput(graph.facets.updatedAt.max)}
                            onChange={(event) =>
                              setParam((next) => {
                                if (event.target.value) {
                                  next.set("updatedTo", event.target.value);
                                } else {
                                  next.delete("updatedTo");
                                }
                              })
                            }
                          />
                        </div>
                      </div>

                      {selectedView === "hierarchy" ? (
                        <Button
                          variant={showHierarchyCrossLinks ? "primary" : "secondary"}
                          size="sm"
                          className="h-8 rounded-full px-3 text-xs"
                          onClick={() =>
                            setParam((next) => {
                              if (showHierarchyCrossLinks) {
                                next.delete("cross");
                              } else {
                                next.set("cross", "1");
                              }
                            })
                          }
                        >
                          {showHierarchyCrossLinks ? "Hide cross-links" : "Show cross-links"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}

        {!isMobile ? (
          <div className="pointer-events-none absolute bottom-5 left-4 z-20 lg:left-6">
            <div className="flex items-center gap-2">
              <div className="pointer-events-auto flex shrink-0 rounded-full border border-white/10 bg-[rgba(8,12,20,0.82)] p-0.5 shadow-[0_14px_42px_rgba(0,0,0,0.24)] backdrop-blur">
                <button
                  type="button"
                  className={`rounded-full px-2.5 py-1.5 text-[10px] transition ${
                    selectedView === "graph"
                      ? "bg-white/[0.14] text-white"
                      : "text-white/52 hover:text-white"
                  }`}
                  onClick={() =>
                    setParam((next) => {
                      next.set("view", "graph");
                    })
                  }
                >
                  Graph
                </button>
                <button
                  type="button"
                  className={`rounded-full px-2.5 py-1.5 text-[10px] transition ${
                    selectedView === "hierarchy"
                      ? "bg-white/[0.14] text-white"
                      : "text-white/52 hover:text-white"
                  }`}
                  onClick={() =>
                    setParam((next) => {
                      next.set("view", "hierarchy");
                    })
                  }
                >
                  Hierarchy
                </button>
              </div>
              {selectedView === "graph" ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="pointer-events-auto size-8 rounded-full border-white/10 bg-[rgba(8,12,20,0.82)] p-0 text-white/72 backdrop-blur hover:text-white"
                    onClick={() => setAppearanceDialogOpen(true)}
                    title="Graph appearance settings"
                    aria-label="Open graph appearance settings"
                  >
                    <Settings2 className="size-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="pointer-events-auto size-8 rounded-full border-white/10 bg-[rgba(8,12,20,0.82)] p-0 text-white/72 backdrop-blur hover:text-white"
                    onClick={() => graphViewRef.current?.zoomIn()}
                    title="Zoom in"
                    aria-label="Zoom in"
                  >
                    <Plus className="size-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="pointer-events-auto size-8 rounded-full border-white/10 bg-[rgba(8,12,20,0.82)] p-0 text-white/72 backdrop-blur hover:text-white"
                    onClick={() => graphViewRef.current?.zoomOut()}
                    title="Zoom out"
                    aria-label="Zoom out"
                  >
                    <Minus className="size-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="pointer-events-auto size-8 rounded-full border-white/10 bg-[rgba(8,12,20,0.82)] p-0 text-white/72 backdrop-blur hover:text-white"
                    onClick={() => graphViewRef.current?.recenterOnFocus()}
                    disabled={!focusPayload.focusNode}
                    title="Recenter"
                    aria-label="Recenter"
                  >
                    <Crosshair className="size-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="pointer-events-auto size-8 rounded-full border-white/10 bg-[rgba(8,12,20,0.82)] p-0 text-white/72 backdrop-blur hover:text-white"
                    onClick={() => graphViewRef.current?.fit()}
                    title="Reset camera"
                    aria-label="Reset camera"
                  >
                    <ScanSearch className="size-3.5" />
                  </Button>
                  {diagnosticsAvailable ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="pointer-events-auto size-8 rounded-full border-white/10 bg-[rgba(8,12,20,0.82)] p-0 text-white/72 backdrop-blur hover:text-white"
                      onClick={() =>
                        dispatch(
                          setKnowledgeGraphDiagnosticsPanelOpen(
                            !knowledgeGraphDiagnostics.panelOpen
                          )
                        )
                      }
                      title="Open graph diagnostics"
                      aria-label="Open graph diagnostics"
                    >
                      <Bug className="size-3.5" />
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        ) : null}

      </div>

      <SheetScaffold
        open={mobilePanelOpen && Boolean(focusPayload.focusNode)}
        onOpenChange={setMobilePanelOpen}
        eyebrow="Knowledge Graph"
        title={focusPayload.focusNode?.title ?? "Focus node"}
        description={
          focusPayload.focusNode?.subtitle ??
          "Inspect the selected node and move deeper into the graph."
        }
      >
        <KnowledgeGraphEntityPanel
          focus={focusPayload}
          onOpenPage={(node) => {
            setMobilePanelOpen(false);
            handleNavigateNode(node);
          }}
          onOpenNotes={(node) => {
            setMobilePanelOpen(false);
            handleOpenNotes(node);
          }}
          onOpenHierarchy={(node) => {
            setMobilePanelOpen(false);
            handleOpenHierarchy(node);
          }}
          onSelectNode={handleFocusNode}
          className="border-0 bg-transparent p-0 shadow-none"
        />
      </SheetScaffold>

      <SheetScaffold
        open={mobileFiltersOpen}
        onOpenChange={setMobileFiltersOpen}
        eyebrow="Knowledge Graph"
        title="Filter graph"
        description="Search the visible graph and adjust the focus cap without covering the canvas all the time."
      >
        <div className="grid gap-4 pb-2">
          <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[rgba(255,255,255,0.03)] p-3">
            <FacetedTokenSearch
              title=""
              description=""
              compact
              query={draftQueryText}
              onQueryChange={setDraftQueryText}
              onQuerySubmit={submitGraphSearch}
              submitLabel="Search graph"
              options={quickFilterOptions}
              selectedOptionIds={quickFilterSelectionIds}
              onSelectedOptionIdsChange={(selectedOptionIds) => {
                const parsed = parseQuickFilterSelectionIds(selectedOptionIds);
                setParam((next) => {
                  writeMultiParam(next, "entityKind", parsed.entityKinds);
                  writeMultiParam(next, "relationKind", parsed.relationKinds);
                  writeMultiParam(next, "tag", parsed.tags);
                  writeMultiParam(next, "owner", parsed.owners);
                });
              }}
              resultSummary={summaryBadgeTitle}
              placeholder="Type a graph search, then press Enter or the search button"
            />
          </div>

          <div className="grid gap-3">
            <EntityLinkMultiSelect
              options={kindOptions}
              selectedValues={selectedKinds}
              onChange={(values) =>
                setParam((next) => {
                  writeMultiParam(next, "entityKind", values);
                })
              }
              placeholder="Filter by entity type"
              emptyMessage="No entity kinds match the current graph."
            />
            <EntityLinkMultiSelect
              options={relationOptions}
              selectedValues={selectedRelations}
              onChange={(values) =>
                setParam((next) => {
                  writeMultiParam(next, "relationKind", values);
                })
              }
              placeholder="Filter by relation type"
              emptyMessage="No relation kinds match the current graph."
            />
            <EntityLinkMultiSelect
              options={tagOptions}
              selectedValues={selectedTags}
              onChange={(values) =>
                setParam((next) => {
                  writeMultiParam(next, "tag", values);
                })
              }
              placeholder="Filter by tag"
              emptyMessage="No tags are available in the current filtered graph."
            />
            <EntityLinkMultiSelect
              options={ownerOptions}
              selectedValues={selectedOwners}
              onChange={(values) =>
                setParam((next) => {
                  writeMultiParam(next, "owner", values);
                })
              }
              placeholder="Filter by owner"
              emptyMessage="No owners match the current graph."
            />
          </div>

          <div className="grid gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[rgba(255,255,255,0.03)] p-3">
            <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-white/46">
              <span>Max nodes shown</span>
              <span>{maxNodes}</span>
            </div>
            <input
              type="range"
              min={MIN_MAX_NODES}
              max={MAX_MAX_NODES}
              step={20}
              value={maxNodes}
              onChange={(event) =>
                setParam((next) => {
                  next.set("limit", event.target.value);
                })
              }
              className="w-full accent-[var(--secondary)]"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">
                  Updated from
                </div>
                <Input
                  type="date"
                  value={formatDateInput(updatedFrom)}
                  min={formatDateInput(graph.facets.updatedAt.min)}
                  max={formatDateInput(updatedTo ?? graph.facets.updatedAt.max)}
                  onChange={(event) =>
                    setParam((next) => {
                      if (event.target.value) {
                        next.set("updatedFrom", event.target.value);
                      } else {
                        next.delete("updatedFrom");
                      }
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">
                  Updated to
                </div>
                <Input
                  type="date"
                  value={formatDateInput(updatedTo)}
                  min={formatDateInput(updatedFrom ?? graph.facets.updatedAt.min)}
                  max={formatDateInput(graph.facets.updatedAt.max)}
                  onChange={(event) =>
                    setParam((next) => {
                      if (event.target.value) {
                        next.set("updatedTo", event.target.value);
                      } else {
                        next.delete("updatedTo");
                      }
                    })
                  }
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={resetFilters}>
                Reset
              </Button>
              <Button variant="primary" size="sm" onClick={() => setMobileFiltersOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      </SheetScaffold>

      <Dialog.Root open={appearanceDialogOpen} onOpenChange={setAppearanceDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(4,8,18,0.72)] backdrop-blur-xl" />
          <Dialog.Content className="fixed inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-50 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,23,36,0.98),rgba(8,12,22,0.98))] shadow-[0_32px_90px_rgba(3,8,18,0.48)] md:left-1/2 md:right-auto md:w-[min(40rem,calc(100vw-3rem))] md:-translate-x-1/2">
            <Dialog.Title className="sr-only">Knowledge Graph appearance settings</Dialog.Title>
            <Dialog.Description className="sr-only">
              Tune the graph focus physics and appearance response.
            </Dialog.Description>

            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/8 bg-[rgba(8,12,22,0.9)] px-5 py-4 backdrop-blur-xl">
              <div className="grid gap-1">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                  Graph appearance
                </div>
                <div className="font-display text-2xl text-white">
                  Tune the focus field
                </div>
                <p className="max-w-xl text-sm leading-6 text-white/55">
                  Shape how strongly a focused node opens its neighborhood and how far that pressure diffuses through connected hops.
                </p>
              </div>
              <Dialog.Close asChild>
                <ModalCloseButton aria-label="Close graph appearance settings" />
              </Dialog.Close>
            </div>

            <div className="grid gap-4 px-5 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        Focused repulsion
                      </div>
                      <div className="text-xs leading-5 text-white/46">
                        Push nearby nodes apart more aggressively while the focused node stays anchored.
                      </div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs text-white/72">
                      {physicsSettings.focusRepulsion.toFixed(2)}
                    </div>
                  </div>
                  <input
                    aria-label="Focused repulsion"
                    type="range"
                    min="0.6"
                    max={String(KNOWLEDGE_GRAPH_MAX_FOCUS_REPULSION)}
                    step="0.05"
                    value={physicsSettings.focusRepulsion}
                    onChange={(event) =>
                      updatePhysicsSetting(
                        "focusRepulsion",
                        Number(event.target.value)
                      )
                    }
                    className="w-full accent-[var(--secondary)]"
                  />
                </div>

                <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        Focus diffusion
                      </div>
                      <div className="text-xs leading-5 text-white/46">
                        Extend the focus field further through multi-hop neighbors and lengthen the reversible transition.
                      </div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs text-white/72">
                      {physicsSettings.focusDiffusion.toFixed(2)}
                    </div>
                  </div>
                  <input
                    aria-label="Focus diffusion"
                    type="range"
                    min="0.6"
                    max={String(KNOWLEDGE_GRAPH_MAX_FOCUS_DIFFUSION)}
                    step="0.05"
                    value={physicsSettings.focusDiffusion}
                    onChange={(event) =>
                      updatePhysicsSetting(
                        "focusDiffusion",
                        Number(event.target.value)
                      )
                    }
                    className="w-full accent-[var(--secondary)]"
                  />
                </div>

                <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        Spring reduction max
                      </div>
                      <div className="text-xs leading-5 text-white/46">
                        Reduce edge spring constants most strongly around the focused node so its local neighborhood can open more freely.
                      </div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs text-white/72">
                      {physicsSettings.focusSpringReductionMax.toFixed(2)}
                    </div>
                  </div>
                  <input
                    aria-label="Spring reduction max"
                    type="range"
                    min="0"
                    max={String(KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_REDUCTION)}
                    step="0.02"
                    value={physicsSettings.focusSpringReductionMax}
                    onChange={(event) =>
                      updatePhysicsSetting(
                        "focusSpringReductionMax",
                        Number(event.target.value)
                      )
                    }
                    className="w-full accent-[var(--secondary)]"
                  />
                </div>

                <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        Spring reduction diffusion
                      </div>
                      <div className="text-xs leading-5 text-white/46">
                        Spread that spring softening progressively through first-hop, second-hop, and more distant neighborhoods.
                      </div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs text-white/72">
                      {physicsSettings.focusSpringReductionDiffusion.toFixed(2)}
                    </div>
                  </div>
                  <input
                    aria-label="Spring reduction diffusion"
                    type="range"
                    min="0.6"
                    max={String(KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_DIFFUSION)}
                    step="0.05"
                    value={physicsSettings.focusSpringReductionDiffusion}
                    onChange={(event) =>
                      updatePhysicsSetting(
                        "focusSpringReductionDiffusion",
                        Number(event.target.value)
                      )
                    }
                    className="w-full accent-[var(--secondary)]"
                  />
                </div>

                <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        Edge spring strength
                      </div>
                      <div className="text-xs leading-5 text-white/46">
                        Lower this to loosen graph edges globally and let neighborhoods spread instead of snapping tightly inward.
                      </div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs text-white/72">
                      {physicsSettings.edgeSpringStrength.toFixed(2)}
                    </div>
                  </div>
                  <input
                    aria-label="Edge spring strength"
                    type="range"
                    min={String(KNOWLEDGE_GRAPH_MIN_EDGE_SPRING_STRENGTH)}
                    max={String(KNOWLEDGE_GRAPH_MAX_EDGE_SPRING_STRENGTH)}
                    step="0.05"
                    value={physicsSettings.edgeSpringStrength}
                    onChange={(event) =>
                      updatePhysicsSetting(
                        "edgeSpringStrength",
                        Number(event.target.value)
                      )
                    }
                    className="w-full accent-[var(--secondary)]"
                  />
                </div>

                <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        Gravity strength
                      </div>
                      <div className="text-xs leading-5 text-white/46">
                        Reduce this to weaken the global inward pull that compacts the whole graph toward the middle.
                      </div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs text-white/72">
                      {physicsSettings.gravityStrength.toFixed(2)}
                    </div>
                  </div>
                  <input
                    aria-label="Gravity strength"
                    type="range"
                    min="0"
                    max={String(KNOWLEDGE_GRAPH_MAX_GRAVITY_STRENGTH)}
                    step="0.05"
                    value={physicsSettings.gravityStrength}
                    onChange={(event) =>
                      updatePhysicsSetting(
                        "gravityStrength",
                        Number(event.target.value)
                      )
                    }
                    className="w-full accent-[var(--secondary)]"
                  />
                </div>

                <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        Focus shell spacing
                      </div>
                      <div className="text-xs leading-5 text-white/46">
                        Increase this to push focused rings farther outward and visibly open the local structure.
                      </div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs text-white/72">
                      {physicsSettings.focusShellSpacing.toFixed(2)}
                    </div>
                  </div>
                  <input
                    aria-label="Focus shell spacing"
                    type="range"
                    min={String(KNOWLEDGE_GRAPH_MIN_FOCUS_SHELL_SPACING)}
                    max={String(KNOWLEDGE_GRAPH_MAX_FOCUS_SHELL_SPACING)}
                    step="0.05"
                    value={physicsSettings.focusShellSpacing}
                    onChange={(event) =>
                      updatePhysicsSetting(
                        "focusShellSpacing",
                        Number(event.target.value)
                      )
                    }
                    className="w-full accent-[var(--secondary)]"
                  />
                </div>
              </div>

              <div className="rounded-[24px] border border-white/8 bg-[rgba(125,211,252,0.07)] px-4 py-3 text-sm leading-6 text-white/62">
                The main cramming forces are the edge springs and the inward gravity pull. Lower edge spring strength or gravity strength to let the whole graph breathe more, then raise focus shell spacing and spring-reduction controls when you want a selected neighborhood to open dramatically.
              </div>

              <div className="flex flex-wrap justify-between gap-3">
                <Button
                  variant="secondary"
                  onClick={() =>
                    setPhysicsSettings(DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS)
                  }
                >
                  Reset defaults
                </Button>
                <Dialog.Close asChild>
                  <Button variant="primary">Done</Button>
                </Dialog.Close>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {diagnosticsAvailable ? (
        <Dialog.Root
          open={knowledgeGraphDiagnostics.panelOpen}
          onOpenChange={(open) =>
            dispatch(setKnowledgeGraphDiagnosticsPanelOpen(open))
          }
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(4,8,18,0.64)] backdrop-blur-xl" />
            <Dialog.Content className="fixed inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-50 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,23,36,0.98),rgba(8,12,22,0.98))] shadow-[0_32px_90px_rgba(3,8,18,0.48)] md:left-1/2 md:right-auto md:w-[min(56rem,calc(100vw-3rem))] md:-translate-x-1/2">
              <Dialog.Title className="sr-only">Knowledge Graph diagnostics</Dialog.Title>
              <Dialog.Description className="sr-only">
                Inspect startup centering, drift metrics, lifecycle events, and periodic graph snapshots.
              </Dialog.Description>

              <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/8 bg-[rgba(8,12,22,0.9)] px-5 py-4 backdrop-blur-xl">
                <div className="grid gap-1">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                    Dev diagnostics
                  </div>
                  <div className="font-display text-2xl text-white">
                    Knowledge Graph truth surface
                  </div>
                  <p className="max-w-2xl text-sm leading-6 text-white/55">
                    Track startup phase, origin drift, recent lifecycle logs, and the bounded 5-second graph snapshots that help catch centering regressions.
                  </p>
                </div>
                <Dialog.Close asChild>
                  <ModalCloseButton aria-label="Close graph diagnostics" />
                </Dialog.Close>
              </div>

              <div className="grid gap-4 px-5 py-5">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                      Startup phase
                    </div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {knowledgeGraphDiagnostics.latestStatus?.startupPhase ?? "boot"}
                    </div>
                    <div className="mt-1 text-xs text-white/50">
                      {knowledgeGraphDiagnostics.latestStatus?.startupInvariantSatisfied
                        ? "Origin invariant holding"
                        : "Waiting for invariant or correction"}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                      Camera drift
                    </div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {knowledgeGraphDiagnostics.latestStatus
                        ? knowledgeGraphDiagnostics.latestStatus.driftMetrics.cameraDistanceFromOrigin.toFixed(
                            3
                          )
                        : "0.000"}
                    </div>
                    <div className="mt-1 text-xs text-white/50">
                      camera {knowledgeGraphDiagnostics.latestStatus
                        ? `${knowledgeGraphDiagnostics.latestStatus.camera.x.toFixed(3)}, ${knowledgeGraphDiagnostics.latestStatus.camera.y.toFixed(3)}`
                        : "0.000, 0.000"}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                      Graph centroid
                    </div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {knowledgeGraphDiagnostics.latestStatus
                        ? knowledgeGraphDiagnostics.latestStatus.driftMetrics.centroidDistanceFromOrigin.toFixed(
                            3
                          )
                        : "0.000"}
                    </div>
                    <div className="mt-1 text-xs text-white/50">
                      centroid {knowledgeGraphDiagnostics.latestStatus
                        ? `${knowledgeGraphDiagnostics.latestStatus.graphCentroid.x.toFixed(3)}, ${knowledgeGraphDiagnostics.latestStatus.graphCentroid.y.toFixed(3)}`
                        : "0.000, 0.000"}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                      Snapshot ring
                    </div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {knowledgeGraphDiagnostics.recentSnapshots.length}
                    </div>
                    <div className="mt-1 text-xs text-white/50">
                      latest {knowledgeGraphDiagnostics.latestStatus?.latestSnapshotAt ?? "none"}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                  <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">
                          Recent lifecycle events
                        </div>
                        <div className="text-xs text-white/46">
                          Scoped dev events from the page and graph renderer.
                        </div>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs text-white/72">
                        {knowledgeGraphDiagnostics.recentEvents.length}
                      </div>
                    </div>
                    <div className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
                      {knowledgeGraphDiagnostics.recentEvents.map((event) => (
                        <div
                          key={event.id}
                          className="rounded-[18px] border border-white/8 bg-[rgba(255,255,255,0.03)] px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-medium text-white">
                              {event.eventKey}
                            </div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-white/38">
                              {event.level}
                            </div>
                          </div>
                          <div className="mt-1 text-sm text-white/72">
                            {event.message}
                          </div>
                          <div className="mt-1 text-[11px] text-white/40">
                            {event.createdAt}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">
                          Snapshot summaries
                        </div>
                        <div className="text-xs text-white/46">
                          Periodic dev snapshots of node positions, camera state, and drift metrics.
                        </div>
                      </div>
                    </div>
                    <div className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
                      {knowledgeGraphDiagnostics.recentSnapshots.map((snapshot) => (
                        <div
                          key={snapshot.id}
                          className="rounded-[18px] border border-white/8 bg-[rgba(255,255,255,0.03)] px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-medium text-white">
                              {snapshot.startupPhase}
                            </div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-white/38">
                              {snapshot.rendererMode}
                            </div>
                          </div>
                          <div className="mt-1 text-sm text-white/72">
                            {snapshot.nodeCount} nodes · centroid drift{" "}
                            {snapshot.driftMetrics.centroidDistanceFromOrigin.toFixed(3)} · camera drift{" "}
                            {snapshot.driftMetrics.cameraDistanceFromOrigin.toFixed(3)}
                          </div>
                          <div className="mt-1 text-[11px] text-white/40">
                            {snapshot.capturedAt}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}
