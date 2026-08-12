import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  History,
  PenSquare,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { GamificationMiniHud } from "@/components/gamification/gamification-widgets";
import { OpenInGraphButton } from "@/components/knowledge-graph/open-in-graph-button";
import { useForgeShell } from "@/components/shell/app-shell";
import { WikiArticleMarkdown } from "@/components/wiki/wiki-article-markdown";
import { WikiIngestModal } from "@/components/wiki/wiki-ingest-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import {
  EmptyState,
  ErrorState,
  LoadingState
} from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import {
  deleteWikiPage,
  getWikiHome,
  getWikiPageBySlug,
  getWikiSettings,
  getWikiTree,
  listWikiSpaces,
  searchWiki
} from "@/lib/api";
import { ForgeApiError } from "@/lib/api-error";
import { formatEntityTypeLabel, getEntityRoute } from "@/lib/note-helpers";
import { resolveForgePath } from "@/lib/runtime-paths";
import type { WikiSpace, WikiTreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";

type WikiSearchMode = "text" | "semantic" | "entity" | "hybrid";
type WikiDetail = Awaited<ReturnType<typeof getWikiHome>>;
const WIKI_SEARCH_PAGE_SIZE = 20;
const EMPTY_SELECTED_USER_IDS: string[] = [];
const WIKI_SEARCH_PARAM = "wikiSearch";
const WIKI_SEARCH_QUERY_PARAM = "wikiQuery";
const WIKI_SEARCH_MODE_PARAM = "wikiMode";
const WIKI_SEARCH_PROFILE_PARAM = "wikiProfile";

function readWikiSearchMode(value: string | null): WikiSearchMode {
  return value === "text" || value === "semantic" || value === "hybrid"
    ? value
    : "hybrid";
}

const WIKI_SEARCH_MATCH_LABELS = {
  title: "Title match",
  alias: "Alias match",
  content: "Content match",
  entity: "Linked entity",
  semantic: "Semantic match",
  recent: "Recently updated"
} as const;

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function slugifyLinkedTitle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function WikiIndexTree({
  nodes,
  activeSlug,
  spaceId,
  onNavigate,
  depth = 0
}: {
  nodes: WikiTreeNode[];
  activeSlug: string | null;
  spaceId: string;
  onNavigate?: () => void;
  depth?: number;
}) {
  return (
    <ul className={cn("grid gap-1", depth > 0 && "mt-1")}>
      {nodes.map((node) => {
        return (
          <WikiIndexTreeItem
            key={node.page.id}
            node={node}
            activeSlug={activeSlug}
            spaceId={spaceId}
            onNavigate={onNavigate}
            depth={depth}
          />
        );
      })}
    </ul>
  );
}

function nodeContainsActive(
  node: WikiTreeNode,
  activeSlug: string | null
): boolean {
  if (!activeSlug) {
    return false;
  }
  if (node.page.slug === activeSlug) {
    return true;
  }
  return node.children.some((child) => nodeContainsActive(child, activeSlug));
}

function WikiIndexTreeItem({
  node,
  activeSlug,
  spaceId,
  onNavigate,
  depth
}: {
  node: WikiTreeNode;
  activeSlug: string | null;
  spaceId: string;
  onNavigate?: () => void;
  depth: number;
}) {
  const hasChildren = node.children.length > 0;
  const active = node.page.slug === activeSlug;
  const activeInSubtree = nodeContainsActive(node, activeSlug);
  const [expanded, setExpanded] = useState<boolean>(
    hasChildren && (depth === 0 || activeInSubtree)
  );

  useEffect(() => {
    if (activeInSubtree) {
      setExpanded(true);
    }
  }, [activeInSubtree]);

  return (
    <li className="grid gap-1">
      <div className="flex items-start gap-1">
        {hasChildren ? (
          <button
            type="button"
            className={cn(
              "inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-[var(--ui-ink-faint)] transition hover:bg-[var(--ui-surface-1)] hover:text-[var(--ui-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/35"
            )}
            style={{ marginLeft: `${depth * 0.7}rem` }}
            aria-label={
              expanded
                ? `Collapse ${node.page.title}`
                : `Expand ${node.page.title}`
            }
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        ) : (
          <span
            className="size-10 shrink-0"
            style={{ marginLeft: `${depth * 0.7}rem` }}
          />
        )}
        <Link
          to={{
            pathname:
              node.page.slug === "index"
                ? "/wiki"
                : `/wiki/page/${encodeURIComponent(node.page.slug)}`,
            search: `?spaceId=${encodeURIComponent(spaceId)}`
          }}
          className={cn(
            "flex min-h-10 min-w-0 flex-1 items-center rounded-lg px-2 py-1.5 text-[12px] leading-5 transition",
            active
              ? "bg-[var(--ui-surface-2)] text-[var(--ui-ink-strong)]"
              : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-1)] hover:text-[var(--ui-ink-strong)]"
          )}
          onClick={onNavigate}
        >
          <span className="line-clamp-2">{node.page.title}</span>
        </Link>
      </div>
      {hasChildren && expanded ? (
        <WikiIndexTree
          nodes={node.children}
          activeSlug={activeSlug}
          spaceId={spaceId}
          onNavigate={onNavigate}
          depth={depth + 1}
        />
      ) : null}
    </li>
  );
}

