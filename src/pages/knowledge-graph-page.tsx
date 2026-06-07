import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import { GamificationMiniHud } from "@/components/gamification/gamification-widgets";
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
  KNOWLEDGE_GRAPH_HIERARCHY_ORDER,
  type KnowledgeGraphEntityKind,
  type KnowledgeGraphNode,
  type KnowledgeGraphQuery,
  type KnowledgeGraphRelationKind,
  type KnowledgeGraphView
} from "@/lib/knowledge-graph-types";
import { buildKnowledgeGraphFocusPayload } from "@/lib/knowledge-graph";
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
  DEFAULT_KNOWLEDGE_GRAPH_MAX_NODES,
  MAX_KNOWLEDGE_GRAPH_MAX_NODES,
  MIN_KNOWLEDGE_GRAPH_MAX_NODES,
  buildKnowledgeGraphQueryFromPageState,
  buildKnowledgeGraphQuickFilterSelectionIds,
  findKnowledgeGraphUserSummary,
  formatKnowledgeGraphDateInput,
  getKnowledgeGraphNodeNotesHref,
  loadKnowledgeGraphPhysicsSettings,
  parseKnowledgeGraphPageState,
  parseKnowledgeGraphQuickFilterSelectionIds,
  resolveKnowledgeGraphFocusInteraction,
  resolveKnowledgeGraphOverlaySyncAction,
  saveKnowledgeGraphPhysicsSettings,
  shouldPublishKnowledgeGraphPageDiagnostics,
  writeKnowledgeGraphFocusParam,
  writeKnowledgeGraphMultiParam
} from "@/pages/knowledge-graph-page-model";
import { setKnowledgeGraphDiagnosticsPanelOpen } from "@/store/slices/knowledge-graph-diagnostics-slice";
import {
  clearKnowledgeGraphOverlayFocus,
  setKnowledgeGraphOverlayFocus
} from "@/store/slices/shell-slice";
import { useAppDispatch, useAppSelector } from "@/store/typed-hooks";
import { getEntityVisual } from "@/lib/entity-visuals";

const graphFloatingChipClass =
  "shrink-0 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)] shadow-[var(--ui-shadow-soft)] backdrop-blur";
const graphSegmentedControlClass =
  "flex shrink-0 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-0.5 shadow-[var(--ui-shadow-soft)] backdrop-blur";
const graphSegmentActiveClass =
  "bg-[var(--ui-accent-soft)] text-[var(--primary)] shadow-[var(--ui-shadow-soft)]";
const graphSegmentInactiveClass =
  "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]";
const graphFloatingButtonClass =
  "rounded-full border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] shadow-[var(--ui-shadow-soft)] backdrop-blur hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]";
const graphDialogOverlayClass =
  "fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--ui-scrim)_72%,transparent)] backdrop-blur-xl";
const graphDialogContentClass =
  "fixed inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-50 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[30px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] shadow-[var(--ui-shadow-floating)] md:left-1/2 md:right-auto md:-translate-x-1/2";
const graphDialogHeaderClass =
  "sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-5 py-4 backdrop-blur-xl";
const graphDialogEyebrowClass =
  "text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const graphDialogTitleClass =
  "font-display text-2xl text-[var(--ui-ink-strong)]";
const graphDialogCopyClass =
  "text-sm leading-6 text-[var(--ui-ink-soft)]";
const graphDialogCardClass =
  "grid min-w-0 gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4";
const graphDialogMetricCardClass =
  "min-w-0 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4";
const graphDialogMiniCardClass =
  "min-w-0 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2";
const graphDialogCardTitleClass =
  "text-sm font-medium text-[var(--ui-ink-strong)]";
const graphDialogCardCopyClass =
  "text-xs leading-5 text-[var(--ui-ink-faint)]";
const graphDialogPillClass =
  "rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-1 text-xs text-[var(--ui-ink-soft)]";
