import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Sparkles, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { WikiIngestModal } from "@/components/wiki/wiki-ingest-modal";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState
} from "@/components/ui/page-state";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import {
  deleteWikiIngestJob,
  getWikiSettings,
  listWikiIngestJobs
} from "@/lib/api";
import { cn } from "@/lib/utils";

const HISTORY_TAGS = [
  { value: "all", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "review", label: "Review" },
  { value: "reviewed", label: "Reviewed" }
] as const;

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function jobMatchesTag(
  job: Awaited<ReturnType<typeof listWikiIngestJobs>>["jobs"][number],
  tag: string
) {
  if (tag === "all") {
    return true;
  }
  return job.job.status === tag || job.job.phase === tag;
}

export function WikiIngestHistoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSpaceId = searchParams.get("spaceId") || "";
  const queryText = searchParams.get("q") || "";
  const tag = searchParams.get("tag") || "all";
  const fromDate = searchParams.get("from") || "";
  const toDate = searchParams.get("to") || "";
  const ingestOpen = searchParams.get("ingest") === "1";
  const selectedJobId = searchParams.get("ingestJobId");

  const settingsQuery = useQuery({
    queryKey: ["forge-wiki-settings"],
    queryFn: getWikiSettings
  });

  const jobsQuery = useQuery({
    queryKey: ["forge-wiki-ingest-history", selectedSpaceId],
    queryFn: () =>
      listWikiIngestJobs({
        spaceId: selectedSpaceId || undefined,
        limit: 200
      }),
    enabled: settingsQuery.isSuccess
  });

  const deleteMutation = useMutation({
    mutationFn: (jobId: string) => deleteWikiIngestJob(jobId),
    onSuccess: async (_result, jobId) => {
      await queryClient.invalidateQueries({
        queryKey: ["forge-wiki-ingest-history"]
      });
      await queryClient.invalidateQueries({
        queryKey: ["forge-wiki-ingest-jobs"]
      });
      if (selectedJobId === jobId) {
        const next = new URLSearchParams(searchParams);
        next.delete("ingest");
        next.delete("ingestJobId");
        setSearchParams(next, { replace: true });
      }
    }
  });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value.trim()) {
      next.set(key, value.trim());
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  const filteredJobs = useMemo(() => {
    const jobs = jobsQuery.data?.jobs ?? [];
    const normalizedQuery = queryText.trim().toLowerCase();
    return jobs.filter((entry) => {
      if (!jobMatchesTag(entry, tag)) {
        return false;
      }
      const createdDate = entry.job.createdAt.slice(0, 10);
      if (fromDate && createdDate < fromDate) {
        return false;
      }
      if (toDate && createdDate > toDate) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack = [
        entry.job.titleHint,
        entry.job.latestMessage,
        entry.job.sourceLocator,
        entry.job.status,
        entry.job.phase,
        entry.job.mimeType
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [fromDate, jobsQuery.data?.jobs, queryText, tag, toDate]);

  const initialSpaceId =
    selectedSpaceId || settingsQuery.data?.settings.spaces[0]?.id || "";

  const openModal = (jobId?: string | null) => {
    const next = new URLSearchParams(searchParams);
    next.set("ingest", "1");
    if (jobId) {
      next.set("ingestJobId", jobId);
    } else {
      next.delete("ingestJobId");
    }
    setSearchParams(next, { replace: true });
  };

  const closeModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("ingest");
    next.delete("ingestJobId");
    setSearchParams(next, { replace: true });
  };

  if (settingsQuery.isLoading || jobsQuery.isLoading) {
    return (
      <SurfaceSkeleton
        eyebrow="KarpaWiki"
        title="Loading ingest history"
        description="Gathering prior imports, statuses, and review state."
        columns={1}
        blocks={6}
      />
    );
  }

  if (settingsQuery.isError || jobsQuery.isError) {
    return (
      <ErrorState
        eyebrow="KarpaWiki"
        error={settingsQuery.error ?? jobsQuery.error}
        onRetry={() => {
          void settingsQuery.refetch();
          void jobsQuery.refetch();
        }}
      />
    );
  }

  return (
    <>
      <div className="px-3 py-4 sm:px-5 lg:px-6">
        <div className="mx-auto grid w-full max-w-[1480px] gap-5">
          <PageHero
            title="KarpaWiki Ingest History"
            description="Search prior ingests, reopen a review, or clear ingest records without touching pages and entities that were already published."
            badge={`${filteredJobs.length} matching jobs`}
          />

          <Card className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                  History Filters
                </div>
                <div className="mt-2 text-sm text-white/58">
                  Narrow by free text, date range, space, or status tags.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    navigate(
                      `/wiki${selectedSpaceId ? `?spaceId=${encodeURIComponent(selectedSpaceId)}` : ""}`
                    )
                  }
                >
                  Back to KarpaWiki
                </Button>
                <Button onClick={() => openModal()}>
                  <Sparkles className="size-3.5" />
                  New ingest
                </Button>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
              <label className="grid gap-2">
                <span className="text-sm text-white/58">Free text</span>
                <Input
                  value={queryText}
                  onChange={(event) => setFilter("q", event.target.value)}
                  placeholder="title, source, status, failure message…"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/58">From</span>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFilter("from", event.target.value)}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/58">To</span>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(event) => setFilter("to", event.target.value)}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/58">Space</span>
                <select
                  className="h-11 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 text-sm text-white"
                  value={selectedSpaceId}
                  onChange={(event) => setFilter("spaceId", event.target.value)}
                >
                  <option value="">All spaces</option>
                  {(settingsQuery.data?.settings.spaces ?? []).map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              {HISTORY_TAGS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  className={cn(
                    "rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition",
                    tag === entry.value
                      ? "bg-[var(--primary)]/[0.18] text-[var(--primary)]"
                      : "bg-white/[0.04] text-white/58 hover:bg-white/[0.08] hover:text-white"
                  )}
                  onClick={() => setFilter("tag", entry.value === "all" ? "" : entry.value)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </Card>

          {filteredJobs.length === 0 ? (
            <EmptyState
              eyebrow="KarpaWiki ingest"
              title="No ingest jobs match these filters"
              description="Try widening the dates or clearing a status tag."
            />
          ) : (
            <div className="grid gap-3">
              {filteredJobs.map((entry) => {
                const title =
                  entry.job.titleHint ||
                  entry.job.latestMessage ||
                  entry.job.sourceLocator ||
                  "KarpaWiki ingest";
                const deletable = !["queued", "processing"].includes(
                  entry.job.status
                );
                return (
                  <Card key={entry.job.id} className="grid gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => openModal(entry.job.id)}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                            KarpaWiki ingest
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/60">
                            {entry.job.status}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/44">
                            {entry.job.phase}
                          </span>
                        </div>
                        <div className="mt-3 text-lg font-semibold text-white">
                          {title}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/56">
                          <span>
                            {entry.job.progressPercent}% · {entry.job.createdPageCount} pages ·{" "}
                            {entry.job.createdEntityCount} entities
                          </span>
                          <span>{formatTimestamp(entry.job.createdAt)}</span>
                          {entry.job.sourceLocator ? (
                            <span className="truncate">
                              {entry.job.sourceLocator}
                            </span>
                          ) : null}
                        </div>
                      </button>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openModal(entry.job.id)}
                        >
                          Open review
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!deletable || deleteMutation.isPending}
                          pending={
                            deleteMutation.isPending &&
                            deleteMutation.variables === entry.job.id
                          }
                          pendingLabel="Deleting"
                          onClick={() => {
                            if (!deletable) {
                              return;
                            }
                            const confirmed = window.confirm(
                              "Delete this ingest history entry? Published pages and entities will stay, but discarded or unreviewed ingest artifacts will be removed."
                            );
                            if (!confirmed) {
                              return;
                            }
                            void deleteMutation.mutateAsync(entry.job.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </Button>
                      </div>
                    </div>

                    {entry.job.errorMessage ? (
                      <div className="rounded-[18px] border border-rose-400/18 bg-rose-500/[0.08] px-4 py-3 text-sm text-rose-100/86">
                        {entry.job.errorMessage}
                      </div>
                    ) : null}

                    {["queued", "processing"].includes(entry.job.status) ? (
                      <div className="inline-flex items-center gap-2 text-sm text-white/50">
                        <LoaderCircle className="size-4 animate-spin" />
                        This ingest is still active and cannot be deleted yet.
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <WikiIngestModal
        open={ingestOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeModal();
          }
        }}
        spaces={settingsQuery.data?.settings.spaces ?? []}
        llmProfiles={settingsQuery.data?.settings.llmProfiles ?? []}
        initialSpaceId={initialSpaceId}
        selectedJobId={selectedJobId}
        onJobSelected={(jobId) => openModal(jobId)}
      />
    </>
  );
}
