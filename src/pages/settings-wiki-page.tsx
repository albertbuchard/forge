import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseZap, KeyRound, LibraryBig, Trash2 } from "lucide-react";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { Textarea } from "@/components/ui/textarea";
import {
  createWikiEmbeddingProfile,
  createWikiLlmProfile,
  createWikiSpace,
  deleteWikiProfile,
  getWikiSettings,
  reindexWiki,
  syncWikiVault
} from "@/lib/api";

export function SettingsWikiPage() {
  const queryClient = useQueryClient();
  const [spaceLabel, setSpaceLabel] = useState("");
  const [spaceDescription, setSpaceDescription] = useState("");
  const [spaceVisibility, setSpaceVisibility] = useState<"personal" | "shared">(
    "personal"
  );
  const [llmLabel, setLlmLabel] = useState("");
  const [llmModel, setLlmModel] = useState("gpt-4.1-mini");
  const [llmBaseUrl, setLlmBaseUrl] = useState("https://api.openai.com/v1");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmPrompt, setLlmPrompt] = useState(
    "Compile this source into a Forge wiki page with concise structure, clear backlinks, and a durable summary."
  );
  const [embeddingLabel, setEmbeddingLabel] = useState("Fast wiki search");
  const [embeddingModel, setEmbeddingModel] = useState("text-embedding-3-small");
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

  const createLlmMutation = useMutation({
    mutationFn: () =>
      createWikiLlmProfile({
        label: llmLabel.trim(),
        model: llmModel.trim(),
        baseUrl: llmBaseUrl.trim(),
        apiKey: llmApiKey.trim() || undefined,
        systemPrompt: llmPrompt.trim()
      }),
    onSuccess: async () => {
      setLlmLabel("");
      setLlmApiKey("");
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
        eyebrow="Wiki settings"
        title="Loading wiki controls"
        description="Fetching spaces and profile configuration for the Forge wiki."
      />
    );
  }

  if (settingsQuery.isError) {
    return (
      <ErrorState
        eyebrow="Wiki settings"
        error={settingsQuery.error}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  const settings = settingsQuery.data?.settings;
  if (!settings) {
    return (
      <ErrorState
        eyebrow="Wiki settings"
        error={new Error("Forge returned an empty wiki settings payload.")}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1240px] gap-5">
      <PageHero
        eyebrow="File-first memory"
        title="Wiki Settings"
        titleText="Wiki Settings"
        description="Configure file-backed spaces, parse models, and embedding profiles for the Forge wiki memory system."
        badge={`${settings.spaces.length} spaces · ${settings.embeddingProfiles.length} embedding profiles`}
        actions={
          <>
            <Button
              variant="secondary"
              pending={syncMutation.isPending}
              pendingLabel="Syncing"
              onClick={() => void syncMutation.mutateAsync()}
            >
              Sync vault
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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid gap-5">
          <Card className="grid gap-4">
            <div className="flex items-center gap-3">
              <LibraryBig className="size-4 text-[var(--secondary)]" />
              <div>
                <div className="text-sm text-white">Spaces</div>
                <div className="text-xs leading-5 text-white/50">
                  Personal and shared wiki vaults map to explicit file-backed roots and metadata namespaces.
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
                  setSpaceVisibility(event.target.value as "personal" | "shared")
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
                  Semantic search stays opt-in. The recommended starter is fast and cheap, with heading-aware chunking for agent memory retrieval.
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
                    chunkSize {profile.chunkSize} · overlap {profile.chunkOverlap}
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

        <div className="grid gap-5">
          <Card className="grid gap-4">
            <div className="flex items-center gap-3">
              <KeyRound className="size-4 text-[var(--secondary)]" />
              <div>
                <div className="text-sm text-white">LLM parse profiles</div>
                <div className="text-xs leading-5 text-white/50">
                  Parse profiles power wiki compilation and future multimodal ingest flows. Secrets stay local in Forge’s encrypted storage.
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              {settings.llmProfiles.map((profile) => (
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
                          kind: "llm",
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
                    {profile.systemPrompt || "No custom system prompt."}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 rounded-[20px] bg-white/[0.03] p-4">
              <Input
                value={llmLabel}
                onChange={(event) => setLlmLabel(event.target.value)}
                placeholder="Profile label"
              />
              <Input
                value={llmModel}
                onChange={(event) => setLlmModel(event.target.value)}
                placeholder="Model"
              />
              <Input
                value={llmBaseUrl}
                onChange={(event) => setLlmBaseUrl(event.target.value)}
                placeholder="Base URL"
              />
              <Input
                value={llmApiKey}
                onChange={(event) => setLlmApiKey(event.target.value)}
                placeholder="API key (optional)"
                type="password"
              />
              <Textarea
                value={llmPrompt}
                onChange={(event) => setLlmPrompt(event.target.value)}
                className="min-h-[10rem]"
                placeholder="System prompt"
              />
              <Button
                pending={createLlmMutation.isPending}
                pendingLabel="Saving"
                disabled={!llmLabel.trim() || !llmModel.trim()}
                onClick={() => void createLlmMutation.mutateAsync()}
              >
                Save LLM profile
              </Button>
            </div>
          </Card>

          <Card className="grid gap-4">
            <div className="text-sm text-white">Operating model</div>
            <div className="grid gap-3 text-sm leading-6 text-white/62">
              <div>
                Canonical knowledge lives as markdown and media files on disk, with Forge keeping a synced metadata, link, and search index on top.
              </div>
              <div>
                Text search and entity-linked search work without embeddings. Semantic search is additive and profile-driven, not a hidden requirement.
              </div>
              <div>
                Ingest jobs create pages and media assets now, while leaving room for richer OCR, transcription, and multimodal compilation as you add profiles.
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