const graphDialogNoticeClass =
  "rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-info-soft)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]";

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
  const [physicsSettings, setPhysicsSettings] =
    useState<KnowledgeGraphPhysicsSettings>(() =>
      loadKnowledgeGraphPhysicsSettings()
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
    saveKnowledgeGraphPhysicsSettings(physicsSettings);
  }, [physicsSettings]);

  const searchParamsKey = searchParams.toString();
  const parsedPageState = useMemo(
    () => parseKnowledgeGraphPageState(searchParamsKey),
    [searchParamsKey]
  );

  const {
    selectedView,
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
    () => buildKnowledgeGraphQueryFromPageState(parsedPageState),
    [parsedPageState]
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
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("focus");
        return next;
      },
      { replace: true }
    );
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
    return buildKnowledgeGraphFocusPayload(
      graph.nodes,
      graph.edges,
      focusNodeId
    );
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
          ? (graph.nodes.find((node) => node.id === nodeId) ?? null)
          : null;
        handleFocusNode(nextNode);
      },
      activateFocusedNode: () => {
        if (!focusNodeId || !graph) {
          return;
        }
        const nextNode =
          graph.nodes.find((node) => node.id === focusNodeId) ?? null;
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
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        mutate(next);
        return next;
      },
      { replace: true }
    );
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
      nextNodeId: node?.id ?? null
    });

    pendingMobileSheetNodeIdRef.current =
      isMobile && interaction.nextMobileSheetOpen ? (node?.id ?? null) : null;
    setMobilePanelOpen(interaction.nextMobileSheetOpen);
    if (!interaction.shouldUpdateFocus) {
      return;
    }

    setParam((next) => {
      writeKnowledgeGraphFocusParam(next, node);
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
    const href = getKnowledgeGraphNodeNotesHref(node);
    if (href) {
      navigate(href);
    }
  };

  const handleOpenHierarchy = (node: KnowledgeGraphNode) => {
    setParam((next) => {
      next.set("view", "hierarchy");
      writeKnowledgeGraphFocusParam(next, node);
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
      next.set("limit", String(DEFAULT_KNOWLEDGE_GRAPH_MAX_NODES));
    });
    setAdvancedFiltersOpen(false);
  };

  if (graphQuery.isLoading && !graph) {
    return (
      <LoadingState
        eyebrow="Knowledge Graph"
        title="Loading the Forge world model"
        description="Gathering goals, projects, Forge Wiki pages, psyche entities, calendar context, and Workbench flows into one graph."
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
      <EntityBadge kind="tag" label={entry.label} compact gradient={false} />
    ),
    menuBadge: (
      <EntityBadge kind="tag" label={entry.label} compact gradient={false} />
    )
  }));
  const ownerOptions = graph.facets.owners.map((entry) => {
    const user = findKnowledgeGraphUserSummary(
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
  const quickFilterSelectionIds = buildKnowledgeGraphQuickFilterSelectionIds({
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
    maxNodes !== DEFAULT_KNOWLEDGE_GRAPH_MAX_NODES;

  const showDesktopGraphChrome = !isMobile;
  const graphSurfaceResetKey = `${selectedView}:${graph.nodes
    .map((node) => node.id)
    .join("|")}::${graph.edges.map((edge) => edge.id).join("|")}`;

  return (
    <div className="h-[calc(100dvh-var(--forge-mobile-nav-clearance)-5.25rem)] overflow-hidden lg:-mt-3 lg:h-[calc(100dvh-10rem)]">
      <div className="relative h-full bg-[var(--ui-surface-0)]">
        <div className="pointer-events-auto absolute right-3 top-3 z-30 hidden md:block">
          <GamificationMiniHud metrics={shell.snapshot.metrics} />
        </div>
        <KnowledgeGraphRendererBoundary
          resetKey={graphSurfaceResetKey}
          fallback={(error) => (
            <div className="grid h-full place-items-center p-6 text-center">
              <div className="grid max-w-lg gap-4 rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-6 shadow-[var(--ui-shadow-floating)]">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-warning-soft)] text-[var(--warning)]">
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
                    Switch to the hierarchy view or reset the current graph
                    filters. The graph will recover automatically when the
                    dataset changes.
                  </p>
                  <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-left text-xs text-[var(--ui-ink-faint)]">
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
                className={graphFloatingChipClass}
              >
                {summaryBadge}
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <div className={graphSegmentedControlClass}>
                  <button
                    type="button"
                    className={`rounded-full px-2 py-1 text-[10px] transition ${
                      selectedView === "graph"
                        ? graphSegmentActiveClass
                        : graphSegmentInactiveClass
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
                        ? graphSegmentActiveClass
                        : graphSegmentInactiveClass
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
                  className={`h-7 px-2 text-[10px] ${graphFloatingButtonClass}`}
                  onClick={() => setAppearanceDialogOpen(true)}
                  aria-label="Open graph appearance settings"
                  title="Graph appearance settings"
                >
                  <Settings2 className="size-3" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className={`h-7 px-2 text-[10px] ${graphFloatingButtonClass}`}
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
                className={graphFloatingChipClass}
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
                    const parsed =
                      parseKnowledgeGraphQuickFilterSelectionIds(
                        selectedOptionIds
                      );
                    setParam((next) => {
                      writeKnowledgeGraphMultiParam(
                        next,
                        "entityKind",
                        parsed.entityKinds
                      );
                      writeKnowledgeGraphMultiParam(
                        next,
                        "relationKind",
                        parsed.relationKinds
                      );
                      writeKnowledgeGraphMultiParam(next, "tag", parsed.tags);
                      writeKnowledgeGraphMultiParam(
                        next,
                        "owner",
                        parsed.owners
                      );
                    });
                  }}
                  resultSummary=""
                  placeholder="Type a graph search, then press Enter or the search button"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                className={`h-7 px-2 text-[10px] ${graphFloatingButtonClass}`}
                onClick={() => setAdvancedFiltersOpen((current) => !current)}
              >
                <SlidersHorizontal className="size-3" />
                Advanced
              </Button>
              {filtersActive ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className={`h-7 px-2 text-[10px] ${graphFloatingButtonClass}`}
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
                  className="pointer-events-auto mt-2 ml-auto max-w-[min(54rem,calc(100%-3.5rem))] rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 shadow-[var(--ui-shadow-floating)] backdrop-blur"
                >
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(17rem,1fr)]">
                    <div className="grid gap-3">
                      <EntityLinkMultiSelect
                        options={kindOptions}
                        selectedValues={selectedKinds}
                        onChange={(values) =>
                          setParam((next) => {
                            writeKnowledgeGraphMultiParam(
                              next,
                              "entityKind",
                              values
                            );
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
                            writeKnowledgeGraphMultiParam(
                              next,
                              "relationKind",
                              values
                            );
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
                            writeKnowledgeGraphMultiParam(next, "tag", values);
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
                            writeKnowledgeGraphMultiParam(
                              next,
                              "owner",
                              values
                            );
                          })
                        }
                        placeholder="Filter by owner"
                        emptyMessage="No owners match the current graph."
                      />
                    </div>

                    <div className="grid gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
                      <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                          <span>Max nodes shown</span>
                          <span>{maxNodes}</span>
                        </div>
                        <input
                          type="range"
                          min={MIN_KNOWLEDGE_GRAPH_MAX_NODES}
                          max={MAX_KNOWLEDGE_GRAPH_MAX_NODES}
                          step={20}
                          value={maxNodes}
                          onChange={(event) =>
                            setParam((next) => {
                              next.set("limit", event.target.value);
                            })
                          }
                          className="w-full accent-[var(--secondary)]"
                        />
                        <div className="text-xs text-[var(--ui-ink-faint)]">
                          The graph stays deterministic under the cap and focus
                          mode redistributes the visible neighborhood around the
                          selected node.
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                            Updated from
                          </div>
                          <Input
                            type="date"
                            value={formatKnowledgeGraphDateInput(updatedFrom)}
                            min={formatKnowledgeGraphDateInput(
                              graph.facets.updatedAt.min
                            )}
                            max={formatKnowledgeGraphDateInput(
                              updatedTo ?? graph.facets.updatedAt.max
                            )}
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
                          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                            Updated to
                          </div>
                          <Input
                            type="date"
                            value={formatKnowledgeGraphDateInput(updatedTo)}
                            min={formatKnowledgeGraphDateInput(
                              updatedFrom ?? graph.facets.updatedAt.min
                            )}
                            max={formatKnowledgeGraphDateInput(
                              graph.facets.updatedAt.max
                            )}
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
                          variant={
                            showHierarchyCrossLinks ? "primary" : "secondary"
                          }
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
                          {showHierarchyCrossLinks
                            ? "Hide cross-links"
                            : "Show cross-links"}
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
              <div className={`pointer-events-auto ${graphSegmentedControlClass}`}>
                <button
                  type="button"
                  className={`rounded-full px-2.5 py-1.5 text-[10px] transition ${
                    selectedView === "graph"
                      ? graphSegmentActiveClass
                      : graphSegmentInactiveClass
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
                      ? graphSegmentActiveClass
                      : graphSegmentInactiveClass
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
                    className={`pointer-events-auto size-8 p-0 ${graphFloatingButtonClass}`}
                    onClick={() => setAppearanceDialogOpen(true)}
                    title="Graph appearance settings"
                    aria-label="Open graph appearance settings"
                  >
                    <Settings2 className="size-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className={`pointer-events-auto size-8 p-0 ${graphFloatingButtonClass}`}
                    onClick={() => graphViewRef.current?.zoomIn()}
                    title="Zoom in"
                    aria-label="Zoom in"
                  >
                    <Plus className="size-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className={`pointer-events-auto size-8 p-0 ${graphFloatingButtonClass}`}
                    onClick={() => graphViewRef.current?.zoomOut()}
                    title="Zoom out"
                    aria-label="Zoom out"
                  >
                    <Minus className="size-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className={`pointer-events-auto size-8 p-0 ${graphFloatingButtonClass}`}
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
                    className={`pointer-events-auto size-8 p-0 ${graphFloatingButtonClass}`}
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
                      className={`pointer-events-auto size-8 p-0 ${graphFloatingButtonClass}`}
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
          <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3">
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
                const parsed =
                  parseKnowledgeGraphQuickFilterSelectionIds(selectedOptionIds);
                setParam((next) => {
                  writeKnowledgeGraphMultiParam(
                    next,
                    "entityKind",
                    parsed.entityKinds
                  );
                  writeKnowledgeGraphMultiParam(
                    next,
                    "relationKind",
                    parsed.relationKinds
                  );
                  writeKnowledgeGraphMultiParam(next, "tag", parsed.tags);
                  writeKnowledgeGraphMultiParam(next, "owner", parsed.owners);
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
                  writeKnowledgeGraphMultiParam(next, "entityKind", values);
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
                  writeKnowledgeGraphMultiParam(next, "relationKind", values);
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
                  writeKnowledgeGraphMultiParam(next, "tag", values);
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
                  writeKnowledgeGraphMultiParam(next, "owner", values);
                })
              }
              placeholder="Filter by owner"
              emptyMessage="No owners match the current graph."
            />
          </div>

          <div className="grid gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3">
            <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              <span>Max nodes shown</span>
              <span>{maxNodes}</span>
            </div>
            <input
              type="range"
              min={MIN_KNOWLEDGE_GRAPH_MAX_NODES}
              max={MAX_KNOWLEDGE_GRAPH_MAX_NODES}
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
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Updated from
                </div>
                <Input
                  type="date"
                  value={formatKnowledgeGraphDateInput(updatedFrom)}
                  min={formatKnowledgeGraphDateInput(
                    graph.facets.updatedAt.min
                  )}
                  max={formatKnowledgeGraphDateInput(
                    updatedTo ?? graph.facets.updatedAt.max
                  )}
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
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Updated to
                </div>
                <Input
                  type="date"
                  value={formatKnowledgeGraphDateInput(updatedTo)}
                  min={formatKnowledgeGraphDateInput(
                    updatedFrom ?? graph.facets.updatedAt.min
                  )}
                  max={formatKnowledgeGraphDateInput(
                    graph.facets.updatedAt.max
                  )}
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
              <Button
                variant="primary"
                size="sm"
                onClick={() => setMobileFiltersOpen(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      </SheetScaffold>

      <Dialog.Root
        open={appearanceDialogOpen}
        onOpenChange={setAppearanceDialogOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={graphDialogOverlayClass} />
          <Dialog.Content
            className={`${graphDialogContentClass} md:w-[min(40rem,calc(100vw-3rem))]`}
          >
            <Dialog.Title className="sr-only">
              Knowledge Graph appearance settings
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Tune the graph focus physics and appearance response.
            </Dialog.Description>

            <div className={graphDialogHeaderClass}>
              <div className="grid gap-1">
                <div className={graphDialogEyebrowClass}>
                  Graph appearance
                </div>
                <div className={graphDialogTitleClass}>
                  Tune the focus field
                </div>
                <p className={`max-w-xl ${graphDialogCopyClass}`}>
                  Shape how strongly a focused node opens its neighborhood and
                  how far that pressure diffuses through connected hops.
                </p>
              </div>
              <Dialog.Close asChild>
                <ModalCloseButton aria-label="Close graph appearance settings" />
              </Dialog.Close>
            </div>

            <div className="grid gap-4 px-5 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className={graphDialogCardClass}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className={graphDialogCardTitleClass}>
                        Focused repulsion
                      </div>
                      <div className={graphDialogCardCopyClass}>
                        Push nearby nodes apart more aggressively while the
                        focused node stays anchored.
                      </div>
                    </div>
                    <div className={graphDialogPillClass}>
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

                <div className={graphDialogCardClass}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className={graphDialogCardTitleClass}>
                        Focus diffusion
                      </div>
                      <div className={graphDialogCardCopyClass}>
                        Extend the focus field further through multi-hop
                        neighbors and lengthen the reversible transition.
                      </div>
                    </div>
                    <div className={graphDialogPillClass}>
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

                <div className={graphDialogCardClass}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className={graphDialogCardTitleClass}>
                        Spring reduction max
                      </div>
                      <div className={graphDialogCardCopyClass}>
                        Reduce edge spring constants most strongly around the
                        focused node so its local neighborhood can open more
                        freely.
                      </div>
                    </div>
                    <div className={graphDialogPillClass}>
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

                <div className={graphDialogCardClass}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className={graphDialogCardTitleClass}>
                        Spring reduction diffusion
                      </div>
                      <div className={graphDialogCardCopyClass}>
                        Spread that spring softening progressively through
                        first-hop, second-hop, and more distant neighborhoods.
                      </div>
                    </div>
                    <div className={graphDialogPillClass}>
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

                <div className={graphDialogCardClass}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className={graphDialogCardTitleClass}>
                        Edge spring strength
                      </div>
                      <div className={graphDialogCardCopyClass}>
                        Lower this to loosen graph edges globally and let
                        neighborhoods spread instead of snapping tightly inward.
                      </div>
                    </div>
                    <div className={graphDialogPillClass}>
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

                <div className={graphDialogCardClass}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className={graphDialogCardTitleClass}>
                        Gravity strength
                      </div>
                      <div className={graphDialogCardCopyClass}>
                        Reduce this to weaken the global inward pull that
                        compacts the whole graph toward the middle.
                      </div>
                    </div>
                    <div className={graphDialogPillClass}>
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

                <div className={graphDialogCardClass}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className={graphDialogCardTitleClass}>
                        Focus shell spacing
                      </div>
                      <div className={graphDialogCardCopyClass}>
                        Increase this to push focused rings farther outward and
                        visibly open the local structure.
                      </div>
                    </div>
                    <div className={graphDialogPillClass}>
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

              <div className={graphDialogNoticeClass}>
                The main cramming forces are the edge springs and the inward
                gravity pull. Lower edge spring strength or gravity strength to
                let the whole graph breathe more, then raise focus shell spacing
                and spring-reduction controls when you want a selected
                neighborhood to open dramatically.
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
            <Dialog.Overlay className={graphDialogOverlayClass} />
            <Dialog.Content
              className={`${graphDialogContentClass} md:w-[min(56rem,calc(100vw-3rem))]`}
            >
              <Dialog.Title className="sr-only">
                Knowledge Graph diagnostics
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                Inspect startup centering, drift metrics, lifecycle events, and
                periodic graph snapshots.
              </Dialog.Description>

              <div className={graphDialogHeaderClass}>
                <div className="grid gap-1">
                  <div className={graphDialogEyebrowClass}>
                    Dev diagnostics
                  </div>
                  <div className={graphDialogTitleClass}>
                    Knowledge Graph truth surface
                  </div>
                  <p className={`max-w-2xl ${graphDialogCopyClass}`}>
                    Track startup phase, origin drift, recent lifecycle logs,
                    and the bounded 5-second graph snapshots that help catch
                    centering regressions.
                  </p>
                </div>
                <Dialog.Close asChild>
                  <ModalCloseButton aria-label="Close graph diagnostics" />
                </Dialog.Close>
              </div>

              <div className="grid gap-4 px-5 py-5">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className={graphDialogMetricCardClass}>
                    <div className={graphDialogEyebrowClass}>
                      Startup phase
                    </div>
                    <div className="mt-2 text-lg font-semibold text-[var(--ui-ink-strong)]">
                      {knowledgeGraphDiagnostics.latestStatus?.startupPhase ??
                        "boot"}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
                      {knowledgeGraphDiagnostics.latestStatus
                        ?.startupInvariantSatisfied
                        ? "Origin invariant holding"
                        : "Waiting for invariant or correction"}
                    </div>
                  </div>
                  <div className={graphDialogMetricCardClass}>
                    <div className={graphDialogEyebrowClass}>
                      Camera drift
                    </div>
                    <div className="mt-2 text-lg font-semibold text-[var(--ui-ink-strong)]">
                      {knowledgeGraphDiagnostics.latestStatus
                        ? knowledgeGraphDiagnostics.latestStatus.driftMetrics.cameraDistanceFromOrigin.toFixed(
                            3
                          )
                        : "0.000"}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
                      camera{" "}
                      {knowledgeGraphDiagnostics.latestStatus
                        ? `${knowledgeGraphDiagnostics.latestStatus.camera.x.toFixed(3)}, ${knowledgeGraphDiagnostics.latestStatus.camera.y.toFixed(3)}`
                        : "0.000, 0.000"}
                    </div>
                  </div>
                  <div className={graphDialogMetricCardClass}>
                    <div className={graphDialogEyebrowClass}>
                      Graph centroid
                    </div>
                    <div className="mt-2 text-lg font-semibold text-[var(--ui-ink-strong)]">
                      {knowledgeGraphDiagnostics.latestStatus
                        ? knowledgeGraphDiagnostics.latestStatus.driftMetrics.centroidDistanceFromOrigin.toFixed(
                            3
                          )
                        : "0.000"}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
                      centroid{" "}
                      {knowledgeGraphDiagnostics.latestStatus
                        ? `${knowledgeGraphDiagnostics.latestStatus.graphCentroid.x.toFixed(3)}, ${knowledgeGraphDiagnostics.latestStatus.graphCentroid.y.toFixed(3)}`
                        : "0.000, 0.000"}
                    </div>
                  </div>
                  <div className={graphDialogMetricCardClass}>
                    <div className={graphDialogEyebrowClass}>
                      Snapshot ring
                    </div>
                    <div className="mt-2 text-lg font-semibold text-[var(--ui-ink-strong)]">
                      {knowledgeGraphDiagnostics.recentSnapshots.length}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
                      latest{" "}
                      {knowledgeGraphDiagnostics.latestStatus
                        ?.latestSnapshotAt ?? "none"}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                  <div className={graphDialogCardClass}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className={graphDialogCardTitleClass}>
                          Recent lifecycle events
                        </div>
                        <div className={graphDialogCardCopyClass}>
                          Scoped dev events from the page and graph renderer.
                        </div>
                      </div>
                      <div className={graphDialogPillClass}>
                        {knowledgeGraphDiagnostics.recentEvents.length}
                      </div>
                    </div>
                    <div className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
                      {knowledgeGraphDiagnostics.recentEvents.map((event) => (
                        <div
                          key={event.id}
                          className={graphDialogMiniCardClass}
                        >
                          <div className="flex min-w-0 items-center justify-between gap-3">
                            <div className="min-w-0 break-words text-xs font-medium text-[var(--ui-ink-strong)]">
                              {event.eventKey}
                            </div>
                            <div className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                              {event.level}
                            </div>
                          </div>
                          <div className="mt-1 break-words text-sm text-[var(--ui-ink-soft)]">
                            {event.message}
                          </div>
                          <div className="mt-1 break-words text-[11px] text-[var(--ui-ink-faint)]">
                            {event.createdAt}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={graphDialogCardClass}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className={graphDialogCardTitleClass}>
                          Snapshot summaries
                        </div>
                        <div className={graphDialogCardCopyClass}>
                          Periodic dev snapshots of node positions, camera
                          state, and drift metrics.
                        </div>
                      </div>
                    </div>
                    <div className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
                      {knowledgeGraphDiagnostics.recentSnapshots.map(
                        (snapshot) => (
                          <div
                            key={snapshot.id}
                            className={graphDialogMiniCardClass}
                          >
                            <div className="flex min-w-0 items-center justify-between gap-3">
                              <div className="min-w-0 break-words text-xs font-medium text-[var(--ui-ink-strong)]">
                                {snapshot.startupPhase}
                              </div>
                              <div className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                                {snapshot.rendererMode}
                              </div>
                            </div>
                            <div className="mt-1 break-words text-sm text-[var(--ui-ink-soft)]">
                              {snapshot.nodeCount} nodes · centroid drift{" "}
                              {snapshot.driftMetrics.centroidDistanceFromOrigin.toFixed(
                                3
                              )}{" "}
                              · camera drift{" "}
                              {snapshot.driftMetrics.cameraDistanceFromOrigin.toFixed(
                                3
                              )}
                            </div>
                            <div className="mt-1 break-words text-[11px] text-[var(--ui-ink-faint)]">
                              {snapshot.capturedAt}
                            </div>
                          </div>
                        )
                      )}
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
