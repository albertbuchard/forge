import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  DatabaseZap,
  LibraryBig,
  Trash2
} from "lucide-react";
import { Link } from "react-router-dom";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  createWikiEmbeddingProfile,
  createWikiSpace,
  deleteWikiProfile,
  getSettings,
  getWikiSettings,
  reindexWiki,
  syncWikiVault
} from "@/lib/api";
import { summarizeWikiLlmProfile } from "@/lib/wiki-llm";

export function SettingsWikiPage() {
  const queryClient = useQueryClient();
  const [spaceLabel, setSpaceLabel] = useState("");
  const [spaceDescription, setSpaceDescription] = useState("");
  const [spaceVisibility, setSpaceVisibility] = useState<"personal" | "shared">(
    "personal"
  );
  const [embeddingLabel, setEmbeddingLabel] = useState("Fast wiki search");
  const [embeddingModel, setEmbeddingModel] = useState(
    "text-embedding-3-small"
  );
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState(
    "https://api.openai.com/v1"
  );
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [chunkSize, setChunkSize] = useState("1200");
  const [chunkOverlap, setChunkOverlap] = useState("200");

  const settingsQuery = useQuery({
    queryKey: ["forge-wiki-settings"],
    queryFn: getWikiSettings
  });
  const appSettingsQuery = useQuery({
    queryKey: ["forge-settings"],
    queryFn: getSettings
  });

  const invalidateSettings = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["forge-wiki-settings"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-wiki-pages"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-wiki-page"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-wiki-search"] })
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

  const createEmbeddingMutation = useMutation({
    mutationFn: () =>
      createWikiEmbeddingProfile({
        label: embeddingLabel.trim(),
        model: embeddingModel.trim(),
        baseUrl: embeddingBaseUrl.trim(),
        apiKey: embeddingApiKey.trim() || undefined,
        chunkSize: Number(chunkSize),
        chunkOverlap: Number(chunkOverlap)
      }),
    onSuccess: async () => {
      setEmbeddingApiKey("");
      await invalidateSettings();
    }
  });

  const deleteProfileMutation = useMutation({
    mutationFn: ({
      kind,
      profileId
    }: {
      kind: "llm" | "embedding";
      profileId: string;
    }) => deleteWikiProfile(kind, profileId),
    onSuccess: invalidateSettings
  });

  const syncMutation = useMutation({
    mutationFn: () => syncWikiVault(),
    onSuccess: invalidateSettings
  });

  const reindexMutation = useMutation({
    mutationFn: () => reindexWiki(),
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

  const activeLlmProfile =
    settings.llmProfiles.find((profile) => profile.enabled) ??
    settings.llmProfiles[0] ??
    null;
  const activeLlmSummary = activeLlmProfile
    ? summarizeWikiLlmProfile(activeLlmProfile)
    : null;
  const operatingModelTooltip =
    "Canonical knowledge lives in SQLite notes, with Forge maintaining metadata, links, search, and optional embedding indexes in the database. Text search and entity-linked search work without embeddings, while semantic search stays additive and profile-driven. Ingest jobs can create pages and media assets now, with room for richer OCR, transcription, and multimodal compilation later.";

  const forgeWikiSlot = appSettingsQuery.data?.settings.modelSettings.forgeAgent.wiki;

  return (
    <div className="mx-auto grid w-full max-w-[1440px] gap-5">
      <PageHero
        eyebrow="SQLite memory"
        title="KarpaWiki Settings"
        titleText="KarpaWiki Settings"
        description="Configure SQLite-backed spaces, parse models, and embedding profiles for the KarpaWiki memory system."
        badge={`${settings.spaces.length} spaces · ${settings.embeddingProfiles.length} embedding profiles`}
        actions={
          <>
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
              disabled={settings.embeddingProfiles.length === 0}
            >
              Reindex embeddings
            </Button>
          </>
        }
      />

      <SettingsSectionNav />

      <div className="grid gap-5">
        <Card className="grid gap-4">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-sm text-white">Auto-ingest model</div>
              <div className="text-xs leading-5 text-white/50">
                KarpaWiki ingest now reads its credentials and model slot from the
                dedicated Models settings page instead of owning the OpenAI
                setup flow here.
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(24rem,0.9fr)]">
            <div className="grid gap-5 rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(22,32,49,0.9),rgba(12,18,31,0.9))] p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                    Current profile
                  </div>
                  <div className="mt-2 text-xl font-semibold text-white">
                    {forgeWikiSlot?.connectionLabel ?? activeLlmProfile?.label ?? "No external KarpaWiki model selected"}
                  </div>
                  <div className="mt-2 max-w-3xl text-sm leading-6 text-white/58">
                    {forgeWikiSlot?.connectionLabel
                      ? "Forge now resolves wiki ingest through the selected Models connection and syncs the managed wiki profile automatically."
                      : "Pick a Models connection when you want Forge wiki ingest to run through the OpenAI API or a local compatible endpoint."}
                  </div>
                </div>
                <Link
                  to="/settings/models"
                  className="inline-flex min-h-11 items-center rounded-[16px] bg-white/[0.08] px-4 py-3 text-sm text-white transition hover:bg-white/[0.12]"
                >
                  Open model settings
                </Link>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                    Model
                  </div>
                  <div className="mt-2 text-white">
                    {forgeWikiSlot?.model ?? activeLlmSummary?.model ?? "Not set"}
                  </div>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                    Provider
                  </div>
                  <div className="mt-2 text-white">
                    {forgeWikiSlot?.connectionLabel ?? "Not set"}
                  </div>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                    Endpoint
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-white">
                    {forgeWikiSlot?.baseUrl ?? activeLlmProfile?.baseUrl ?? "Not set"}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 rounded-[28px] border border-white/8 bg-white/[0.03] p-6">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                Supported controls
              </div>
              <div className="text-sm leading-6 text-white/58">
                OpenAI API and local compatible endpoints are configured under
                Settings {"->"} Models. OpenAI Codex OAuth lives there as a chat
                agent path, while Wiki keeps the SQLite memory controls here
                and consumes the selected ingest model slot.
              </div>
              <div className="flex flex-wrap gap-2">
                {["GPT-5.4", "GPT-5.4 mini", "GPT-5.4 nano"].map((label) => (
                  <Badge key={label} className="bg-white/[0.06] text-white/78">
                    {label}
                  </Badge>
                ))}
              </div>
              <Link
                to="/settings/models"
                className="inline-flex min-h-11 items-center rounded-[16px] bg-white/[0.08] px-4 py-3 text-sm text-white transition hover:bg-white/[0.12]"
              >
                Open model settings
                <ArrowUpRight className="ml-2 size-4" />
              </Link>
            </div>
          </div>

          <div className="grid gap-3">
            {settings.llmProfiles.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-5 text-sm leading-6 text-white/58">
                No LLM profile yet. Set up OpenAI once, test it, and Forge will
                use it for wiki auto-ingest.
              </div>
            ) : null}

            {settings.llmProfiles.map((profile) => {
              const summary = summarizeWikiLlmProfile(profile);
              return (
                <div
                  key={profile.id}
                  className="grid gap-3 rounded-[18px] bg-white/[0.04] px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-white">{profile.label}</div>
                      <div className="mt-1 text-xs text-white/46">
                        {summary.model} · thinking {summary.reasoning} ·
                        verbosity {summary.verbosity}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-full p-2 text-white/48 transition hover:bg-white/[0.08] hover:text-white"
                        onClick={() =>
                          void deleteProfileMutation.mutateAsync({
                            kind: "llm",
                            profileId: profile.id
                          })
                        }
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-white/58">
                    <Badge className="bg-white/[0.06] text-white/76">
                      {profile.baseUrl}
                    </Badge>
                    <Badge className="bg-white/[0.06] text-white/76">
                      {summary.hasKey ? "key saved" : "key missing"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="grid gap-5">
          <Card className="grid gap-4">
            <div className="flex items-center gap-3">
              <LibraryBig className="size-4 text-[var(--secondary)]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-sm text-white">Spaces</div>
                  <InfoTooltip
                    content={operatingModelTooltip}
                    label="Explain the wiki operating model"
                  />
                </div>
                <div className="text-xs leading-5 text-white/50">
                  Personal and shared wiki spaces map to explicit SQLite
                  namespaces.
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              {settings.spaces.map((space) => (
                <div
                  key={space.id}
                  className="grid gap-1 rounded-[18px] bg-white/[0.04] px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-white">{space.label}</div>
                    <div className="text-xs uppercase tracking-[0.16em] text-white/42">
                      {space.visibility}
                    </div>
                  </div>
                  <div className="text-xs text-white/46">{space.slug}</div>
                  <div className="text-sm text-white/60">
                    {space.description || "No description yet."}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 rounded-[20px] bg-white/[0.03] p-4">
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
                className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
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

          <Card className="grid gap-4">
            <div className="flex items-center gap-3">
              <DatabaseZap className="size-4 text-[var(--secondary)]" />
              <div>
                <div className="text-sm text-white">Embedding profiles</div>
                <div className="text-xs leading-5 text-white/50">
                  Semantic search stays opt-in. The recommended starter is fast
                  and cheap, with heading-aware chunking for agent memory
                  retrieval.
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              {settings.embeddingProfiles.map((profile) => (
                <div
                  key={profile.id}
                  className="grid gap-2 rounded-[18px] bg-white/[0.04] px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-white">{profile.label}</div>
                    <button
                      type="button"
                      className="rounded-full p-2 text-white/48 transition hover:bg-white/[0.08] hover:text-white"
                      onClick={() =>
                        void deleteProfileMutation.mutateAsync({
                          kind: "embedding",
                          profileId: profile.id
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="text-xs text-white/46">
                    {profile.model} · {profile.baseUrl}
                  </div>
                  <div className="text-sm text-white/60">
                    chunkSize {profile.chunkSize} · overlap{" "}
                    {profile.chunkOverlap}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 rounded-[20px] bg-white/[0.03] p-4">
              <Input
                value={embeddingLabel}
                onChange={(event) => setEmbeddingLabel(event.target.value)}
                placeholder="Profile label"
              />
              <Input
                value={embeddingModel}
                onChange={(event) => setEmbeddingModel(event.target.value)}
                placeholder="Model"
              />
              <Input
                value={embeddingBaseUrl}
                onChange={(event) => setEmbeddingBaseUrl(event.target.value)}
                placeholder="Base URL"
              />
              <Input
                value={embeddingApiKey}
                onChange={(event) => setEmbeddingApiKey(event.target.value)}
                placeholder="API key (optional)"
                type="password"
              />
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={chunkSize}
                  onChange={(event) => setChunkSize(event.target.value)}
                  placeholder="Chunk size"
                  type="number"
                />
                <Input
                  value={chunkOverlap}
                  onChange={(event) => setChunkOverlap(event.target.value)}
                  placeholder="Chunk overlap"
                  type="number"
                />
              </div>
              <Button
                pending={createEmbeddingMutation.isPending}
                pendingLabel="Saving"
                disabled={!embeddingLabel.trim() || !embeddingModel.trim()}
                onClick={() => void createEmbeddingMutation.mutateAsync()}
              >
                Save embedding profile
              </Button>
            </div>
          </Card>
        </div>
      </div>

    </div>
  );
}
