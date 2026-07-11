import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, LibraryBig } from "lucide-react";
import { Link } from "react-router-dom";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  createWikiSpace,
  getWikiHealth,
  getWikiSettings,
  reindexWiki,
  syncWikiVault
} from "@/lib/api";

const wikiActionLinkClass =
  "inline-flex min-h-11 max-w-full items-center justify-center rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm font-medium text-[var(--ui-ink-strong)] shadow-[var(--ui-shadow-soft)] transition hover:bg-[var(--ui-surface-hover)]";
const wikiPanelClass =
  "grid min-w-0 gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4";
const wikiRowClass =
  "grid min-w-0 gap-1 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4";
const wikiSelectClass =
  "min-w-0 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-3 text-sm text-[var(--ui-ink-strong)] outline-none transition focus:border-[var(--primary)]/35 focus:bg-[var(--ui-surface-3)]";
const wikiTitleClass = "text-[var(--ui-ink-strong)]";
const wikiBodyClass = "text-[var(--ui-ink-soft)]";
const wikiFaintClass = "text-[var(--ui-ink-faint)]";

export function SettingsWikiPage() {
  const queryClient = useQueryClient();
  const [spaceLabel, setSpaceLabel] = useState("");
  const [spaceDescription, setSpaceDescription] = useState("");
  const [spaceVisibility, setSpaceVisibility] = useState<"personal" | "shared">(
    "personal"
  );
  const [selectedHealthSpaceId, setSelectedHealthSpaceId] = useState("");

  const settingsQuery = useQuery({
    queryKey: ["forge-wiki-settings"],
    queryFn: getWikiSettings
  });
  const activeHealthSpaceId =
    selectedHealthSpaceId || settingsQuery.data?.settings.spaces[0]?.id || "";
  const healthQuery = useQuery({
    queryKey: ["forge-wiki-health", activeHealthSpaceId],
    queryFn: () => getWikiHealth({ spaceId: activeHealthSpaceId }),
    enabled: Boolean(activeHealthSpaceId)
  });

  useEffect(() => {
    if (!selectedHealthSpaceId && settingsQuery.data?.settings.spaces[0]?.id) {
      setSelectedHealthSpaceId(settingsQuery.data.settings.spaces[0].id);
    }
  }, [selectedHealthSpaceId, settingsQuery.data?.settings.spaces]);

  const invalidateSettings = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["forge-wiki-settings"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-wiki-pages"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-wiki-page"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-wiki-search"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-wiki-health"] })
    ]);
  };

  const createSpaceMutation = useMutation({
    mutationFn: () =>
      createWikiSpace({
        label: spaceLabel.trim(),
        description: spaceDescription.trim(),
        visibility: spaceVisibility
      }),
    onSuccess: async () => {
      setSpaceLabel("");
      setSpaceDescription("");
      setSpaceVisibility("personal");
      await invalidateSettings();
    }
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      syncWikiVault({ spaceId: activeHealthSpaceId || undefined }),
    onSuccess: invalidateSettings
  });

  const reindexMutation = useMutation({
    mutationFn: () =>
      reindexWiki({ spaceId: activeHealthSpaceId || undefined }),
    onSuccess: invalidateSettings
  });

  if (settingsQuery.isLoading) {
    return (
      <LoadingState
        eyebrow="KarpaWiki settings"
        title="Loading KarpaWiki controls"
        description="Fetching spaces and profile configuration for KarpaWiki."
      />
    );
  }

  if (settingsQuery.isError) {
    return (
      <ErrorState
        eyebrow="KarpaWiki settings"
        error={settingsQuery.error}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  const settings = settingsQuery.data?.settings;
  if (!settings) {
    return (
      <ErrorState
        eyebrow="KarpaWiki settings"
        error={new Error("Forge returned an empty KarpaWiki settings payload.")}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }
  const enabledEmbeddingProfiles = settings.embeddingProfiles.filter(
    (profile) => profile.enabled
  );

  const operatingModelTooltip =
    "Canonical knowledge lives in SQLite notes, with Forge maintaining metadata, links, search, and optional embedding indexes in the database. Text search and entity-linked search work without embeddings, while semantic search stays additive and profile-driven. Ingest jobs can create pages and media assets now, with room for richer OCR, transcription, and multimodal compilation later.";
  const health = healthQuery.data?.health;
  const operationError =
    createSpaceMutation.error ?? syncMutation.error ?? reindexMutation.error;

  return (
    <div className="mx-auto grid w-full max-w-[1440px] gap-5">
      <PageHero
        eyebrow="SQLite memory"
        title="KarpaWiki Settings"
        titleText="KarpaWiki Settings"
        description="Manage SQLite-backed spaces and refresh KarpaWiki indexes. Model, OAuth, and embedding profile setup lives in Models."
        badge={`${settings.spaces.length} spaces · ${enabledEmbeddingProfiles.length} enabled embedding profiles`}
        actions={
          <>
            <Link to="/settings/models" className={wikiActionLinkClass}>
              Open model settings
              <ArrowUpRight className="ml-2 size-4" />
            </Link>
            <Button
              variant="secondary"
              pending={syncMutation.isPending}
              pendingLabel="Syncing"
              onClick={() => void syncMutation.mutateAsync()}
            >
              Refresh indexes
            </Button>
            <Button
              pending={reindexMutation.isPending}
              pendingLabel="Reindexing"
              onClick={() => void reindexMutation.mutateAsync()}
              disabled={enabledEmbeddingProfiles.length === 0}
              title={
                enabledEmbeddingProfiles.length === 0
                  ? "Enable an embedding profile in Models before reindexing"
                  : undefined
              }
            >
              Reindex embeddings
            </Button>
          </>
        }
      />

      <SettingsSectionNav />

      <div className="grid gap-5">
        {operationError ? (
          <div
            role="alert"
            className="rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
          >
            {operationError instanceof Error
              ? operationError.message
              : "Forge could not complete the wiki maintenance action."}
          </div>
        ) : null}

        <Card className="grid gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className={`text-sm ${wikiTitleClass}`}>Index health</div>
              <div className={`mt-1 text-xs leading-5 ${wikiFaintClass}`}>
                Inspect one bounded space summary before refreshing text/link
                indexes or rebuilding embeddings.
              </div>
            </div>
            <select
              aria-label="Wiki health space"
              className={wikiSelectClass}
              value={activeHealthSpaceId}
              onChange={(event) => setSelectedHealthSpaceId(event.target.value)}
            >
              {settings.spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.label}
                </option>
              ))}
            </select>
          </div>

          {healthQuery.isLoading ? (
            <div role="status" className={`text-sm ${wikiBodyClass}`}>
              Checking wiki health...
            </div>
          ) : healthQuery.isError ? (
            <div className="grid gap-3">
              <div role="alert" className="text-sm text-[var(--danger)]">
                {healthQuery.error instanceof Error
                  ? healthQuery.error.message
                  : "Forge could not read wiki health."}
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="w-fit"
                onClick={() => void healthQuery.refetch()}
              >
                Retry health check
              </Button>
            </div>
          ) : health ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Pages", health.pageCount],
                  ["Assets", health.assetCount],
                  ["Unresolved", health.unresolvedLinks.length],
                  ["Orphans", health.orphanPages.length]
                ].map(([label, value]) => (
                  <div key={String(label)} className={wikiRowClass}>
                    <span className={`text-xs ${wikiFaintClass}`}>{label}</span>
                    <strong className={`text-xl ${wikiTitleClass}`}>
                      {value}
                    </strong>
                  </div>
                ))}
              </div>

              {health.unresolvedLinks.length > 0 ? (
                <div className={wikiPanelClass}>
                  <div className={`text-sm ${wikiTitleClass}`}>
                    Unresolved links
                  </div>
                  {health.unresolvedLinks.slice(0, 8).map((link) => (
                    <div
                      key={`${link.sourceNoteId}:${link.rawTarget}`}
                      className="min-w-0 text-xs leading-5 text-[var(--ui-ink-soft)]"
                    >
                      <strong>{link.sourceTitle}</strong>: {link.rawTarget}
                    </div>
                  ))}
                  {health.unresolvedLinks.length > 8 ? (
                    <div className={`text-xs ${wikiFaintClass}`}>
                      Showing 8 of {health.unresolvedLinks.length} unresolved
                      links.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className={`text-sm ${wikiBodyClass}`}>
                  No unresolved wiki links were reported for this space.
                </div>
              )}
            </>
          ) : null}

          {enabledEmbeddingProfiles.length === 0 ? (
            <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-xs leading-5 text-[var(--ui-ink-soft)]">
              No embedding profile is enabled. Text search, entity search, and
              link health remain available; semantic reindexing is disabled.
            </div>
          ) : null}
          {reindexMutation.isPending ? (
            <div role="status" className={`text-xs ${wikiFaintClass}`}>
              Reindex request is running. This API reports completion totals,
              not incremental progress.
            </div>
          ) : reindexMutation.data ? (
            <div role="status" className={`text-xs ${wikiBodyClass}`}>
              Indexed {reindexMutation.data.pagesIndexed} pages into{" "}
              {reindexMutation.data.chunkCount} chunks across{" "}
              {reindexMutation.data.profilesIndexed} profiles.
            </div>
          ) : null}
        </Card>

        <Card className="grid gap-4">
          <div className="flex items-center gap-3">
            <div>
              <div className={`text-sm ${wikiTitleClass}`}>
                Model configuration moved
              </div>
              <div className={`text-xs leading-5 ${wikiFaintClass}`}>
                KarpaWiki ingest uses the OpenAI Codex OAuth connection selected
                in Models. OpenAI Platform API keys and embedding profile setup
                are not configured from this page.
              </div>
            </div>
          </div>

          <Link
            to="/settings/models"
            className={`${wikiActionLinkClass} w-fit`}
          >
            Manage KarpaWiki models and embeddings
            <ArrowUpRight className="ml-2 size-4" />
          </Link>
        </Card>

        <div className="grid gap-5">
          <Card className="grid gap-4">
            <div className="flex items-center gap-3">
              <LibraryBig className="size-4 text-[var(--secondary)]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className={`text-sm ${wikiTitleClass}`}>Spaces</div>
                  <InfoTooltip
                    content={operatingModelTooltip}
                    label="Explain the wiki operating model"
                  />
                </div>
                <div className={`text-xs leading-5 ${wikiFaintClass}`}>
                  Personal and shared wiki spaces map to explicit SQLite
                  namespaces.
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              {settings.spaces.map((space) => (
                <div key={space.id} className={wikiRowClass}>
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <div
                      className={`min-w-0 break-words [overflow-wrap:anywhere] ${wikiTitleClass}`}
                    >
                      {space.label}
                    </div>
                    <div
                      className={`text-xs uppercase tracking-[0.16em] ${wikiFaintClass}`}
                    >
                      {space.visibility}
                    </div>
                  </div>
                  <div
                    className={`break-words text-xs [overflow-wrap:anywhere] ${wikiFaintClass}`}
                  >
                    {space.slug}
                  </div>
                  <div className={`text-sm ${wikiBodyClass}`}>
                    {space.description || "No description yet."}
                  </div>
                </div>
              ))}
            </div>

            <div className={wikiPanelClass}>
              <Input
                value={spaceLabel}
                onChange={(event) => setSpaceLabel(event.target.value)}
                placeholder="New space label"
              />
              <Input
                value={spaceDescription}
                onChange={(event) => setSpaceDescription(event.target.value)}
                placeholder="Description"
              />
              <select
                className={wikiSelectClass}
                value={spaceVisibility}
                onChange={(event) =>
                  setSpaceVisibility(
                    event.target.value as "personal" | "shared"
                  )
                }
              >
                <option value="personal">Personal</option>
                <option value="shared">Shared</option>
              </select>
              <Button
                pending={createSpaceMutation.isPending}
                pendingLabel="Creating"
                disabled={!spaceLabel.trim()}
                onClick={() => void createSpaceMutation.mutateAsync()}
              >
                Create space
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
