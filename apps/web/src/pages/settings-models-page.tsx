import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  DatabaseZap,
  ExternalLink,
  KeyRound,
  PlugZap,
  Sparkles,
  Trash2
} from "lucide-react";
import {
  SettingsSectionNav,
  SettingsStateFrame
} from "@/components/settings/settings-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  deleteAiModelConnection,
  deleteWikiProfile,
  createWikiEmbeddingProfile,
  getOpenAiCodexOauthSession,
  getSettings,
  getWikiSettings,
  patchSettings,
  saveAiModelConnection,
  startOpenAiCodexOauth,
  submitOpenAiCodexOauthManualCode,
  testAiModelConnection
} from "@/lib/api";
import type {
  AiModelConnection,
  AiModelProvider,
  OpenAiCodexOauthSession
} from "@/lib/types";

type EditorState = {
  id?: string;
  label: string;
  provider: AiModelProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
};

type ConnectionHealthState = {
  status: "healthy" | "unavailable";
  detail: string;
};

type EditorTestFeedback = {
  revision: number;
  message: string;
};

const WORKBENCH_MOCK_PROVIDER_ENABLED = import.meta.env.DEV;

const modelPanelClass =
  "grid min-w-0 gap-2 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4";
const modelSoftPanelClass =
  "grid min-w-0 gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4";
const modelEmptyClass =
  "rounded-[20px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-5 text-sm leading-6 text-[var(--ui-ink-soft)]";
const modelInputClass =
  "min-h-11 min-w-0 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-3 text-sm text-[var(--ui-ink-strong)] outline-none placeholder:text-[var(--ui-ink-faint)] transition focus:border-[var(--primary)]/35 focus:bg-[var(--ui-surface-3)]";
const modelTitleClass = "text-sm text-[var(--ui-ink-strong)]";
const modelBodyClass = "text-[var(--ui-ink-soft)]";
const modelFaintClass = "text-[var(--ui-ink-faint)]";
const modelEyebrowClass =
  "text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const modelMetaBadgeClass =
  "bg-[var(--ui-surface-3)] text-[var(--ui-ink-medium)]";
const modelWarningBadgeClass =
  "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]";
const modelDangerPanelClass =
  "rounded-[20px] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] px-4 py-5 text-sm leading-6 text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]";

function defaultEditorState(
  provider: AiModelProvider = "openai-api"
): EditorState {
  return {
    label:
      provider === "openai-codex"
        ? "OpenAI Codex"
        : provider === "openai-compatible"
          ? "Local compatible endpoint"
          : provider === "mock"
            ? "Workbench mock runtime"
            : "OpenAI API",
    provider,
    baseUrl:
      provider === "openai-codex"
        ? "https://chatgpt.com/backend-api"
        : provider === "openai-compatible"
          ? "http://127.0.0.1:11434/v1"
          : provider === "mock"
            ? "mock://workbench"
            : "https://api.openai.com/v1",
    model: provider === "mock" ? "mock-echo" : "gpt-5.4-mini",
    apiKey: ""
  };
}

function editorFromConnection(connection: AiModelConnection): EditorState {
  return {
    id: connection.id,
    label: connection.label,
    provider: connection.provider,
    baseUrl: connection.baseUrl,
    model: connection.model,
    apiKey: ""
  };
}

function matchesSavedConnectionBinding(
  editor: EditorState,
  connection: AiModelConnection | null | undefined
) {
  return Boolean(
    connection &&
    editor.provider === connection.provider &&
    editor.baseUrl.trim() === connection.baseUrl &&
    editor.model.trim() === connection.model
  );
}

