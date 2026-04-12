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
  Crosshair,
  Minus,
  Plus,
  Rows3,
  ScanSearch,
  SlidersHorizontal
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { KnowledgeGraphEntityPanel } from "@/components/knowledge-graph/knowledge-graph-entity-panel";
import { KnowledgeGraphFocusDrawer } from "@/components/knowledge-graph/knowledge-graph-focus-drawer";
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
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { UserBadge } from "@/components/ui/user-badge";
import { getKnowledgeGraph } from "@/lib/api";
import {
  formatKnowledgeGraphFocusValue,
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
import { resolveKnowledgeGraphFocusInteraction } from "@/pages/knowledge-graph-page-model";
import type { UserSummary } from "@/lib/types";
import { getEntityNotesHref } from "@/lib/note-helpers";

const DEFAULT_MAX_NODES = 240;
const MIN_MAX_NODES = 40;
const MAX_MAX_NODES = 1000;

declare global {
  interface Window {
    __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean;
    __FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?: {
      isMobile: boolean;
      mobileSheetOpen: boolean;
      focusNodeId: string | null;
      selectedView: KnowledgeGraphView;
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const graphViewRef = useRef<KnowledgeGraphForceViewHandle | null>(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 1023px)").matches
      : false
  );
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);

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
    }
  }, [isMobile]);

  const selectedView: KnowledgeGraphView =
    searchParams.get("view") === "hierarchy" ? "hierarchy" : "graph";
  const focusSpec = parseKnowledgeGraphFocusValue(searchParams.get("focus"));
  const focusNodeId = focusSpec
    ? buildKnowledgeGraphFocusNodeId(focusSpec.entityType, focusSpec.entityId)
    : null;
  const selectedKinds = readMultiParam(searchParams, "entityKind") as KnowledgeGraphEntityKind[];
  const selectedRelations = readMultiParam(
    searchParams,
    "relationKind"
  ) as KnowledgeGraphRelationKind[];
  const selectedTags = readMultiParam(searchParams, "tag");
  const selectedOwners = readMultiParam(searchParams, "owner");
  const showHierarchyCrossLinks = searchParams.get("cross") === "1";
  const queryText = searchParams.get("q") ?? "";
  const updatedFrom = searchParams.get("updatedFrom");
  const updatedTo = searchParams.get("updatedTo");
  const parsedLimit = Number(searchParams.get("limit") ?? DEFAULT_MAX_NODES);
  const maxNodes = Number.isFinite(parsedLimit)
    ? Math.max(MIN_MAX_NODES, Math.min(MAX_MAX_NODES, parsedLimit))
    : DEFAULT_MAX_NODES;

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
  }, [focusNodeId, graph, setSearchParams]);

  const focusPayload = useMemo(() => {
    if (!graph || !focusNodeId) {
      return buildKnowledgeGraphFocusPayload([], [], null);
    }
    return buildKnowledgeGraphFocusPayload(graph.nodes, graph.edges, focusNodeId);
  }, [focusNodeId, graph]);

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
      selectedView
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

  const handleFocusNode = (node: KnowledgeGraphNode | null) => {
    const interaction = resolveKnowledgeGraphFocusInteraction({
      isMobile,
      currentFocusNodeId: focusNodeId,
      mobileSheetOpen: mobilePanelOpen,
      nextNodeId: node?.id ?? null
    });

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
  };

  const handleNavigateNode = (node: KnowledgeGraphNode) => {
    if (node.href) {
      navigate(node.href);
    }
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

  const kindOptions = graph.facets.entityKinds.map((entry) => ({
    value: entry.value,
    label: entry.label,
    description: `${entry.count} nodes`,
    kind: entry.value
  }));
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
    ? `${graph.counts.nodeCount} shown of ${graph.counts.filteredNodeCount} filtered nodes`
    : `${graph.counts.nodeCount} nodes · ${graph.counts.edgeCount} edges`;
  const filtersActive =
    queryText.trim().length > 0 ||
    selectedKinds.length > 0 ||
    selectedRelations.length > 0 ||
    selectedTags.length > 0 ||
    selectedOwners.length > 0 ||
    Boolean(updatedFrom) ||
    Boolean(updatedTo) ||
    maxNodes !== DEFAULT_MAX_NODES;

  const desktopDrawerVisible = !isMobile && Boolean(focusPayload.focusNode);
  const graphSurfaceResetKey = `${selectedView}:${graph.nodes
    .map((node) => node.id)
    .join("|")}::${graph.edges.map((edge) => edge.id).join("|")}`;

  return (
    <div className="-mb-2.5 -mt-3 -mx-4 min-h-[calc(100dvh-10rem)] overflow-hidden lg:-mx-6 lg:-mb-3">
      <div className="relative min-h-[calc(100dvh-10rem)] bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.08),transparent_26%),linear-gradient(180deg,rgba(7,12,23,0.98),rgba(5,10,19,1))]">
        <KnowledgeGraphRendererBoundary
          resetKey={graphSurfaceResetKey}
          fallback={(error) => (
            <div className="grid min-h-[calc(100dvh-10rem)] place-items-center p-6 text-center">
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
              onSelectNode={handleFocusNode}
            />
          ) : (
            <div className="min-h-[calc(100dvh-10rem)] px-4 py-4 lg:px-6">
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

        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-4 lg:px-6">
          <div className="pointer-events-auto flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <div className="rounded-full border border-white/10 bg-[rgba(8,12,20,0.84)] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/52 backdrop-blur">
                {summaryBadge}
              </div>
              {focusPayload.focusNode ? (
                <div className="rounded-full border border-white/10 bg-[rgba(125,211,252,0.14)] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/70 backdrop-blur">
                  Focused: {focusPayload.focusNode.title}
                </div>
              ) : null}
            </div>
            <div className="pointer-events-auto flex items-center gap-2">
              <div className="flex rounded-full border border-white/10 bg-[rgba(8,12,20,0.82)] p-0.5 shadow-[0_14px_42px_rgba(0,0,0,0.28)] backdrop-blur">
                <button
                  type="button"
                  className={`rounded-full px-2.5 py-1 text-[11px] transition ${
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
                  className={`rounded-full px-2.5 py-1 text-[11px] transition ${
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
              {filtersActive ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 rounded-full border-white/10 bg-[rgba(8,12,20,0.82)] px-2.5 text-[11px] text-white/72 backdrop-blur hover:text-white"
                  onClick={resetFilters}
                >
                  Reset
                </Button>
              ) : null}
            </div>
          </div>

          <div className="pointer-events-auto mt-3 max-w-[min(52rem,calc(100%-3.5rem))]">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <FacetedTokenSearch
                  title=""
                  description=""
                  compact
                  query={queryText}
                  onQueryChange={(value) =>
                    setParam((next) => {
                      if (value.trim().length > 0) {
                        next.set("q", value);
                      } else {
                        next.delete("q");
                      }
                    })
                  }
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
                  resultSummary={
                    graph.counts.filteredNodeCount === 0
                      ? "No nodes match the current query and facet set."
                      : graph.counts.limited
                        ? `${graph.counts.nodeCount} visible nodes from ${graph.counts.filteredNodeCount} filtered matches.`
                        : `${graph.counts.nodeCount} filtered nodes and ${graph.counts.edgeCount} visible edges.`
                  }
                  placeholder="Search titles, summaries, owners, tags, or add a quick filter chip"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-0.5 h-8 rounded-full border-white/10 bg-[rgba(8,12,20,0.82)] px-2.5 text-[11px] text-white/72 backdrop-blur hover:text-white"
                onClick={() => setAdvancedFiltersOpen((current) => !current)}
              >
                <SlidersHorizontal className="size-3" />
                Advanced
              </Button>
            </div>

            <AnimatePresence initial={false}>
              {advancedFiltersOpen ? (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="mt-3 rounded-[22px] border border-white/10 bg-[rgba(8,12,20,0.88)] p-3 shadow-[0_20px_60px_rgba(0,0,0,0.32)] backdrop-blur"
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
        </div>

        {selectedView === "graph" ? (
          <div className="pointer-events-none absolute bottom-5 right-4 z-20 flex flex-col gap-2 lg:right-6">
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
          </div>
        ) : null}

        <AnimatePresence initial={false}>
          {desktopDrawerVisible ? (
            <motion.div
              key={focusPayload.focusNode?.id ?? "drawer"}
              initial={{ opacity: 0, x: 28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 32 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="pointer-events-auto absolute bottom-6 right-4 top-24 z-20 hidden xl:block lg:right-6"
              style={{
                width: "min(30rem, calc(50% - 1.5rem))",
                maxWidth: "calc(50% - 1.5rem)"
              }}
            >
              <KnowledgeGraphFocusDrawer
                focus={focusPayload}
                onOpenPage={handleNavigateNode}
                onOpenNotes={handleOpenNotes}
                onOpenHierarchy={handleOpenHierarchy}
                onSelectNode={handleFocusNode}
                onClose={() => handleFocusNode(null)}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
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
    </div>
  );
}
