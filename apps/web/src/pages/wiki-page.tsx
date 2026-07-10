import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  searchWiki
} from "@/lib/api";
import { ForgeApiError } from "@/lib/api-error";
import { getEntityRoute } from "@/lib/note-helpers";
import { resolveForgePath } from "@/lib/runtime-paths";
import type { WikiSpace, WikiTreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";

type WikiSearchMode = "text" | "semantic" | "entity" | "hybrid";
type WikiDetail = Awaited<ReturnType<typeof getWikiHome>>;

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
  depth = 0
}: {
  nodes: WikiTreeNode[];
  activeSlug: string | null;
  spaceId: string;
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
  depth
}: {
  node: WikiTreeNode;
  activeSlug: string | null;
  spaceId: string;
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
              "mt-1 inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[var(--ui-ink-faint)] transition hover:bg-[var(--ui-surface-1)] hover:text-[var(--ui-ink-strong)]",
              depth > 0 && "size-4"
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
            className="mt-1 size-5 shrink-0"
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
            "min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[12px] leading-5 transition",
            active
              ? "bg-[var(--ui-surface-2)] text-[var(--ui-ink-strong)]"
              : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-1)] hover:text-[var(--ui-ink-strong)]"
          )}
        >
          <span className="line-clamp-2">{node.page.title}</span>
        </Link>
      </div>
      {hasChildren && expanded ? (
        <WikiIndexTree
          nodes={node.children}
          activeSlug={activeSlug}
          spaceId={spaceId}
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
              <Dialog.Title className="font-display text-[1.2rem] tracking-[-0.04em] text-[var(--ui-ink-strong)]">
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
                      <span className="mt-2 inline-flex rounded-full bg-amber-200/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-950">
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const [ingestMenuOpen, setIngestMenuOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<WikiSearchMode>("hybrid");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmbeddingProfileId, setSelectedEmbeddingProfileId] =
    useState("");
  const ingestMenuRef = useRef<HTMLDivElement | null>(null);

  const selectedSpaceId = searchParams.get("spaceId") ?? "";
  const ingestOpen = searchParams.get("ingest") === "1";
  const selectedIngestJobId = searchParams.get("ingestJobId");

  const settingsQuery = useQuery({
    queryKey: ["forge-wiki-settings"],
    queryFn: getWikiSettings
  });

  const activeSpaceId =
    selectedSpaceId || settingsQuery.data?.settings.spaces[0]?.id || "";
  const embeddingProfiles = useMemo(
    () =>
      settingsQuery.data?.settings.embeddingProfiles.filter(
        (profile) => profile.enabled
      ) ?? [],
    [settingsQuery.data?.settings.embeddingProfiles]
  );

  useEffect(() => {
    if (!selectedEmbeddingProfileId && embeddingProfiles[0]?.id) {
      setSelectedEmbeddingProfileId(embeddingProfiles[0].id);
    }
  }, [embeddingProfiles, selectedEmbeddingProfileId]);

  useEffect(() => {
    if (!selectedSpaceId && settingsQuery.data?.settings.spaces[0]?.id) {
      const next = new URLSearchParams(searchParams);
      next.set("spaceId", settingsQuery.data.settings.spaces[0].id);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, selectedSpaceId, setSearchParams, settingsQuery.data]);

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

  const searchResultsQuery = useQuery({
    queryKey: [
      "forge-wiki-modal-search",
      activeSpaceId,
      searchMode,
      searchQuery,
      selectedEmbeddingProfileId
    ],
    queryFn: () =>
      searchWiki({
        spaceId: activeSpaceId || undefined,
        mode: searchMode,
        query: searchQuery.trim(),
        profileId:
          searchMode === "semantic" || searchMode === "hybrid"
            ? selectedEmbeddingProfileId || undefined
            : undefined,
        limit: 30
      }),
    enabled:
      searchOpen && Boolean(activeSpaceId) && searchQuery.trim().length > 0
  });

  const requestedDetail = slug
    ? (pageQuery.data ?? null)
    : (homeQuery.data ?? null);
  const [visibleDetail, setVisibleDetail] = useState<WikiDetail | null>(null);

  useEffect(() => {
    if (requestedDetail) {
      setVisibleDetail(requestedDetail);
    }
  }, [requestedDetail]);

  const contentPending =
    Boolean(activeSpaceId) &&
    (slug ? pageQuery.isFetching : homeQuery.isFetching);
  const detail = requestedDetail ?? (contentPending ? visibleDetail : null);
  const selectedPage = detail?.page ?? null;
  const activeSpace =
    settingsQuery.data?.settings.spaces.find(
      (space) => space.id === activeSpaceId
    ) ?? null;
  const sharedSpace =
    settingsQuery.data?.settings.spaces.find(
      (space) => space.visibility === "shared"
    ) ?? null;
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

  const linkedEntityItems = useMemo(
    () =>
      (selectedPage?.links ?? []).map((link) => ({
        id: `${link.entityType}:${link.entityId}`,
        href: getEntityRoute(link.entityType, link.entityId),
        label: `${link.entityType} · ${link.entityId}`
      })),
    [selectedPage?.links]
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

  const updateModalParams = (
    updater: (params: URLSearchParams) => void,
    replace = false
  ) => {
    const next = new URLSearchParams(searchParams);
    updater(next);
    setSearchParams(next, { replace });
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
    (settingsQuery.isLoading ||
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
    (settingsQuery.isError ||
      homeQuery.isError ||
      pageQuery.isError ||
      treeQuery.isError)
  ) {
    return (
      <ErrorState
        eyebrow="KarpaWiki"
        error={
          settingsQuery.error ??
          homeQuery.error ??
          pageQuery.error ??
          treeQuery.error
        }
        onRetry={() => {
          void settingsQuery.refetch();
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
              <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                {formatUpdatedAt(selectedPage.updatedAt)}
              </span>
              <GamificationMiniHud
                metrics={shell.snapshot.metrics}
                className="ml-auto"
              />
            </div>

            <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
              <button
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
                  <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
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
                    "min-h-[2.9rem] border border-rose-400/18 bg-rose-500/10 text-rose-100 hover:bg-rose-500/18",
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
              <div className="mt-3 flex flex-col gap-3 rounded-[22px] border border-amber-300/20 bg-amber-300/[0.08] px-4 py-3 text-[13px] leading-6 text-amber-50 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  You are viewing the personal starter wiki. The recovered
                  people, story, and conversation pages are in{" "}
                  <strong>{sharedSpace.label}</strong>.
                </span>
                <button
                  type="button"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-2xl bg-amber-200 px-4 text-[12px] font-semibold uppercase tracking-[0.14em] text-stone-950 transition hover:bg-amber-100"
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
              <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Index
              </div>
              <WikiIndexTree
                nodes={treeQuery.data?.tree ?? []}
                activeSlug={selectedPage.slug}
                spaceId={activeSpaceId}
              />
            </aside>

            <article
              aria-busy={contentPending}
              className={cn(
                "wiki-frame relative overflow-hidden px-4 py-5 transition-[opacity,transform] duration-200 sm:px-6 sm:py-6",
                contentPending && "opacity-[0.985]"
              )}
            >
              {contentPending ? (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[color-mix(in_srgb,var(--primary)_70%,transparent)] opacity-90" />
              ) : null}
              <div className="wiki-reading-copy wiki-reading-flow mx-auto max-w-[76rem]">
                {deletePageMutation.isError ? (
                  <div className="mb-4 rounded-[18px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                    {deletePageMutation.error instanceof Error
                      ? deletePageMutation.error.message
                      : "Forge could not delete this KarpaWiki page."}
                  </div>
                ) : null}
                <WikiArticleMarkdown
                  markdown={selectedPage.contentMarkdown}
                  spaceId={activeSpaceId}
                />

                {selectedPage.summary.trim() ? (
                  <p className="mt-5 border-t border-[var(--ui-border-subtle)] pt-4 text-[13px] leading-6 text-[var(--ui-ink-soft)]">
                    {selectedPage.summary}
                  </p>
                ) : null}

                {linkedEntityItems.length > 0 ? (
                  <section className="mt-8 border-t border-[var(--ui-border-subtle)] pt-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      Forge links
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {linkedEntityItems.map((item) => (
                        <a
                          key={item.id}
                          href={
                            item.href ? resolveForgePath(item.href) : undefined
                          }
                          className="rounded-full bg-[var(--ui-surface-2)] px-3 py-1.5 text-[12px] text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-3)] hover:text-[var(--ui-ink-strong)]"
                        >
                          {item.label}
                        </a>
                      ))}
                    </div>
                  </section>
                ) : null}

                {detail?.backlinkSourceNotes.length ? (
                  <section className="mt-8 border-t border-[var(--ui-border-subtle)] pt-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      Linked here
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {detail.backlinkSourceNotes.map((page) => (
                        <Link
                          key={page.id}
                          to={{
                            pathname:
                              page.slug === "index"
                                ? "/wiki"
                                : `/wiki/page/${encodeURIComponent(page.slug)}`,
                            search: `?spaceId=${encodeURIComponent(page.spaceId)}`
                          }}
                          className="rounded-xl border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 transition hover:bg-[var(--ui-surface-2)]"
                        >
                          <div className="text-[13px] font-semibold text-[var(--ui-ink-strong)]">
                            {page.title}
                          </div>
                          {page.summary ? (
                            <div className="mt-1 text-[12px] leading-5 text-[var(--ui-ink-soft)]">
                              {page.summary}
                            </div>
                          ) : null}
                        </Link>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </article>
          </section>
        </div>
      </div>

      <Dialog.Root open={searchOpen} onOpenChange={setSearchOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 surface-overlay backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-[8vh] z-50 w-[min(54rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-popover)] p-4 shadow-[var(--ui-shadow-floating)] sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="font-display text-[1.35rem] tracking-[-0.04em] text-[var(--ui-ink-strong)]">
                  Search the wiki
                </Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-2 text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
                  aria-label="Close search"
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </div>

            <div className="mt-4 grid gap-3">
              <Input
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search KarpaWiki pages"
                className="h-11 rounded-2xl border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[14px] text-[var(--ui-ink-strong)] placeholder:text-[var(--ui-ink-faint)]"
              />

              <div className="flex flex-wrap items-center gap-2">
                {(
                  ["text", "hybrid", "semantic", "entity"] as WikiSearchMode[]
                ).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[12px] font-medium uppercase tracking-[0.14em] transition",
                      searchMode === mode
                        ? "bg-[var(--ui-surface-3)] text-[var(--ui-ink-strong)]"
                        : "bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
                    )}
                    onClick={() => setSearchMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
                {(searchMode === "semantic" || searchMode === "hybrid") &&
                embeddingProfiles.length > 0 ? (
                  <select
                    className="ml-auto rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-1.5 text-[12px] text-[var(--ui-ink-strong)]"
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

            <div className="mt-4 max-h-[60vh] overflow-y-auto">
              {!searchQuery.trim() ? (
                <div className="rounded-2xl border border-dashed border-[var(--ui-border-subtle)] px-4 py-10 text-center text-[13px] leading-6 text-[var(--ui-ink-faint)]">
                  Start typing to search the current KarpaWiki space.
                </div>
              ) : searchResultsQuery.isLoading ? (
                <LoadingState
                  eyebrow="KarpaWiki search"
                  title="Searching"
                  description="Ranking matching pages for this query."
                />
              ) : searchResultsQuery.isError ? (
                <ErrorState
                  eyebrow="KarpaWiki search"
                  error={searchResultsQuery.error}
                  onRetry={() => void searchResultsQuery.refetch()}
                />
              ) : searchResultsQuery.data?.results.length ? (
                <div className="grid gap-2">
                  {searchResultsQuery.data.results.map((result) => (
                    <button
                      key={result.page.id}
                      type="button"
                      className="rounded-2xl border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-left transition hover:bg-[var(--ui-surface-2)]"
                      onClick={() => {
                        setSearchOpen(false);
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
                        <div className="min-w-0">
                          <div className="text-[14px] font-semibold text-[var(--ui-ink-strong)]">
                            {result.page.title}
                          </div>
                          {result.page.summary ? (
                            <div className="mt-1 text-[12px] leading-5 text-[var(--ui-ink-soft)]">
                              {result.page.summary}
                            </div>
                          ) : null}
                        </div>
                        <Badge size="sm" tone="meta">
                          {result.score.toFixed(2)}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--ui-border-subtle)] px-4 py-10 text-center text-[13px] leading-6 text-[var(--ui-ink-faint)]">
                  No pages matched this search.
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <WikiSpacePickerDialog
        open={spacePickerOpen}
        onOpenChange={setSpacePickerOpen}
        spaces={settingsQuery.data?.settings.spaces ?? []}
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
        spaces={settingsQuery.data?.settings.spaces ?? []}
        llmProfiles={settingsQuery.data?.settings.llmProfiles ?? []}
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
