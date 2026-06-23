import { useEffect, useMemo, useState } from "react";
import { ExternalLink, GitBranch, GitCommitHorizontal, GitPullRequest, Loader2, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getGitHelperOverview,
  searchGitHelperRefs
} from "@/lib/api";
import type {
  GitHelperOverview,
  GitHelperRef,
  GitHelperSearchKind,
  WorkItemGitRefType
} from "@/lib/types";

type DraftGitRef = {
  id?: string;
  workItemId?: string;
  refType: WorkItemGitRefType;
  provider: string;
  repository: string;
  refValue: string;
  url?: string | null;
  displayTitle: string;
};

function trim(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function buildDraftGitRef(
  ref: GitHelperRef,
  existingRefs: DraftGitRef[]
): DraftGitRef {
  const existingMatch =
    existingRefs.find(
      (entry) =>
        entry.refType === ref.refType &&
        entry.refValue === ref.refValue &&
        entry.repository === ref.repository
    ) ?? null;
  return {
    id:
      existingMatch?.id ??
      `draft-${ref.refType}-${ref.refValue.replace(/[^a-zA-Z0-9]+/g, "-")}`,
    workItemId: existingMatch?.workItemId ?? "",
    refType: ref.refType,
    provider: ref.provider,
    repository: ref.repository,
    refValue: ref.refValue,
    url: ref.url,
    displayTitle: ref.displayTitle
  };
}

function iconForKind(kind: GitHelperSearchKind) {
  if (kind === "branch") {
    return GitBranch;
  }
  if (kind === "pull_request") {
    return GitPullRequest;
  }
  return GitCommitHorizontal;
}

export function GitRefPicker({
  selectedRefs,
  onChange
}: {
  selectedRefs: DraftGitRef[];
  onChange: (refs: DraftGitRef[]) => void;
}) {
  const [overview, setOverview] = useState<GitHelperOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [kind, setKind] = useState<GitHelperSearchKind>("branch");
  const [query, setQuery] = useState("");
  const [repository, setRepository] = useState("");
  const [searchResults, setSearchResults] = useState<GitHelperRef[]>([]);
  const [searchWarnings, setSearchWarnings] = useState<string[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingOverview(true);
    void getGitHelperOverview()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setOverview(response.git);
        setRepository((current) =>
          current.trim().length > 0
            ? current
            : response.git.repository || current
        );
        setOverviewError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setOverviewError(
          error instanceof Error
            ? error.message
            : "Forge could not load git helper context."
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingOverview(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingSearch(true);
    void searchGitHelperRefs({
      kind,
      query,
      repository
    })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setSearchResults(response.git.refs);
        setSearchWarnings(response.git.warnings);
        setSearchError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setSearchError(
          error instanceof Error
            ? error.message
            : "Forge could not search git refs right now."
        );
        setSearchResults([]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingSearch(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind, query, repository]);

  const quickCurrentBranch = useMemo(() => {
    const branch = trim(overview?.currentBranch);
    const repo = trim(repository) || trim(overview?.repository);
    if (!branch) {
      return null;
    }
    return {
      key: `branch:${branch}`,
      refType: "branch" as const,
      provider: repo ? "github" : "git",
      repository: repo,
      refValue: branch,
      url:
        repo && branch
          ? `https://github.com/${repo}/tree/${encodeURIComponent(branch)}`
          : null,
      displayTitle: branch,
      subtitle: "Current local branch"
    };
  }, [overview?.currentBranch, overview?.repository, repository]);

  const addRef = (ref: GitHelperRef) => {
    const nextRef = buildDraftGitRef(ref, selectedRefs);
    if (
      selectedRefs.some(
        (entry) =>
          entry.refType === nextRef.refType &&
          entry.refValue === nextRef.refValue &&
          entry.repository === nextRef.repository
      )
    ) {
      return;
    }
    onChange([...selectedRefs, nextRef]);
  };

  const removeRef = (ref: DraftGitRef) => {
    onChange(selectedRefs.filter((entry) => entry.id !== ref.id));
  };

  return (
    <div className="grid gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="type-label text-white/45">Git links</div>
          <div className="mt-2 text-sm leading-6 text-white/58">
            Pick the live branch, commits, or pull requests from the local repo instead of typing raw hashes.
          </div>
        </div>
        {quickCurrentBranch ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => addRef(quickCurrentBranch)}
          >
            <GitBranch className="size-4" />
            Use current branch
          </Button>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <label className="grid gap-2">
          <span className="type-label text-white/45">Type</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as GitHelperSearchKind)}
            className="min-h-10 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.3)]"
          >
            <option value="branch">Branch</option>
            <option value="commit">Commit</option>
            <option value="pull_request">Pull request</option>
          </select>
        </label>
        <label className="grid gap-2">
          <span className="type-label text-white/45">Repository</span>
          <Input
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            placeholder={overview?.repository || "owner/repo"}
          />
        </label>
      </div>

      <label className="grid gap-2">
        <span className="type-label text-white/45">Search</span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/32" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              kind === "branch"
                ? "Search branches"
                : kind === "pull_request"
                  ? "Search pull requests"
                  : "Search commits"
            }
            className="pl-10"
          />
        </div>
      </label>

      {selectedRefs.length > 0 ? (
        <div className="grid gap-2">
          <div className="type-label text-white/45">Selected links</div>
          <div className="grid gap-2">
            {selectedRefs.map((ref) => (
              <div
                key={ref.id}
                className="flex items-start justify-between gap-3 rounded-[16px] border border-white/8 bg-white/[0.04] px-3 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-white/[0.08] text-white/72">
                      {ref.refType.replaceAll("_", " ")}
                    </Badge>
                    <div className="truncate text-sm text-white/84">
                      {ref.displayTitle || ref.refValue}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-white/46">
                    {[ref.repository, ref.refValue].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {ref.url ? (
                    <a
                      href={ref.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex size-8 items-center justify-center rounded-full text-white/55 transition hover:bg-white/[0.08] hover:text-white"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="inline-flex size-8 items-center justify-center rounded-full text-white/55 transition hover:bg-white/[0.08] hover:text-white"
                    onClick={() => removeRef(ref)}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 rounded-[16px] border border-white/8 bg-white/[0.02] p-2">
        {loadingOverview || loadingSearch ? (
          <div className="flex items-center gap-2 px-2 py-4 text-sm text-white/52">
            <Loader2 className="size-4 animate-spin" />
            Loading git suggestions…
          </div>
        ) : null}
        {overviewError ? (
          <div className="rounded-[14px] bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {overviewError}
          </div>
        ) : null}
        {searchError ? (
          <div className="rounded-[14px] bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {searchError}
          </div>
        ) : null}
        {[...(overview?.warnings ?? []), ...searchWarnings]
          .filter(Boolean)
          .slice(0, 2)
          .map((warning) => (
            <div
              key={warning}
              className="rounded-[14px] bg-amber-400/10 px-3 py-2 text-sm text-amber-100"
            >
              {warning}
            </div>
          ))}
        {!loadingSearch && !searchError && searchResults.length === 0 ? (
          <div className="px-2 py-4 text-sm text-white/45">
            No matching git refs found.
          </div>
        ) : null}
        {searchResults.map((ref) => {
          const Icon = iconForKind(kind);
          const selected = selectedRefs.some(
            (entry) =>
              entry.refType === ref.refType &&
              entry.refValue === ref.refValue &&
              entry.repository === ref.repository
          );
          return (
            <div
              key={ref.key}
              className="flex items-start justify-between gap-3 rounded-[14px] px-2 py-2 transition hover:bg-white/[0.04]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm text-white/82">
                  <Icon className="size-4 shrink-0 text-[var(--primary)]" />
                  <span className="truncate">{ref.displayTitle || ref.refValue}</span>
                </div>
                <div className="mt-1 text-xs text-white/46">
                  {[ref.repository, ref.subtitle].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {ref.url ? (
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex size-8 items-center justify-center rounded-full text-white/55 transition hover:bg-white/[0.08] hover:text-white"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={selected}
                  onClick={() => addRef(ref)}
                >
                  {selected ? "Added" : "Add"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
