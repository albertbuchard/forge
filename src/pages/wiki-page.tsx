import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  LoaderCircle,
  PenSquare,
  Plus,
  Search,
  Sparkles,
  X
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { WikiArticleMarkdown } from "@/components/wiki/wiki-article-markdown";
import { WikiIngestModal } from "@/components/wiki/wiki-ingest-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  LoadingState
} from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import {
  getWikiHome,
  getWikiPageBySlug,
  getWikiSettings,
  getWikiTree,
  listWikiIngestJobs,
  searchWiki
} from "@/lib/api";
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
        const active = node.page.slug === activeSlug;
        return (
          <li key={node.page.id} className="grid gap-1">
            <Link
              to={{
                pathname:
                  node.page.slug === "index"
                    ? "/wiki"
                    : `/wiki/page/${encodeURIComponent(node.page.slug)}`,
                search: `?spaceId=${encodeURIComponent(spaceId)}`
              }}
              className={cn(
                "rounded-lg px-2 py-1.5 text-[12px] leading-5 transition",
                active
                  ? "bg-white/[0.08] text-white"
                  : "text-white/64 hover:bg-white/[0.04] hover:text-white"
              )}
              style={{ paddingLeft: `${0.5 + depth * 0.7}rem` }}
            >
              {node.page.title}
            </Link>
            {node.children.length > 0 ? (
              <WikiIndexTree
                nodes={node.children}
                activeSlug={activeSlug}
                spaceId={spaceId}
                depth={depth + 1}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.72)] backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[14vh] z-50 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-[28px] border border-white/10 bg-[rgba(10,15,28,0.97)] p-4 shadow-[0_32px_90px_rgba(0,0,0,0.45)] sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-[1.2rem] tracking-[-0.04em] text-white">
                Choose wiki space
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] leading-6 text-white/56">
                Switch the reading space without leaving the article surface.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/64 transition hover:bg-white/[0.08] hover:text-white"
                aria-label="Close space picker"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 grid gap-2">
            {spaces.map((space) => {
              const active = space.id === activeSpaceId;
              return (
                <button
                  key={space.id}
                  type="button"
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-[22px] border px-4 py-3 text-left transition",
                    active
                      ? "border-[rgba(192,193,255,0.22)] bg-[rgba(192,193,255,0.12)] text-white"
                      : "border-white/8 bg-white/[0.03] text-white/78 hover:bg-white/[0.06] hover:text-white"
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
                    <span className="mt-1 block text-[12px] leading-5 text-white/52">
                      {space.description || `/${space.slug}`}
                    </span>
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
  const navigate = useNavigate();
  const { slug } = useParams<{ slug?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchOpen, setSearchOpen] = useState(false);
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<WikiSearchMode>("hybrid");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmbeddingProfileId, setSelectedEmbeddingProfileId] =
    useState("");

  const selectedSpaceId = searchParams.get("spaceId") ?? "";
  const ingestOpen = searchParams.get("ingest") === "1";
  const selectedIngestJobId = searchParams.get("ingestJobId");

  const settingsQuery = useQuery({
    queryKey: ["forge-wiki-settings"],
    queryFn: getWikiSettings
  });

  const activeSpaceId =
    selectedSpaceId || settingsQuery.data?.settings.spaces[0]?.id || "";
  const embeddingProfiles =
    settingsQuery.data?.settings.embeddingProfiles.filter(
      (profile) => profile.enabled
    ) ?? [];

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

  const ingestJobsQuery = useQuery({
    queryKey: ["forge-wiki-ingest-jobs", activeSpaceId],
    queryFn: () =>
      listWikiIngestJobs({ spaceId: activeSpaceId || undefined, limit: 8 }),
    enabled: Boolean(activeSpaceId),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      return jobs.some((job) =>
        ["queued", "processing"].includes(job.job.status)
      )
        ? 2000
        : false;
    }
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

  const linkedEntityItems = useMemo(
    () =>
      (selectedPage?.links ?? []).map((link) => ({
        id: `${link.entityType}:${link.entityId}`,
        href: getEntityRoute(link.entityType, link.entityId),
        label: `${link.entityType} · ${link.entityId}`
      })),
    [selectedPage?.links]
  );

  const recentIngestJobs = ingestJobsQuery.data?.jobs ?? [];

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
    });
  };

  if (
    !selectedPage &&
    (settingsQuery.isLoading ||
      treeQuery.isLoading ||
      (!slug && homeQuery.isLoading) ||
      (slug && pageQuery.isLoading))
  ) {
    return (
      <LoadingState
        eyebrow="Wiki"
        title="Loading the article"
        description="Preparing the current space, article, and wiki index."
      />
    );
  }

  if (
    !selectedPage &&
    (settingsQuery.isError ||
      homeQuery.isError ||
      pageQuery.isError ||
      treeQuery.isError)
  ) {
    return (
      <ErrorState
        eyebrow="Wiki"
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
    return (
      <EmptyState
        eyebrow="Wiki"
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
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-white/42">
              <span>Wiki</span>
              {activeSpace ? <span>{activeSpace.label}</span> : null}
              <span>{formatUpdatedAt(selectedPage.updatedAt)}</span>
            </div>

            <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
              <button
                type="button"
                className="wiki-search-launch flex min-h-[2.9rem] w-full items-center gap-3 rounded-[18px] border border-white/8 bg-white/[0.04] px-4 text-left text-[14px] text-white/56 transition hover:bg-white/[0.06] hover:text-white lg:flex-1"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="size-4 shrink-0 text-white/44" />
                <span>Search this wiki</span>
              </button>

              <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                <button
                  type="button"
                  className="wiki-space-trigger inline-flex min-h-[2.9rem] items-center gap-2 rounded-[18px] border border-white/8 bg-white/[0.04] px-4 text-[13px] font-medium text-white/78 transition hover:bg-white/[0.07] hover:text-white"
                  onClick={() => setSpacePickerOpen(true)}
                >
                  <span className="max-w-[16rem] truncate">
                    {activeSpace?.label ?? "Wiki space"}
                  </span>
                </button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-h-[2.9rem]"
                  onClick={() => openIngestModal()}
                >
                  <Sparkles className="size-3.5" />
                  Ingest
                </Button>
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

            {recentIngestJobs.length > 0 ? (
              <div className="mt-4 grid gap-2 lg:grid-cols-3">
                {recentIngestJobs.slice(0, 3).map((job) => {
                  const jobActive = ["queued", "processing"].includes(
                    job.job.status
                  );
                  return (
                    <button
                      key={job.job.id}
                      type="button"
                      className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.07]"
                      onClick={() => openIngestModal(job.job.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                            Wiki ingest
                          </div>
                          <div className="mt-2 truncate text-[14px] font-semibold text-white">
                            {job.job.titleHint ||
                              job.job.latestMessage ||
                              "Background ingest"}
                          </div>
                          <div className="mt-1 text-[12px] leading-5 text-white/54">
                            {job.job.status} · {job.job.progressPercent}% ·{" "}
                            {job.job.createdPageCount} pages ·{" "}
                            {job.job.createdEntityCount} entities
                          </div>
                        </div>
                        {jobActive ? (
                          <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-[var(--secondary)]" />
                        ) : (
                          <Badge size="sm" tone="meta">
                            {job.job.phase}
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>

          <section className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)]">
            <aside className="wiki-frame h-fit px-2 py-3 sm:px-3 lg:sticky lg:top-[5.75rem]">
              <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/42">
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
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(192,193,255,0.8),transparent)] opacity-90" />
              ) : null}
              <div className="wiki-reading-copy wiki-reading-flow mx-auto max-w-[76rem]">
                <WikiArticleMarkdown
                  markdown={selectedPage.contentMarkdown}
                  spaceId={activeSpaceId}
                />

                {selectedPage.summary.trim() ? (
                  <p className="mt-5 border-t border-white/8 pt-4 text-[13px] leading-6 text-white/56">
                    {selectedPage.summary}
                  </p>
                ) : null}

                {linkedEntityItems.length > 0 ? (
                  <section className="mt-8 border-t border-white/8 pt-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/42">
                      Forge links
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {linkedEntityItems.map((item) => (
                        <a
                          key={item.id}
                          href={
                            item.href ? resolveForgePath(item.href) : undefined
                          }
                          className="rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] text-white/76 transition hover:bg-white/[0.1] hover:text-white"
                        >
                          {item.label}
                        </a>
                      ))}
                    </div>
                  </section>
                ) : null}

                {detail?.backlinkSourceNotes.length ? (
                  <section className="mt-8 border-t border-white/8 pt-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/42">
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
                          className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 transition hover:bg-white/[0.06]"
                        >
                          <div className="text-[13px] font-semibold text-white">
                            {page.title}
                          </div>
                          {page.summary ? (
                            <div className="mt-1 text-[12px] leading-5 text-white/56">
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
          <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.8)] backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-[8vh] z-50 w-[min(54rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-[28px] border border-white/10 bg-[rgba(10,15,28,0.96)] p-4 shadow-[0_30px_90px_rgba(0,0,0,0.45)] sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="font-display text-[1.35rem] tracking-[-0.04em] text-white">
                  Search the wiki
                </Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/64 transition hover:bg-white/[0.08] hover:text-white"
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
                placeholder="Search wiki pages"
                className="h-11 rounded-2xl border-white/10 bg-white/[0.04] text-[14px] text-white placeholder:text-white/28"
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
                        ? "bg-white/[0.12] text-white"
                        : "bg-white/[0.04] text-white/54 hover:bg-white/[0.08] hover:text-white"
                    )}
                    onClick={() => setSearchMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
                {(searchMode === "semantic" || searchMode === "hybrid") &&
                embeddingProfiles.length > 0 ? (
                  <select
                    className="ml-auto rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] text-white"
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
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-[13px] leading-6 text-white/42">
                  Start typing to search the current wiki space.
                </div>
              ) : searchResultsQuery.isLoading ? (
                <LoadingState
                  eyebrow="Wiki search"
                  title="Searching"
                  description="Ranking matching pages for this query."
                />
              ) : searchResultsQuery.isError ? (
                <ErrorState
                  eyebrow="Wiki search"
                  error={searchResultsQuery.error}
                  onRetry={() => void searchResultsQuery.refetch()}
                />
              ) : searchResultsQuery.data?.results.length ? (
                <div className="grid gap-2">
                  {searchResultsQuery.data.results.map((result) => (
                    <button
                      key={result.page.id}
                      type="button"
                      className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-left transition hover:bg-white/[0.06]"
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
                          <div className="text-[14px] font-semibold text-white">
                            {result.page.title}
                          </div>
                          {result.page.summary ? (
                            <div className="mt-1 text-[12px] leading-5 text-white/56">
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
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-[13px] leading-6 text-white/42">
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
          const next = new URLSearchParams(searchParams);
          next.set("spaceId", spaceId);
          setSearchParams(next, { replace: true });
          navigate("/wiki", { replace: true });
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