function WikiSpacePickerDialog({
  open,
  onOpenChange,
  spaces,
  activeSpaceId,
  onSelect
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaces: WikiSpace[];
  activeSpaceId: string;
  onSelect: (spaceId: string) => void;
}) {
  const sharedSpaceId =
    spaces.find((space) => space.visibility === "shared")?.id ?? "";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 surface-overlay backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[14vh] z-50 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-popover)] p-4 shadow-[var(--ui-shadow-floating)] sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-[1.2rem] text-[var(--ui-ink-strong)]">
                Choose KarpaWiki space
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] leading-6 text-[var(--ui-ink-soft)]">
                Switch the reading space without leaving the article surface.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-2 text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
                aria-label="Close space picker"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 grid gap-2">
            {spaces.map((space) => {
              const active = space.id === activeSpaceId;
              const shared = space.id === sharedSpaceId;
              return (
                <button
                  key={space.id}
                  type="button"
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-[22px] border px-4 py-3 text-left transition",
                    active
                      ? "border-[color-mix(in_srgb,var(--primary)_26%,transparent)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                      : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
                  )}
                  onClick={() => {
                    onSelect(space.id);
                    onOpenChange(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-inherit">
                      {space.label}
                    </span>
                    <span className="mt-1 block text-[12px] leading-5 text-[var(--ui-ink-soft)]">
                      {space.description || `/${space.slug}`}
                    </span>
                    {shared ? (
                      <span className="mt-2 inline-flex rounded-full bg-[var(--ui-warning-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--warning)]">
                        Recovered pages
                      </span>
                    ) : null}
                  </span>
                  {active ? (
                    <Check className="size-4 shrink-0 text-[var(--primary)]" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function WikiPage() {
  const shell = useForgeShell();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { slug } = useParams<{ slug?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchOpen, setSearchOpen] = useState(
    () => searchParams.get(WIKI_SEARCH_PARAM) === "1"
  );
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const [ingestMenuOpen, setIngestMenuOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<WikiSearchMode>(() =>
    readWikiSearchMode(searchParams.get(WIKI_SEARCH_MODE_PARAM))
  );
  const [searchQuery, setSearchQuery] = useState(
    () => searchParams.get(WIKI_SEARCH_QUERY_PARAM) ?? ""
  );
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [mobileIndexOpen, setMobileIndexOpen] = useState(false);
  const [selectedEmbeddingProfileId, setSelectedEmbeddingProfileId] = useState(
    () => searchParams.get(WIKI_SEARCH_PROFILE_PARAM) ?? ""
  );
  const ingestMenuRef = useRef<HTMLDivElement | null>(null);
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null);

  const updateModalParams = (
    updater: (params: URLSearchParams) => void,
    replace = false
  ) => {
    const next = new URLSearchParams(searchParams);
    updater(next);
    setSearchParams(next, { replace });
  };

  const selectedSpaceId = searchParams.get("spaceId") ?? "";
  const ingestOpen = searchParams.get("ingest") === "1";
  const selectedIngestJobId = searchParams.get("ingestJobId");
  const sessionId = shell.operatorSession.id;
  const isOperatorSession = shell.operatorSession.profile === "operator";

  const settingsQuery = useQuery({
    queryKey: ["forge-wiki-settings", sessionId],
    queryFn: getWikiSettings,
    enabled: isOperatorSession
  });
  const spacesQuery = useQuery({
    queryKey: ["forge-wiki-spaces", sessionId],
    queryFn: listWikiSpaces
  });
  const operatorWikiSettings = isOperatorSession
    ? settingsQuery.data?.settings
    : undefined;

  const selectedUserIds = shell.selectedUserIds ?? EMPTY_SELECTED_USER_IDS;
  const visibleSpaces = useMemo(() => {
    const spaces = spacesQuery.data?.spaces ?? [];
    if (selectedUserIds.length === 0) {
      return spaces;
    }
    const selected = new Set(selectedUserIds);
    return spaces.filter(
      (space) =>
        space.visibility === "shared" ||
        (space.ownerUserId ? selected.has(space.ownerUserId) : false)
    );
  }, [selectedUserIds, spacesQuery.data?.spaces]);
  const defaultSpaceId = useMemo(() => {
    if (selectedUserIds.length === 1) {
      const personalSpace = visibleSpaces.find(
        (space) =>
          space.visibility === "personal" &&
          space.ownerUserId === selectedUserIds[0]
      );
      if (personalSpace) {
        return personalSpace.id;
      }
    }
    return (
      visibleSpaces.find((space) => space.visibility === "shared")?.id ??
      visibleSpaces[0]?.id ??
      ""
    );
  }, [selectedUserIds, visibleSpaces]);
  const selectedSpaceIsVisible = visibleSpaces.some(
    (space) => space.id === selectedSpaceId
  );
  const activeSpaceId =
    (selectedSpaceIsVisible ? selectedSpaceId : "") || defaultSpaceId;
  const embeddingProfiles = useMemo(
    () =>
      operatorWikiSettings?.embeddingProfiles.filter(
        (profile) => profile.enabled
      ) ?? [],
    [operatorWikiSettings?.embeddingProfiles]
  );

  useEffect(() => {
    const urlOpen = searchParams.get(WIKI_SEARCH_PARAM) === "1";
    const urlQuery = searchParams.get(WIKI_SEARCH_QUERY_PARAM) ?? "";
    const urlMode = readWikiSearchMode(
      searchParams.get(WIKI_SEARCH_MODE_PARAM)
    );
    const urlProfile = searchParams.get(WIKI_SEARCH_PROFILE_PARAM) ?? "";
    setSearchOpen((current) => (current === urlOpen ? current : urlOpen));
    setSearchQuery((current) =>
      current === urlQuery ? current : urlQuery.slice(0, 500)
    );
    setSearchMode((current) => (current === urlMode ? current : urlMode));
    setSelectedEmbeddingProfileId((current) =>
      current === urlProfile ? current : urlProfile
    );
  }, [searchParams]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set(WIKI_SEARCH_PARAM, "1");
    next.set(WIKI_SEARCH_MODE_PARAM, searchMode);
    if (searchQuery) {
      next.set(WIKI_SEARCH_QUERY_PARAM, searchQuery);
    } else {
      next.delete(WIKI_SEARCH_QUERY_PARAM);
    }
    if (
      (searchMode === "semantic" || searchMode === "hybrid") &&
      selectedEmbeddingProfileId
    ) {
      next.set(WIKI_SEARCH_PROFILE_PARAM, selectedEmbeddingProfileId);
    } else {
      next.delete(WIKI_SEARCH_PROFILE_PARAM);
    }
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [
    searchMode,
    searchOpen,
    searchParams,
    searchQuery,
    selectedEmbeddingProfileId,
    setSearchParams
  ]);

  useEffect(() => {
    if (isOperatorSession && settingsQuery.isLoading) {
      return;
    }
    if (embeddingProfiles.length === 0) {
      if (selectedEmbeddingProfileId) {
        setSelectedEmbeddingProfileId("");
      }
      if (searchMode === "semantic") {
        setSearchMode("hybrid");
      }
      return;
    }
    if (
      !embeddingProfiles.some(
        (profile) => profile.id === selectedEmbeddingProfileId
      )
    ) {
      setSelectedEmbeddingProfileId(embeddingProfiles[0]!.id);
    }
  }, [
    embeddingProfiles,
    isOperatorSession,
    searchMode,
    selectedEmbeddingProfileId,
    settingsQuery.isLoading
  ]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedSearchQuery(searchQuery.trim()),
      250
    );
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    if (!activeSpaceId || selectedSpaceId === activeSpaceId) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set("spaceId", activeSpaceId);
    if (slug && selectedSpaceId) {
      navigate(
        { pathname: "/wiki", search: `?${next.toString()}` },
        {
          replace: true
        }
      );
      return;
    }
    setSearchParams(next, { replace: true });
  }, [
    activeSpaceId,
    navigate,
    searchParams,
    selectedSpaceId,
    setSearchParams,
    slug
  ]);

  const homeQuery = useQuery({
    queryKey: ["forge-wiki-home", activeSpaceId],
    queryFn: () => getWikiHome({ spaceId: activeSpaceId || undefined }),
    enabled: Boolean(activeSpaceId) && !slug
  });

  const pageQuery = useQuery({
    queryKey: ["forge-wiki-page-by-slug", activeSpaceId, slug],
    queryFn: () =>
      getWikiPageBySlug({
        slug: slug ?? "index",
        spaceId: activeSpaceId || undefined
      }),
    enabled: Boolean(activeSpaceId) && Boolean(slug)
  });

  const treeQuery = useQuery({
    queryKey: ["forge-wiki-tree", activeSpaceId],
    queryFn: () =>
      getWikiTree({ spaceId: activeSpaceId || undefined, kind: "wiki" }),
    enabled: Boolean(activeSpaceId)
  });

  const searchResultsQuery = useInfiniteQuery({
    queryKey: [
      "forge-wiki-modal-search",
      activeSpaceId,
      searchMode,
      debouncedSearchQuery,
      selectedEmbeddingProfileId
    ],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      searchWiki(
        {
          spaceId: activeSpaceId || undefined,
          mode: searchMode,
          query: debouncedSearchQuery,
          profileId:
            searchMode === "semantic" || searchMode === "hybrid"
              ? selectedEmbeddingProfileId || undefined
              : undefined,
          limit: WIKI_SEARCH_PAGE_SIZE,
          offset: pageParam
        },
        { signal }
      ),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled:
      searchOpen && Boolean(activeSpaceId) && debouncedSearchQuery.length > 0,
    retry: false
  });

  const requestedDetail = slug
    ? (pageQuery.data ?? null)
    : (homeQuery.data ?? null);
  const detailRequestKey = `${activeSpaceId}:${slug ?? "index"}`;
  const [visibleDetail, setVisibleDetail] = useState<{
    key: string;
    detail: WikiDetail;
  } | null>(null);

  useEffect(() => {
    if (requestedDetail) {
      setVisibleDetail({ key: detailRequestKey, detail: requestedDetail });
    }
  }, [detailRequestKey, requestedDetail]);

  const contentPending =
    Boolean(activeSpaceId) &&
    (slug ? pageQuery.isFetching : homeQuery.isFetching);
  const detail =
    requestedDetail ??
    (contentPending && visibleDetail?.key === detailRequestKey
      ? visibleDetail.detail
      : null);
  const selectedPage = detail?.page ?? null;
  const activeSpace =
    visibleSpaces.find((space) => space.id === activeSpaceId) ?? null;
  const sharedSpace =
    visibleSpaces.find((space) => space.visibility === "shared") ?? null;
  const showSharedSpaceRecoveryHint =
    Boolean(sharedSpace) &&
    Boolean(activeSpace) &&
    activeSpace?.id !== sharedSpace?.id &&
    activeSpace?.visibility === "personal";
  const canDeletePage = selectedPage?.slug !== "index";
  const missingLinkedTitle =
    slug &&
    pageQuery.error instanceof ForgeApiError &&
    pageQuery.error.status === 404
      ? slug.trim()
      : null;

  useEffect(() => {
    if (!activeSpaceId || !missingLinkedTitle) {
      return;
    }

    const nextSearch = new URLSearchParams();
    nextSearch.set("spaceId", activeSpaceId);
    nextSearch.set("title", missingLinkedTitle);
    const suggestedSlug = slugifyLinkedTitle(missingLinkedTitle);
    if (suggestedSlug) {
      nextSearch.set("slug", suggestedSlug);
    }
    navigate(`/wiki/new?${nextSearch.toString()}`, {
      replace: true
    });
  }, [activeSpaceId, missingLinkedTitle, navigate]);

  const linkedEntityItems = useMemo(() => {
    const selectedEntityTitles = new Map<string, string>();
    const addEntityTitles = (
      entityType: string,
      entries: Array<{ id: string; title?: string; name?: string }> | undefined
    ) => {
      for (const entry of entries ?? []) {
        const title = entry.title?.trim() || entry.name?.trim();
        if (title) {
          selectedEntityTitles.set(`${entityType}:${entry.id}`, title);
        }
      }
    };
    addEntityTitles("goal", shell.snapshot.goals);
    addEntityTitles("project", shell.snapshot.projects);
    addEntityTitles("task", shell.snapshot.tasks);
    addEntityTitles("strategy", shell.snapshot.strategies);
    const selectedScopeTypes = new Set(["goal", "project", "task", "strategy"]);
    const seen = new Set<string>();

    return (selectedPage?.links ?? []).flatMap((link) => {
      const id = `${link.entityType}:${link.entityId}:${link.anchorKey ?? ""}`;
      if (seen.has(id)) {
        return [];
      }
      seen.add(id);
      const entityKey = `${link.entityType}:${link.entityId}`;
      const title = selectedEntityTitles.get(entityKey);
      const route = getEntityRoute(link.entityType, link.entityId);
      const selectedScopeUnavailable =
        selectedScopeTypes.has(link.entityType) && !title;
      const label = title
        ? `${formatEntityTypeLabel(link.entityType)} · ${title}`
        : `${formatEntityTypeLabel(link.entityType)} · ${link.entityId}`;
      return [
        {
          id,
          href: selectedScopeUnavailable ? null : route,
          label,
          anchorLabel: link.anchorKey?.trim() || null,
          status: selectedScopeUnavailable
            ? "unavailable"
            : route
              ? title
                ? "available"
                : "unverified"
              : "unavailable"
        }
      ];
    });
  }, [selectedPage?.links, shell.snapshot]);
  const backlinkItems = useMemo(() => {
    const bySourceId = new Map<
      string,
      {
        id: string;
        page: WikiDetail["backlinksBySourceId"][string];
        labels: Set<string>;
        rawTargets: Set<string>;
      }
    >();
    for (const edge of detail?.backlinks ?? []) {
      const existing = bySourceId.get(edge.sourceNoteId);
      if (existing) {
        if (edge.label.trim()) {
          existing.labels.add(edge.label.trim());
        }
        if (edge.rawTarget.trim()) {
          existing.rawTargets.add(edge.rawTarget.trim());
        }
        continue;
      }
      bySourceId.set(edge.sourceNoteId, {
        id: edge.sourceNoteId,
        page: detail?.backlinksBySourceId[edge.sourceNoteId] ?? null,
        labels: new Set(edge.label.trim() ? [edge.label.trim()] : []),
        rawTargets: new Set(
          edge.rawTarget.trim() ? [edge.rawTarget.trim()] : []
        )
      });
    }
    return Array.from(bySourceId.values()).map((item) => ({
      ...item,
      labels: Array.from(item.labels),
      rawTargets: Array.from(item.rawTargets)
    }));
  }, [detail?.backlinks, detail?.backlinksBySourceId]);
  const outboundPageItems = useMemo(() => {
    const backlinkSourceIds = new Set(
      (detail?.backlinks ?? []).map((edge) => edge.sourceNoteId)
    );
    const seen = new Set<string>();
    return (detail?.outboundLinks ?? []).flatMap((edge) => {
      if (edge.targetType === "entity") {
        return [];
      }
      const id = [
        edge.targetNoteId ?? "",
        edge.rawTarget,
        edge.label,
        edge.status,
        edge.isEmbed ? "embed" : "link"
      ].join(":");
      if (seen.has(id)) {
        return [];
      }
      seen.add(id);
      return [
        {
          ...edge,
          id,
          isTwoWay: Boolean(
            edge.targetPage && backlinkSourceIds.has(edge.targetPage.id)
          )
        }
      ];
    });
  }, [detail?.backlinks, detail?.outboundLinks]);
  const searchResults = useMemo(() => {
    const byPageId = new Map(
      (searchResultsQuery.data?.pages ?? [])
        .flatMap((page) => page.results)
        .map((result) => [result.page.id, result] as const)
    );
    return Array.from(byPageId.values());
  }, [searchResultsQuery.data?.pages]);
  const searchWarnings = useMemo(
    () =>
      Array.from(
        new Set(
          searchResultsQuery.data?.pages.flatMap((page) => page.warnings) ?? []
        )
      ),
    [searchResultsQuery.data?.pages]
  );

  const deletePageMutation = useMutation({
    mutationFn: async (pageId: string) => deleteWikiPage(pageId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-tree"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-home"] }),
        queryClient.invalidateQueries({
          queryKey: ["forge-wiki-page-by-slug"]
        }),
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-modal-search"] })
      ]);
      navigate(
        `/wiki${activeSpaceId ? `?spaceId=${encodeURIComponent(activeSpaceId)}` : ""}`
      );
    }
  });

  const handleSearchOpenChange = (nextOpen: boolean) => {
    setSearchOpen(nextOpen);
    if (nextOpen) {
      return;
    }
    updateModalParams((next) => {
      next.delete(WIKI_SEARCH_PARAM);
      next.delete(WIKI_SEARCH_QUERY_PARAM);
      next.delete(WIKI_SEARCH_MODE_PARAM);
      next.delete(WIKI_SEARCH_PROFILE_PARAM);
    }, true);
    window.requestAnimationFrame(() => searchTriggerRef.current?.focus());
  };

  const openIngestModal = (jobId?: string | null) => {
    updateModalParams((next) => {
      next.set("ingest", "1");
      if (jobId) {
        next.set("ingestJobId", jobId);
      } else {
        next.delete("ingestJobId");
      }
      if (activeSpaceId) {
        next.set("spaceId", activeSpaceId);
      }
    });
  };

  const closeIngestModal = () => {
    updateModalParams((next) => {
      next.delete("ingest");
      next.delete("ingestJobId");
    });
  };

  const selectIngestJob = (jobId: string | null) => {
    updateModalParams((next) => {
      next.set("ingest", "1");
      if (jobId) {
        next.set("ingestJobId", jobId);
      } else {
        next.delete("ingestJobId");
      }
      if (activeSpaceId) {
        next.set("spaceId", activeSpaceId);
      }
    });
  };

  const handleDeletePage = () => {
    if (!selectedPage || !canDeletePage || deletePageMutation.isPending) {
      return;
    }
    const confirmed = window.confirm(
      `Delete KarpaWiki page "${selectedPage.title}"? You can restore it later from the bin.`
    );
    if (!confirmed) {
      return;
    }
    void deletePageMutation.mutateAsync(selectedPage.id);
  };

  useEffect(() => {
    if (!ingestMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (ingestMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setIngestMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIngestMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [ingestMenuOpen]);

  if (
    !selectedPage &&
    (spacesQuery.isLoading ||
      (isOperatorSession && settingsQuery.isLoading) ||
      treeQuery.isLoading ||
      (!slug && homeQuery.isLoading) ||
      (slug && pageQuery.isLoading))
  ) {
    return (
      <LoadingState
        eyebrow="KarpaWiki"
        title="Loading the article"
        description="Preparing the current space, article, and KarpaWiki index."
      />
    );
  }

  if (
    !selectedPage &&
    !missingLinkedTitle &&
    (spacesQuery.isError ||
      (isOperatorSession && settingsQuery.isError) ||
      homeQuery.isError ||
      pageQuery.isError ||
      treeQuery.isError)
  ) {
    return (
      <ErrorState
        eyebrow="KarpaWiki"
        error={
          spacesQuery.error ??
          (isOperatorSession ? settingsQuery.error : null) ??
          homeQuery.error ??
          pageQuery.error ??
          treeQuery.error
        }
        onRetry={() => {
          void spacesQuery.refetch();
          if (isOperatorSession) {
            void settingsQuery.refetch();
          }
          void homeQuery.refetch();
          void pageQuery.refetch();
          void treeQuery.refetch();
        }}
      />
    );
  }

  if (!selectedPage) {
    if (missingLinkedTitle) {
      return (
        <LoadingState
          eyebrow="KarpaWiki"
          title="Opening a new page"
          description={`Creating a draft for ${missingLinkedTitle}.`}
        />
      );
    }
    return (
      <EmptyState
        eyebrow="KarpaWiki"
        title="Article not found"
        description="This page does not exist in the selected space."
      />
    );
  }

  return (
    <>
      <div className="px-3 py-4 sm:px-5 lg:px-6">
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4">
          <section className="wiki-frame px-3 py-3 sm:px-4">
            <div className="flex flex-wrap items-center gap-2">
              <EntityBadge
                kind="wiki_page"
                label="KarpaWiki page"
                compact
                gradient={false}
              />
              {activeSpace ? (
                <EntityBadge
                  kind="wiki_space"
                  label={activeSpace.label}
                  compact
                  gradient={false}
                  wrap
                  className="max-w-[20rem]"
                />
              ) : null}
              <span className="text-[11px] uppercase text-[var(--ui-ink-faint)]">
                {formatUpdatedAt(selectedPage.updatedAt)}
              </span>
              <GamificationMiniHud
                metrics={shell.snapshot.metrics}
                className="ml-auto"
              />
            </div>

            <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
              <button
                ref={searchTriggerRef}
                type="button"
                className="wiki-search-launch flex min-h-[2.9rem] w-full items-center gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 text-left text-[14px] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)] lg:flex-1"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="size-4 shrink-0 text-[var(--ui-ink-faint)]" />
                <span>Search KarpaWiki</span>
              </button>

              <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                <button
                  type="button"
                  className="wiki-space-trigger inline-flex min-h-[2.9rem] items-center gap-2 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 text-[13px] font-medium text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
                  onClick={() => setSpacePickerOpen(true)}
                >
                  <span className="text-[11px] uppercase text-[var(--ui-ink-faint)]">
                    Space
                  </span>
                  <span className="max-w-[16rem] truncate">
                    {activeSpace?.label ?? "KarpaWiki space"}
                  </span>
                  <ChevronDown className="size-3.5 text-[var(--ui-ink-faint)]" />
                </button>
                <div className="relative" ref={ingestMenuRef}>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-[2.9rem]"
                    onClick={() => setIngestMenuOpen((current) => !current)}
                  >
                    <Sparkles className="size-3.5" />
                    Ingest
                    <ChevronDown className="size-3.5" />
                  </Button>
                  {ingestMenuOpen ? (
                    <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 grid min-w-[15rem] gap-2 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-popover)] p-2 shadow-[var(--ui-shadow-floating)]">
                      <button
                        type="button"
                        className="flex items-start gap-3 rounded-[18px] px-3 py-3 text-left transition hover:bg-[var(--ui-surface-2)]"
                        onClick={() => {
                          setIngestMenuOpen(false);
                          openIngestModal();
                        }}
                      >
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-[var(--primary)]" />
                        <span>
                          <span className="block text-sm font-medium text-[var(--ui-ink-strong)]">
                            New ingest
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-[var(--ui-ink-faint)]">
                            Start a fresh import from files, URLs, or pasted
                            text.
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="flex items-start gap-3 rounded-[18px] px-3 py-3 text-left transition hover:bg-[var(--ui-surface-2)]"
                        onClick={() => {
                          setIngestMenuOpen(false);
                          navigate(
                            `/wiki/ingest-history${
                              activeSpaceId
                                ? `?spaceId=${encodeURIComponent(activeSpaceId)}`
                                : ""
                            }`
                          );
                        }}
                      >
                        <History className="mt-0.5 size-4 shrink-0 text-[var(--secondary)]" />
                        <span>
                          <span className="block text-sm font-medium text-[var(--ui-ink-strong)]">
                            History
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-[var(--ui-ink-faint)]">
                            Browse prior ingests, reopen reviews, and delete old
                            ingest records.
                          </span>
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-h-[2.9rem]"
                  onClick={() =>
                    navigate(
                      `/wiki/edit/${encodeURIComponent(selectedPage.id)}?spaceId=${encodeURIComponent(activeSpaceId)}`,
                      {
                        state: {
                          initialPage: selectedPage
                        }
                      }
                    )
                  }
                >
                  <PenSquare className="size-3.5" />
                  Edit
                </Button>
                <OpenInGraphButton
                  entityType="note"
                  entityId={selectedPage.id}
                  label="Open in graph"
                  size="sm"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className={cn(
                    "min-h-[2.9rem] border border-[color-mix(in_srgb,var(--danger)_22%,var(--ui-border-subtle)_78%)] bg-[var(--ui-danger-soft)] text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_20%,var(--ui-surface-1)_80%)]",
                    !canDeletePage && "opacity-60"
                  )}
                  onClick={handleDeletePage}
                  pending={deletePageMutation.isPending}
                  pendingLabel="Deleting"
                  disabled={!canDeletePage}
                  title={
                    canDeletePage
                      ? "Delete this KarpaWiki page"
                      : "The KarpaWiki home page cannot be deleted"
                  }
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
                <Button
                  size="sm"
                  className="min-h-[2.9rem]"
                  onClick={() =>
                    navigate(
                      `/wiki/new?spaceId=${encodeURIComponent(activeSpaceId)}`
                    )
                  }
                >
                  <Plus className="size-3.5" />
                  New page
                </Button>
              </div>
            </div>

            {showSharedSpaceRecoveryHint && sharedSpace ? (
              <div className="mt-3 flex flex-col gap-3 rounded-[22px] border border-[color-mix(in_srgb,var(--warning)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-warning-soft)] px-4 py-3 text-[13px] leading-6 text-[var(--ui-ink-medium)] sm:flex-row sm:items-center sm:justify-between">
                <span>
                  You are viewing the personal starter wiki. The recovered
                  people, story, and conversation pages are in{" "}
                  <strong>{sharedSpace.label}</strong>.
                </span>
                <button
                  type="button"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--warning)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-warning-soft)] px-4 text-[12px] font-semibold uppercase text-[var(--warning)] transition hover:bg-[color-mix(in_srgb,var(--warning)_20%,var(--ui-surface-1)_80%)]"
                  onClick={() => {
                    navigate({
                      pathname: "/wiki",
                      search: `?spaceId=${encodeURIComponent(sharedSpace.id)}`
                    });
                  }}
                >
                  Open shared memory
                </button>
              </div>
            ) : null}
          </section>

          <section className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)]">
            <aside className="wiki-frame h-fit px-2 py-3 sm:px-3 lg:sticky lg:top-[5.75rem]">
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-[11px] font-semibold uppercase text-[var(--ui-ink-faint)] lg:hidden"
                aria-expanded={mobileIndexOpen}
                aria-controls="wiki-page-index"
                onClick={() => setMobileIndexOpen((current) => !current)}
              >
                <span>Index</span>
                <ChevronDown
                  className={cn(
                    "size-4 transition-transform lg:hidden",
                    mobileIndexOpen && "rotate-180"
                  )}
                />
              </button>
              <div className="hidden px-2 pb-2 text-[11px] font-semibold uppercase text-[var(--ui-ink-faint)] lg:block">
                Index
              </div>
              <div
                id="wiki-page-index"
                className={cn("pt-1", !mobileIndexOpen && "hidden lg:block")}
              >
                {treeQuery.isError ? (
                  <div
                    className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-3 text-xs leading-5 text-[var(--ui-ink-soft)]"
                    role="alert"
                  >
                    <p>The page index could not be loaded.</p>
                    <button
                      type="button"
                      className="mt-2 font-semibold text-[var(--primary)]"
                      onClick={() => void treeQuery.refetch()}
                    >
                      Retry index
                    </button>
                  </div>
                ) : treeQuery.isLoading ? (
                  <div
                    className="px-2 py-3 text-xs text-[var(--ui-ink-faint)]"
                    role="status"
                  >
                    Loading index…
                  </div>
                ) : treeQuery.data?.tree.length ? (
                  <>
                    <WikiIndexTree
                      nodes={treeQuery.data.tree}
                      activeSlug={selectedPage.slug}
                      spaceId={activeSpaceId}
                      onNavigate={() => setMobileIndexOpen(false)}
                    />
                    {treeQuery.data.truncated ? (
                      <p className="px-2 pt-3 text-[11px] leading-5 text-[var(--ui-ink-faint)]">
                        Search to browse pages beyond the 500-page index limit.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="px-2 py-3 text-xs text-[var(--ui-ink-faint)]">
                    No indexed pages in this space.
                  </p>
                )}
              </div>
            </aside>

            <article
              aria-busy={contentPending}
              className={cn(
                "wiki-frame relative min-w-0 overflow-x-clip px-4 py-5 transition-[opacity,transform] duration-200 sm:px-6 sm:py-6",
                contentPending && "opacity-[0.985]"
              )}
            >
              {contentPending ? (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[color-mix(in_srgb,var(--primary)_70%,transparent)] opacity-90" />
              ) : null}
              <div className="wiki-reading-copy wiki-reading-flow mx-auto max-w-[76rem]">
                {deletePageMutation.isError ? (
                  <div className="mb-4 rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
                    {deletePageMutation.error instanceof Error
                      ? deletePageMutation.error.message
                      : "Forge could not delete this KarpaWiki page."}
                  </div>
                ) : null}
                <WikiArticleMarkdown
                  markdown={selectedPage.contentMarkdown}
                  spaceId={activeSpaceId}
                  linkStates={detail?.outboundLinks ?? []}
                />

                {selectedPage.summary.trim() ? (
                  <p className="mt-5 border-t border-[var(--ui-border-subtle)] pt-4 text-[13px] leading-6 text-[var(--ui-ink-soft)]">
                    {selectedPage.summary}
                  </p>
                ) : null}

                <section
                  className="mt-8 min-w-0 border-t border-[var(--ui-border-subtle)] pt-4"
                  aria-labelledby="wiki-outbound-links-heading"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div
                      id="wiki-outbound-links-heading"
                      className="text-[11px] font-semibold uppercase text-[var(--ui-ink-faint)]"
                    >
                      Links from this page
                    </div>
                    {outboundPageItems.length > 0 ? (
                      <span className="text-[11px] text-[var(--ui-ink-faint)]">
                        {outboundPageItems.length} visible connection
                        {outboundPageItems.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  {outboundPageItems.length > 0 ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {outboundPageItems.map((item) => {
                        const card = (
                          <>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="break-words text-[13px] font-semibold text-[var(--ui-ink-strong)]">
                                {item.targetPage?.title ||
                                  item.label.trim() ||
                                  item.rawTarget}
                              </span>
                              <Badge
                                size="sm"
                                tone={
                                  item.status === "available"
                                    ? "signal"
                                    : "meta"
                                }
                              >
                                {item.isSelfLink
                                  ? "This page"
                                  : item.status === "available"
                                    ? "Available"
                                    : item.status === "missing"
                                      ? "Not found"
                                      : "Unavailable"}
                              </Badge>
                            </div>
                            {item.label.trim() &&
                            item.label.trim() !== item.targetPage?.title ? (
                              <div className="mt-1 break-words text-[12px] leading-5 text-[var(--ui-ink-soft)]">
                                Shown as {item.label.trim()}
                              </div>
                            ) : null}
                            <div className="mt-1 break-all text-[11px] leading-5 text-[var(--ui-ink-faint)]">
                              {item.rawTarget}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-semibold uppercase text-[var(--ui-ink-faint)]">
                              {item.isEmbed ? <span>Embedded</span> : null}
                              {item.isTwoWay ? <span>Two-way link</span> : null}
                            </div>
                          </>
                        );
                        return item.targetPage && !item.isSelfLink ? (
                          <Link
                            key={item.id}
                            to={{
                              pathname:
                                item.targetPage.slug === "index"
                                  ? "/wiki"
                                  : `/wiki/page/${encodeURIComponent(item.targetPage.slug)}`,
                              search: `?spaceId=${encodeURIComponent(item.targetPage.spaceId)}`
                            }}
                            className="min-h-11 min-w-0 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 transition hover:bg-[var(--ui-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/35"
                          >
                            {card}
                          </Link>
                        ) : (
                          <div
                            key={item.id}
                            className="min-h-11 min-w-0 rounded-lg border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3"
                          >
                            {card}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-3 text-[12px] leading-5 text-[var(--ui-ink-faint)]">
                      This page does not link to another KarpaWiki page.
                    </p>
                  )}
                  {detail?.outboundLinksTruncated ? (
                    <p
                      className="mt-3 text-[11px] leading-5 text-[var(--ui-ink-faint)]"
                      role="status"
                    >
                      Showing the first {detail.outboundLinkLimit ?? 500} page
                      references. Additional references are omitted from this
                      bounded view.
                    </p>
                  ) : null}
                </section>

                {linkedEntityItems.length > 0 ? (
                  <section
                    className="mt-8 min-w-0 border-t border-[var(--ui-border-subtle)] pt-4"
                    aria-labelledby="wiki-forge-links-heading"
                  >
                    <div
                      id="wiki-forge-links-heading"
                      className="text-[11px] font-semibold uppercase text-[var(--ui-ink-faint)]"
                    >
                      Forge links
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {linkedEntityItems.map((item) =>
                        item.href ? (
                          <a
                            key={item.id}
                            href={resolveForgePath(item.href)}
                            className="max-w-full break-words rounded-lg bg-[var(--ui-surface-2)] px-3 py-2 text-[12px] leading-5 text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-3)] hover:text-[var(--ui-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/35"
                            data-entity-link-status={item.status}
                          >
                            {item.label}
                            {item.anchorLabel ? ` · ${item.anchorLabel}` : ""}
                            {item.status === "unverified" ? (
                              <span className="sr-only">
                                {" "}
                                (target availability is checked on open)
                              </span>
                            ) : null}
                          </a>
                        ) : (
                          <span
                            key={item.id}
                            className="max-w-full break-all rounded-lg border border-dashed border-[var(--ui-border-subtle)] px-3 py-2 text-[12px] leading-5 text-[var(--ui-ink-faint)]"
                            title="Entity unavailable in the selected scope"
                          >
                            {item.label}
                            {item.anchorLabel ? ` · ${item.anchorLabel}` : ""}
                            <span className="font-semibold">
                              {" "}
                              · Unavailable
                            </span>
                          </span>
                        )
                      )}
                    </div>
                  </section>
                ) : null}

                <section
                  className="mt-8 min-w-0 border-t border-[var(--ui-border-subtle)] pt-4"
                  aria-labelledby="wiki-backlinks-heading"
                >
                  <div
                    id="wiki-backlinks-heading"
                    className="text-[11px] font-semibold uppercase text-[var(--ui-ink-faint)]"
                  >
                    Linked here
                  </div>
                  {backlinkItems.length ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {backlinkItems.map((item) =>
                        item.page ? (
                          <Link
                            key={item.id}
                            to={{
                              pathname:
                                item.page.slug === "index"
                                  ? "/wiki"
                                  : `/wiki/page/${encodeURIComponent(item.page.slug)}`,
                              search: `?spaceId=${encodeURIComponent(item.page.spaceId)}`
                            }}
                            className="min-w-0 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 transition hover:bg-[var(--ui-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/35"
                          >
                            <div className="break-words text-[13px] font-semibold text-[var(--ui-ink-strong)]">
                              {item.page.title}
                            </div>
                            {item.page.summary ? (
                              <div className="mt-1 text-[12px] leading-5 text-[var(--ui-ink-soft)]">
                                {item.page.summary}
                              </div>
                            ) : null}
                            {item.labels.length > 0 ? (
                              <div className="mt-2 break-words text-[11px] leading-5 text-[var(--ui-ink-faint)]">
                                {item.labels.length === 1
                                  ? `Cited as ${item.labels[0]}`
                                  : `Cited as ${item.labels.join(", ")}`}
                              </div>
                            ) : null}
                          </Link>
                        ) : (
                          <div
                            key={item.id}
                            className="min-w-0 rounded-lg border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3"
                          >
                            <div className="text-[13px] font-semibold text-[var(--ui-ink-medium)]">
                              Source page unavailable
                            </div>
                            <div className="mt-1 break-all text-[12px] leading-5 text-[var(--ui-ink-faint)]">
                              {item.rawTargets.join(", ") || item.id}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-[12px] leading-5 text-[var(--ui-ink-faint)]">
                      No active pages in this space link here.
                    </p>
                  )}
                  {detail?.backlinksTruncated ? (
                    <p
                      className="mt-3 text-[11px] leading-5 text-[var(--ui-ink-faint)]"
                      role="status"
                    >
                      Showing the first {detail.backlinkLimit ?? 100} backlink
                      citations. Additional citations are omitted from this
                      bounded view.
                    </p>
                  ) : null}
                </section>
              </div>
            </article>
          </section>
        </div>
      </div>

      <Dialog.Root open={searchOpen} onOpenChange={handleSearchOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 surface-overlay backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-3 z-50 flex max-h-[calc(100dvh-1.5rem)] w-[min(54rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-col rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-popover)] p-4 shadow-[var(--ui-shadow-floating)] sm:top-[6vh] sm:max-h-[88dvh] sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="font-display text-[1.35rem] text-[var(--ui-ink-strong)]">
                  Search the wiki
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-[13px] leading-5 text-[var(--ui-ink-soft)]">
                  Search titles and content in the current KarpaWiki space. This
                  search can be reloaded or shared from the page URL.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="inline-flex size-11 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
                  aria-label="Close search"
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </div>

            <div className="mt-4 grid gap-3">
              <Input
                autoFocus
                role="searchbox"
                aria-label="Search KarpaWiki pages"
                value={searchQuery}
                maxLength={500}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search KarpaWiki pages"
                className="h-11 rounded-lg border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[14px] text-[var(--ui-ink-strong)] placeholder:text-[var(--ui-ink-faint)]"
              />

              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label="Wiki search mode"
              >
                {(
                  [
                    "text",
                    "hybrid",
                    ...(embeddingProfiles.length > 0 ? ["semantic"] : [])
                  ] as WikiSearchMode[]
                ).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={cn(
                      "min-h-11 rounded-full px-3 py-1.5 text-[12px] font-medium uppercase transition",
                      searchMode === mode
                        ? "bg-[var(--ui-surface-3)] text-[var(--ui-ink-strong)]"
                        : "bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
                    )}
                    onClick={() => setSearchMode(mode)}
                    aria-pressed={searchMode === mode}
                  >
                    {mode}
                  </button>
                ))}
                {(searchMode === "semantic" || searchMode === "hybrid") &&
                embeddingProfiles.length > 0 ? (
                  <select
                    aria-label="Embedding profile"
                    className="ml-auto min-h-11 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-1.5 text-[12px] text-[var(--ui-ink-strong)]"
                    value={selectedEmbeddingProfileId}
                    onChange={(event) =>
                      setSelectedEmbeddingProfileId(event.target.value)
                    }
                  >
                    {embeddingProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>

            <div
              className="mt-4 min-h-0 flex-1 overflow-y-auto"
              aria-live="polite"
            >
              {!searchQuery.trim() ? (
                <div className="rounded-2xl border border-dashed border-[var(--ui-border-subtle)] px-4 py-10 text-center text-[13px] leading-6 text-[var(--ui-ink-faint)]">
                  Start typing to search the current KarpaWiki space.
                </div>
              ) : searchQuery.trim() !== debouncedSearchQuery ||
                searchResultsQuery.isLoading ? (
                <LoadingState
                  eyebrow="KarpaWiki search"
                  title="Searching"
                  description="Ranking matching pages for this query."
                />
              ) : searchResultsQuery.isLoadingError ? (
                <ErrorState
                  eyebrow="KarpaWiki search"
                  error={searchResultsQuery.error}
                  onRetry={() => void searchResultsQuery.refetch()}
                />
              ) : (
                <div className="grid gap-2">
                  {searchWarnings.length > 0 ? (
                    <div
                      className="rounded-lg border border-[color-mix(in_srgb,var(--warning)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-warning-soft)] px-3 py-2 text-xs leading-5 text-[var(--ui-ink-medium)]"
                      role="status"
                    >
                      {searchWarnings.join(" ")}
                    </div>
                  ) : null}
                  {searchResults.length ? (
                    <>
                      {searchResults.map((result) => (
                        <button
                          key={result.page.id}
                          type="button"
                          className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-left transition hover:bg-[var(--ui-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/35"
                          onClick={() => {
                            setSearchOpen(false);
                            setMobileIndexOpen(false);
                            navigate({
                              pathname:
                                result.page.slug === "index"
                                  ? "/wiki"
                                  : `/wiki/page/${encodeURIComponent(result.page.slug)}`,
                              search: `?spaceId=${encodeURIComponent(result.page.spaceId)}`
                            });
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="break-words text-[14px] font-semibold text-[var(--ui-ink-strong)]">
                                {result.page.title}
                              </div>
                              {result.snippet ? (
                                <div className="mt-1 break-words text-[12px] leading-5 text-[var(--ui-ink-soft)]">
                                  {result.snippet}
                                </div>
                              ) : null}
                            </div>
                            <Badge className="shrink-0" size="sm" tone="meta">
                              {WIKI_SEARCH_MATCH_LABELS[result.matchKind]}
                            </Badge>
                          </div>
                        </button>
                      ))}
                      <div
                        className="flex flex-col items-center gap-2 py-2 text-center text-xs text-[var(--ui-ink-faint)] sm:flex-row sm:justify-center"
                        aria-live="polite"
                      >
                        <span>
                          Showing {searchResults.length} ranked matches.
                        </span>
                        {searchResultsQuery.hasNextPage &&
                        !searchResultsQuery.isFetchNextPageError ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            pending={searchResultsQuery.isFetchingNextPage}
                            pendingLabel="Loading"
                            onClick={() =>
                              void searchResultsQuery.fetchNextPage()
                            }
                          >
                            Load more matches
                          </Button>
                        ) : null}
                      </div>
                      {searchResultsQuery.isFetchNextPageError ? (
                        <div
                          className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-[var(--ui-border-subtle)] px-3 py-2 text-xs text-[var(--ui-ink-soft)]"
                          role="alert"
                        >
                          <span>More matches could not be loaded.</span>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              void searchResultsQuery.fetchNextPage()
                            }
                          >
                            Retry
                          </Button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed border-[var(--ui-border-subtle)] px-4 py-10 text-center text-[13px] leading-6 text-[var(--ui-ink-faint)]">
                      {searchMode === "semantic" && searchWarnings.length > 0
                        ? "Semantic search is unavailable for this request."
                        : "No pages matched this search."}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <WikiSpacePickerDialog
        open={spacePickerOpen}
        onOpenChange={setSpacePickerOpen}
        spaces={visibleSpaces}
        activeSpaceId={activeSpaceId}
        onSelect={(spaceId) => {
          navigate(
            {
              pathname: "/wiki",
              search: `?spaceId=${encodeURIComponent(spaceId)}`
            },
            { replace: true }
          );
        }}
      />

      <WikiIngestModal
        open={ingestOpen}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            openIngestModal(selectedIngestJobId);
            return;
          }
          closeIngestModal();
        }}
        spaces={visibleSpaces}
        llmProfiles={operatorWikiSettings?.llmProfiles ?? []}
        initialSpaceId={activeSpaceId}
        selectedJobId={selectedIngestJobId}
        onJobSelected={selectIngestJob}
        linkedEntityHints={
          selectedPage.links.map((link) => ({
            entityType: link.entityType,
            entityId: link.entityId,
            anchorKey: null
          })) ?? []
        }
      />
    </>
  );
}