export function SettingsModelsPage() {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<EditorState>(() => defaultEditorState());
  const [basicChatConnectionId, setBasicChatConnectionId] = useState("");
  const [basicChatModel, setBasicChatModel] = useState("gpt-5.4-mini");
  const [wikiConnectionId, setWikiConnectionId] = useState("");
  const [wikiModel, setWikiModel] = useState("gpt-5.4-mini");
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
  const [manualOauthCode, setManualOauthCode] = useState("");
  const [oauthSessionId, setOauthSessionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [editorTestFeedback, setEditorTestFeedback] =
    useState<EditorTestFeedback | null>(null);
  const [connectionHealth, setConnectionHealth] = useState<
    Record<string, ConnectionHealthState>
  >({});

  const settingsQuery = useQuery({
    queryKey: ["forge-settings"],
    queryFn: getSettings
  });

  const wikiSettingsQuery = useQuery({
    queryKey: ["forge-wiki-settings"],
    queryFn: getWikiSettings
  });

  const oauthSessionQuery = useQuery({
    queryKey: ["forge-openai-codex-oauth", oauthSessionId],
    queryFn: async () => {
      if (!oauthSessionId) {
        throw new Error("Missing OAuth session id");
      }
      return await getOpenAiCodexOauthSession(oauthSessionId);
    },
    enabled: Boolean(oauthSessionId),
    refetchInterval: (query) => {
      const status = query.state.data?.session.status;
      return status &&
        ["authorized", "error", "consumed", "expired"].includes(status)
        ? false
        : 1500;
    }
  });

  const invalidateSettings = async () => {
    await queryClient.invalidateQueries({ queryKey: ["forge-settings"] });
    await queryClient.invalidateQueries({ queryKey: ["forge-wiki-settings"] });
    await queryClient.invalidateQueries({ queryKey: ["forge-wiki-search"] });
    await queryClient.invalidateQueries({
      queryKey: ["forge-openai-codex-oauth", oauthSessionId]
    });
  };

  const saveDefaultsMutation = useMutation({
    mutationFn: () =>
      patchSettings({
        modelSettings: {
          forgeAgent: {
            basicChat: {
              connectionId: basicChatConnectionId || null,
              model: basicChatModel
            },
            wiki: {
              connectionId: wikiConnectionId || null,
              model: wikiModel
            }
          }
        }
      }),
    onSuccess: async () => {
      setFeedback("Forge Agent defaults saved.");
      await invalidateSettings();
    },
    onError: (error) => {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not save model defaults."
      );
    }
  });

  const saveConnectionMutation = useMutation({
    mutationFn: () =>
      saveAiModelConnection({
        id: editor.id,
        label: editor.label,
        provider: editor.provider,
        authMode: editor.provider === "openai-codex" ? "oauth" : "api_key",
        baseUrl: editor.baseUrl,
        model: editor.model,
        apiKey:
          editor.provider === "openai-codex"
            ? undefined
            : editor.apiKey || undefined,
        oauthSessionId:
          editor.provider === "openai-codex"
            ? (oauthSessionId ?? undefined)
            : undefined
      }),
    onSuccess: async ({ connection }) => {
      setFeedback("Connection saved.");
      setEditorTestFeedback(null);
      setEditorRevision((current) => current + 1);
      setConnectionHealth((current) => {
        if (!(connection.id in current)) {
          return current;
        }
        const next = { ...current };
        delete next[connection.id];
        return next;
      });
      if (editor.provider === "openai-codex") {
        setOauthSessionId(null);
        setManualOauthCode("");
      }
      setEditor(defaultEditorState(editor.provider));
      await invalidateSettings();
    },
    onError: (error) => {
      setFeedback(
        error instanceof Error ? error.message : "Connection save failed."
      );
    }
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: deleteAiModelConnection,
    onSuccess: async () => {
      setFeedback(
        "Connection removed. Stored credentials for that connection are no longer available to Forge."
      );
      await invalidateSettings();
    },
    onError: (error) => {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not remove the connection."
      );
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
      setFeedback("Embedding profile saved.");
      await invalidateSettings();
    },
    onError: (error) => {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not save the embedding profile."
      );
    }
  });

  const deleteEmbeddingMutation = useMutation({
    mutationFn: (profileId: string) =>
      deleteWikiProfile("embedding", profileId),
    onSuccess: async () => {
      setFeedback("Embedding profile removed.");
      await invalidateSettings();
    },
    onError: (error) => {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not remove the embedding profile."
      );
    }
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const savedConnection = editor.id
        ? settingsQuery.data?.settings.modelSettings.connections.find(
            (connection) => connection.id === editor.id
          )
        : null;
      const useSavedCredential =
        !editor.apiKey.trim() &&
        matchesSavedConnectionBinding(editor, savedConnection);
      return testAiModelConnection(
        useSavedCredential
          ? {
              connectionId: savedConnection!.id,
              model: savedConnection!.model
            }
          : {
              provider: editor.provider,
              baseUrl: editor.baseUrl,
              model: editor.model,
              apiKey:
                editor.provider === "openai-codex"
                  ? undefined
                  : editor.apiKey || undefined
            }
      );
    },
    onMutate: () => ({ revision: editorRevision }),
    onSuccess: ({ result }, _variables, context) => {
      setEditorTestFeedback({
        revision: context.revision,
        message: `Connection test succeeded: ${result.outputPreview}`
      });
    },
    onError: (error, _variables, context) => {
      setEditorTestFeedback({
        revision: context?.revision ?? editorRevision,
        message:
          error instanceof Error ? error.message : "Connection test failed."
      });
    }
  });

  const savedConnectionTestMutation = useMutation({
    mutationFn: async (connection: AiModelConnection) => ({
      connection,
      result: (
        await testAiModelConnection({
          connectionId: connection.id,
          model: connection.model
        })
      ).result
    }),
    onSuccess: ({ connection, result }) => {
      setConnectionHealth((current) => ({
        ...current,
        [connection.id]: {
          status: "healthy",
          detail: `${result.model} responded: ${result.outputPreview}`
        }
      }));
    },
    onError: (error, connection) => {
      setConnectionHealth((current) => ({
        ...current,
        [connection.id]: {
          status: "unavailable",
          detail:
            error instanceof Error
              ? error.message
              : "The model endpoint did not pass its health check."
        }
      }));
    }
  });

  const startOauthMutation = useMutation({
    mutationFn: startOpenAiCodexOauth,
    onSuccess: ({ session }) => {
      setOauthSessionId(session.id);
      setFeedback("OpenAI Codex OAuth started.");
      if (session.authUrl) {
        window.open(session.authUrl, "_blank", "noopener,noreferrer");
      }
    },
    onError: (error) => {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not start OpenAI Codex OAuth."
      );
    }
  });

  const submitManualCodeMutation = useMutation({
    mutationFn: async () => {
      if (!oauthSessionId) {
        throw new Error("No OAuth session started yet.");
      }
      return await submitOpenAiCodexOauthManualCode(
        oauthSessionId,
        manualOauthCode
      );
    },
    onSuccess: ({ session }) => {
      setFeedback(
        session.status === "authorized"
          ? "OpenAI Codex OAuth authorized."
          : "Manual OAuth code submitted."
      );
    },
    onError: (error) => {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not submit the OAuth code."
      );
    }
  });

  useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (!settings) return;
    setBasicChatConnectionId(
      settings.modelSettings.forgeAgent.basicChat.connectionId ?? ""
    );
    setBasicChatModel(settings.modelSettings.forgeAgent.basicChat.model);
    setWikiConnectionId(
      settings.modelSettings.forgeAgent.wiki.provider === "openai-codex"
        ? (settings.modelSettings.forgeAgent.wiki.connectionId ?? "")
        : ""
    );
    setWikiModel(settings.modelSettings.forgeAgent.wiki.model);
  }, [settingsQuery.data]);

  const connections =
    settingsQuery.data?.settings.modelSettings.connections ?? [];
  const codexOauthConnections = connections.filter(
    (connection) =>
      connection.provider === "openai-codex" && connection.authMode === "oauth"
  );
  const connectedCodexOauthConnections = codexOauthConnections.filter(
    (connection) => connection.hasStoredCredential
  );
  const oauthSession: OpenAiCodexOauthSession | null =
    oauthSessionQuery.data?.session ?? null;
  const editedConnection = editor.id
    ? connections.find((connection) => connection.id === editor.id)
    : null;
  const selectedBasicChatConnection = connections.find(
    (connection) => connection.id === basicChatConnectionId
  );
  const savedBindingIsCurrent = matchesSavedConnectionBinding(
    editor,
    editedConnection
  );
  const hasFreshApiKey = editor.apiKey.trim().length > 0;
  const canReuseSavedCredential = Boolean(
    editedConnection?.hasStoredCredential && savedBindingIsCurrent
  );
  const hasAuthorizedOauth = oauthSession?.status === "authorized";

  const canSaveConnection = useMemo(() => {
    if (!editor.label.trim() || !editor.model.trim()) return false;
    if (editor.provider === "openai-codex") {
      return hasAuthorizedOauth || canReuseSavedCredential;
    }
    if (editor.provider === "mock") {
      return true;
    }
    return hasFreshApiKey || canReuseSavedCredential;
  }, [
    canReuseSavedCredential,
    editor.label,
    editor.model,
    editor.provider,
    hasAuthorizedOauth,
    hasFreshApiKey
  ]);
  const canTestConnection = Boolean(
    editor.model.trim() &&
    (editor.provider === "mock" ||
      canReuseSavedCredential ||
      (editor.provider !== "openai-codex" && hasFreshApiKey))
  );
  const editorReadinessMessage = !editor.label.trim()
    ? "Enter a connection name before saving."
    : !editor.model.trim()
      ? "Enter a model name before saving or testing this connection."
      : editor.provider === "openai-codex" &&
          !canReuseSavedCredential &&
          !hasAuthorizedOauth
        ? "Finish a new OpenAI Codex sign-in before saving changed connection details."
        : editor.provider === "openai-codex" && hasAuthorizedOauth
          ? "Sign-in is complete. Save this connection before testing it."
          : editor.provider !== "mock" &&
              !hasFreshApiKey &&
              !canReuseSavedCredential
            ? editor.id
              ? "Enter a fresh API key before saving or testing a changed provider, endpoint, or model."
              : "Enter an API key before saving or testing this connection."
            : "Connection details are ready to save and test.";
  const visibleEditorTestFeedback =
    editorTestFeedback?.revision === editorRevision
      ? editorTestFeedback.message
      : "";

  if (settingsQuery.isLoading) {
    return (
      <SettingsStateFrame>
        <LoadingState
          eyebrow="Models"
          title="Loading model settings"
          description="Fetching Forge agent defaults and configured AI connections."
        />
      </SettingsStateFrame>
    );
  }

  if (settingsQuery.isError || !settingsQuery.data?.settings) {
    return (
      <SettingsStateFrame>
        <ErrorState
          eyebrow="Models"
          error={
            settingsQuery.error ??
            new Error("Forge returned an empty model settings payload.")
          }
          onRetry={() => void settingsQuery.refetch()}
        />
      </SettingsStateFrame>
    );
  }

  const settings = settingsQuery.data.settings;

  return (
    <div className="mx-auto grid min-w-0 w-full max-w-[1440px] gap-5">
      <PageHero
        eyebrow="AI runtime"
        title="Model Settings"
        description="Manage Forge Agent defaults, OpenAI OAuth/API connections, and local OpenAI-compatible endpoints as first-class chat agents."
        badge={`${connections.length} model connection${connections.length === 1 ? "" : "s"}`}
      />

      <SettingsSectionNav />

      <Card className="grid gap-5">
        <div className="flex items-center gap-3">
          <Bot className="size-4 text-[var(--secondary)]" />
          <div>
            <div className={modelTitleClass}>Forge Agent defaults</div>
            <div className={`text-xs leading-5 ${modelFaintClass}`}>
              Forge Agent stays the default system agent. Choose which model
              connection powers basic chat and the managed wiki workflow.
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className={modelPanelClass}>
            <span className={`text-sm ${modelBodyClass}`}>
              Basic chat connection
            </span>
            <select
              className={modelInputClass}
              aria-label="Basic chat connection"
              value={basicChatConnectionId}
              onChange={(event) => setBasicChatConnectionId(event.target.value)}
            >
              <option value="">No external connection</option>
              {connections.map((connection) => (
                <option
                  key={connection.id}
                  value={connection.id}
                  disabled={
                    !connection.enabled || !connection.hasStoredCredential
                  }
                >
                  {connection.label} ({connection.agentLabel})
                  {!connection.hasStoredCredential
                    ? " · credential required"
                    : ""}
                </option>
              ))}
            </select>
            <input
              className={modelInputClass}
              aria-label="Basic chat model"
              value={basicChatModel}
              onChange={(event) => setBasicChatModel(event.target.value)}
              placeholder="Model"
            />
          </label>

          <label className={modelPanelClass}>
            <span className={`text-sm ${modelBodyClass}`}>
              KarpaWiki Codex OAuth connection
            </span>
            <select
              className={modelInputClass}
              aria-label="KarpaWiki Codex OAuth connection"
              value={wikiConnectionId}
              onChange={(event) => setWikiConnectionId(event.target.value)}
            >
              <option value="">No Codex OAuth connection</option>
              {codexOauthConnections.map((connection) => (
                <option
                  key={connection.id}
                  value={connection.id}
                  disabled={!connection.hasStoredCredential}
                >
                  {connection.label} (
                  {connection.accountLabel ?? connection.agentLabel})
                  {connection.hasStoredCredential ? "" : " · needs OAuth"}
                </option>
              ))}
            </select>
            <input
              className={modelInputClass}
              aria-label="KarpaWiki model"
              value={wikiModel}
              onChange={(event) => setWikiModel(event.target.value)}
              placeholder="Model"
            />
            <span className={`text-xs leading-5 ${modelFaintClass}`}>
              KarpaWiki smart ingest uses ChatGPT/Codex OAuth only. It does not
              use metered OpenAI Platform API keys.
            </span>
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            className="min-h-11"
            pending={saveDefaultsMutation.isPending}
            pendingLabel="Saving defaults"
            onClick={() => saveDefaultsMutation.mutate()}
          >
            Save Forge Agent defaults
          </Button>
          <Badge className={modelMetaBadgeClass}>
            Forge Agent
            {settings.modelSettings.forgeAgent.basicChat.connectionLabel
              ? ` basic chat: ${settings.modelSettings.forgeAgent.basicChat.connectionLabel}`
              : " basic chat stays local"}
          </Badge>
          <Badge className={modelMetaBadgeClass}>
            {settings.modelSettings.forgeAgent.wiki.connectionLabel
              ? `KarpaWiki OAuth: ${settings.modelSettings.forgeAgent.wiki.connectionLabel}`
              : "KarpaWiki: no Codex OAuth model selected"}
          </Badge>
          {connectedCodexOauthConnections.length === 0 ? (
            <Badge className={modelWarningBadgeClass}>
              Add OpenAI Codex OAuth before smart ingest
            </Badge>
          ) : null}
        </div>
        {selectedBasicChatConnection?.status === "needs_attention" ? (
          <div className={modelDangerPanelClass}>
            The selected basic-chat connection needs attention. Forge does not
            silently fall back to another external provider; test or replace
            this connection before relying on it.
          </div>
        ) : null}
      </Card>

      <Card className="grid gap-4">
        <div className="flex items-center gap-3">
          <DatabaseZap className="size-4 text-[var(--secondary)]" />
          <div>
            <div className={modelTitleClass}>KarpaWiki embeddings</div>
            <div className={`text-xs leading-5 ${modelFaintClass}`}>
              Semantic search profiles live with model settings. They remain
              optional; KarpaWiki text search and entity-linked search still
              work without embeddings.
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
          <div className="grid gap-3">
            {wikiSettingsQuery.isLoading ? (
              <div className={modelEmptyClass}>Loading embedding profiles.</div>
            ) : null}
            {wikiSettingsQuery.isError ? (
              <div className={modelDangerPanelClass}>
                Could not load KarpaWiki embedding profiles.
              </div>
            ) : null}
            {wikiSettingsQuery.data?.settings.embeddingProfiles.length === 0 ? (
              <div className={modelEmptyClass}>
                No embedding profile yet. Add one only if you want semantic wiki
                search in addition to exact search and links.
              </div>
            ) : null}
            {wikiSettingsQuery.data?.settings.embeddingProfiles.map(
              (profile) => (
                <div
                  key={profile.id}
                  className="grid min-w-0 gap-2 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[var(--ui-ink-strong)]">
                        {profile.label}
                      </div>
                      <div
                        className={`mt-1 break-words text-xs [overflow-wrap:anywhere] ${modelFaintClass}`}
                      >
                        {profile.model} · {profile.baseUrl}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      className="min-h-11 min-w-11"
                      aria-label={`Remove ${profile.label} embedding profile`}
                      pending={deleteEmbeddingMutation.isPending}
                      pendingLabel="Deleting"
                      onClick={() => deleteEmbeddingMutation.mutate(profile.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge className={modelMetaBadgeClass}>
                      chunk {profile.chunkSize}
                    </Badge>
                    <Badge className={modelMetaBadgeClass}>
                      overlap {profile.chunkOverlap}
                    </Badge>
                    <Badge className={modelMetaBadgeClass}>
                      {profile.enabled ? "enabled" : "disabled"}
                    </Badge>
                  </div>
                </div>
              )
            )}
          </div>

          <div className={modelSoftPanelClass}>
            <input
              className={modelInputClass}
              aria-label="Embedding profile name"
              value={embeddingLabel}
              onChange={(event) => setEmbeddingLabel(event.target.value)}
              placeholder="Profile label"
            />
            <input
              className={modelInputClass}
              aria-label="Embedding model"
              value={embeddingModel}
              onChange={(event) => setEmbeddingModel(event.target.value)}
              placeholder="Embedding model"
            />
            <input
              className={modelInputClass}
              aria-label="Embedding base URL"
              value={embeddingBaseUrl}
              onChange={(event) => setEmbeddingBaseUrl(event.target.value)}
              placeholder="Embedding base URL"
            />
            <input
              className={modelInputClass}
              aria-label="Embedding API key"
              value={embeddingApiKey}
              onChange={(event) => setEmbeddingApiKey(event.target.value)}
              placeholder="Embedding API key (optional)"
              type="password"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                className={modelInputClass}
                aria-label="Embedding chunk size"
                value={chunkSize}
                onChange={(event) => setChunkSize(event.target.value)}
                placeholder="Chunk size"
                type="number"
              />
              <input
                className={modelInputClass}
                aria-label="Embedding chunk overlap"
                value={chunkOverlap}
                onChange={(event) => setChunkOverlap(event.target.value)}
                placeholder="Chunk overlap"
                type="number"
              />
            </div>
            <Button
              className="min-h-11"
              pending={createEmbeddingMutation.isPending}
              pendingLabel="Saving"
              disabled={!embeddingLabel.trim() || !embeddingModel.trim()}
              onClick={() => createEmbeddingMutation.mutate()}
            >
              Save embedding profile
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="grid gap-4">
          <div className="flex items-center gap-3">
            <PlugZap className="size-4 text-[var(--secondary)]" />
            <div>
              <div className={modelTitleClass}>Connection editor</div>
              <div className={`text-xs leading-5 ${modelFaintClass}`}>
                Every saved connection becomes a first-class agent layered on
                top of Forge Agent.
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="grid gap-2">
              <div className={modelEyebrowClass}>Provider</div>
              <div
                className="grid gap-2 md:grid-cols-3"
                role="group"
                aria-label="Model provider"
              >
                {(
                  [
                    ["openai-api", "OpenAI API"],
                    ["openai-codex", "OpenAI Codex OAuth"],
                    ["openai-compatible", "OpenAI-compatible"],
                    ...(WORKBENCH_MOCK_PROVIDER_ENABLED
                      ? ([["mock", "Workbench mock"]] as const)
                      : [])
                  ] as const
                ).map(([provider, label]) => (
                  <button
                    key={provider}
                    type="button"
                    aria-pressed={editor.provider === provider}
                    className={`min-h-11 rounded-[18px] px-4 py-3 text-left text-sm transition ${
                      editor.provider === provider
                        ? "border border-[color-mix(in_srgb,var(--primary)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)] shadow-[var(--ui-shadow-soft)]"
                        : "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                    }`}
                    onClick={() => {
                      setEditor(defaultEditorState(provider));
                      setEditorRevision((current) => current + 1);
                      setOauthSessionId(null);
                      setManualOauthCode("");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <input
              className={modelInputClass}
              aria-label="Connection name"
              value={editor.label}
              onChange={(event) =>
                setEditor((current) => ({
                  ...current,
                  label: event.target.value
                }))
              }
              placeholder="Connection label"
            />
            <input
              className={modelInputClass}
              aria-label="Connection model"
              value={editor.model}
              onChange={(event) => {
                setEditor((current) => ({
                  ...current,
                  model: event.target.value
                }));
                setEditorRevision((current) => current + 1);
              }}
              placeholder="Model"
            />

            {editor.provider === "mock" ? (
              <div className={modelSoftPanelClass}>
                <div className={modelTitleClass}>
                  The Workbench mock runtime is only meant for local development
                  and test workflows.
                </div>
                <div className={`text-xs leading-5 ${modelFaintClass}`}>
                  Use mock models like <code>mock-echo</code>,{" "}
                  <code>mock-json</code>,<code>mock-tool-search</code>,{" "}
                  <code>mock-tool-note</code>, or
                  <code>mock-chat-memory</code> to exercise deterministic flow
                  behavior without a real external model.
                </div>
              </div>
            ) : editor.provider !== "openai-codex" ? (
              <>
                <input
                  className={modelInputClass}
                  aria-label="Connection base URL"
                  value={editor.baseUrl}
                  onChange={(event) => {
                    setEditor((current) => ({
                      ...current,
                      baseUrl: event.target.value
                    }));
                    setEditorRevision((current) => current + 1);
                  }}
                  placeholder="Base URL"
                />
                <input
                  className={modelInputClass}
                  aria-label="Connection API key"
                  value={editor.apiKey}
                  onChange={(event) => {
                    setEditor((current) => ({
                      ...current,
                      apiKey: event.target.value
                    }));
                    setEditorRevision((current) => current + 1);
                  }}
                  placeholder={
                    canReuseSavedCredential
                      ? "Leave blank to keep the stored key"
                      : editor.id
                        ? "Enter a fresh API key"
                        : "API key"
                  }
                  type="password"
                />
              </>
            ) : (
              <div className={modelSoftPanelClass}>
                <div className={modelTitleClass}>
                  OpenAI Codex uses the documented PKCE flow with the local
                  callback at{" "}
                  <span className="break-words [overflow-wrap:anywhere]">
                    {settings.modelSettings.oauth.openAiCodex.callbackUrl}
                  </span>
                </div>
                <div className={`text-xs leading-5 ${modelFaintClass}`}>
                  Start OAuth, finish the browser sign-in, then save the
                  resulting connection as a chat agent backed by the ChatGPT
                  Codex runtime.
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    className="min-h-11"
                    pending={startOauthMutation.isPending}
                    pendingLabel="Starting OAuth"
                    onClick={() => startOauthMutation.mutate()}
                  >
                    <Sparkles className="size-4" />
                    Start OAuth
                  </Button>
                  {oauthSession?.authUrl ? (
                    <Button
                      variant="secondary"
                      className="min-h-11"
                      onClick={() =>
                        window.open(
                          oauthSession.authUrl ?? "",
                          "_blank",
                          "noopener,noreferrer"
                        )
                      }
                    >
                      Open sign-in
                      <ExternalLink className="size-4" />
                    </Button>
                  ) : null}
                </div>
                {oauthSession ? (
                  <div className="grid min-w-0 gap-2 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-code-bg)] p-3 text-sm text-[var(--ui-code-text)]">
                    <div>Status: {oauthSession.status}</div>
                    {oauthSession.accountLabel ? (
                      <div>Account: {oauthSession.accountLabel}</div>
                    ) : null}
                    {oauthSession.error ? (
                      <div className="text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]">
                        {oauthSession.error}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <input
                    className={modelInputClass}
                    aria-label="OpenAI Codex authorization code or redirect URL"
                    value={manualOauthCode}
                    onChange={(event) => setManualOauthCode(event.target.value)}
                    placeholder="Paste the authorization code or full redirect URL"
                  />
                  <Button
                    variant="secondary"
                    className="min-h-11"
                    disabled={!manualOauthCode.trim() || !oauthSessionId}
                    pending={submitManualCodeMutation.isPending}
                    pendingLabel="Submitting"
                    onClick={() => submitManualCodeMutation.mutate()}
                  >
                    Submit manual code
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Button
                className="min-h-11"
                aria-describedby="model-connection-readiness"
                pending={saveConnectionMutation.isPending}
                pendingLabel="Saving connection"
                disabled={!canSaveConnection}
                onClick={() => saveConnectionMutation.mutate()}
              >
                Save connection
              </Button>
              <Button
                variant="secondary"
                className="min-h-11"
                aria-describedby="model-connection-readiness"
                pending={testConnectionMutation.isPending}
                pendingLabel="Testing"
                disabled={!canTestConnection}
                onClick={() => testConnectionMutation.mutate()}
              >
                <KeyRound className="size-4" />
                Test connection
              </Button>
            </div>
            <div
              id="model-connection-readiness"
              className={`text-xs leading-5 ${modelFaintClass}`}
            >
              {editorReadinessMessage}
            </div>
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={
                feedback
                  ? `rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm ${modelBodyClass}`
                  : "sr-only"
              }
            >
              {feedback ?? ""}
            </div>
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={
                visibleEditorTestFeedback
                  ? `rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm ${modelBodyClass}`
                  : "sr-only"
              }
            >
              {visibleEditorTestFeedback}
            </div>
          </div>
        </Card>

        <Card className="grid gap-4">
          <div className="flex items-center gap-3">
            <Bot className="size-4 text-[var(--secondary)]" />
            <div>
              <div className={modelTitleClass}>Connected agents</div>
              <div className={`text-xs leading-5 ${modelFaintClass}`}>
                Each connection registers its own chat-facing agent identity.
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            {connections.length === 0 ? (
              <div className={modelEmptyClass}>
                No external model connection yet. Add one with OAuth or API
                credentials and Forge will expose it as a first-class agent.
              </div>
            ) : null}

            {connections.map((connection) => (
              <div
                key={connection.id}
                className="grid min-w-0 gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4"
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-words text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
                      {connection.label}
                    </div>
                    <div
                      className={`mt-1 break-words text-xs [overflow-wrap:anywhere] ${modelFaintClass}`}
                    >
                      {connection.agentLabel} · {connection.provider} ·{" "}
                      {connection.model}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="min-h-11"
                      pending={
                        savedConnectionTestMutation.isPending &&
                        savedConnectionTestMutation.variables?.id ===
                          connection.id
                      }
                      pendingLabel="Testing"
                      disabled={
                        !connection.enabled || !connection.hasStoredCredential
                      }
                      onClick={() =>
                        savedConnectionTestMutation.mutate(connection)
                      }
                    >
                      <KeyRound className="size-4" />
                      Test
                    </Button>
                    <Button
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => {
                        setEditor(editorFromConnection(connection));
                        setEditorRevision((current) => current + 1);
                        setOauthSessionId(null);
                        setManualOauthCode("");
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      className="min-h-11 min-w-11"
                      aria-label={`Remove ${connection.label} connection`}
                      pending={deleteConnectionMutation.isPending}
                      pendingLabel="Deleting"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove ${connection.label}? Forge will stop using its stored credential and this cannot be undone from the model settings page.`
                          )
                        ) {
                          deleteConnectionMutation.mutate(connection.id);
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge className={modelMetaBadgeClass}>
                    {connection.authMode === "oauth" ? "OAuth" : "API key"}
                  </Badge>
                  <Badge className={modelMetaBadgeClass}>
                    {connection.status}
                  </Badge>
                  <Badge
                    className={
                      connection.hasStoredCredential
                        ? modelMetaBadgeClass
                        : modelWarningBadgeClass
                    }
                  >
                    {connection.hasStoredCredential
                      ? "credential stored"
                      : "credential required"}
                  </Badge>
                  <Badge className={modelMetaBadgeClass} wrap>
                    {connection.baseUrl}
                  </Badge>
                  {connection.accountLabel ? (
                    <Badge className={modelMetaBadgeClass} wrap>
                      {connection.accountLabel}
                    </Badge>
                  ) : null}
                </div>
                <div
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className={`rounded-[16px] border border-[var(--ui-border-subtle)] px-3 py-2 text-xs leading-5 ${
                    connectionHealth[connection.id]?.status === "healthy"
                      ? "bg-[var(--ui-success-soft)] text-[var(--success)]"
                      : connectionHealth[connection.id]?.status ===
                          "unavailable"
                        ? "bg-[var(--ui-danger-soft)] text-[var(--danger)]"
                        : `bg-[var(--ui-surface-1)] ${modelFaintClass}`
                  }`}
                >
                  {connectionHealth[connection.id]?.detail ??
                    "Not health-checked in this browser session."}
                  {connectionHealth[connection.id]?.status === "unavailable"
                    ? " Forge did not switch to another connection."
                    : ""}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
