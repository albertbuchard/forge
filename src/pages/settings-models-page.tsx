import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  ExternalLink,
  KeyRound,
  PlugZap,
  Sparkles,
  Trash2
} from "lucide-react";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  deleteAiModelConnection,
  getOpenAiCodexOauthSession,
  getSettings,
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

function defaultEditorState(provider: AiModelProvider = "openai-api"): EditorState {
  return {
    label:
      provider === "openai-codex"
        ? "OpenAI Codex"
        : provider === "openai-compatible"
          ? "Local compatible endpoint"
          : "OpenAI API",
    provider,
    baseUrl:
      provider === "openai-codex"
        ? "https://chatgpt.com/backend-api"
        : provider === "openai-compatible"
          ? "http://127.0.0.1:11434/v1"
          : "https://api.openai.com/v1",
    model: "gpt-5.4-mini",
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

export function SettingsModelsPage() {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<EditorState>(() => defaultEditorState());
  const [basicChatConnectionId, setBasicChatConnectionId] = useState("");
  const [basicChatModel, setBasicChatModel] = useState("gpt-5.4-mini");
  const [wikiConnectionId, setWikiConnectionId] = useState("");
  const [wikiModel, setWikiModel] = useState("gpt-5.4-mini");
  const [manualOauthCode, setManualOauthCode] = useState("");
  const [oauthSessionId, setOauthSessionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["forge-settings"],
    queryFn: getSettings
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
    onSuccess: invalidateSettings
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
          editor.provider === "openai-codex" ? undefined : editor.apiKey || undefined,
        oauthSessionId:
          editor.provider === "openai-codex" ? oauthSessionId ?? undefined : undefined
      }),
    onSuccess: async () => {
      setFeedback("Connection saved.");
      if (editor.provider === "openai-codex") {
        setOauthSessionId(null);
        setManualOauthCode("");
      }
      setEditor(defaultEditorState(editor.provider));
      await invalidateSettings();
    }
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: deleteAiModelConnection,
    onSuccess: invalidateSettings
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () =>
      testAiModelConnection({
        connectionId: editor.id,
        provider: editor.provider,
        baseUrl: editor.baseUrl,
        model: editor.model,
        apiKey:
          editor.provider === "openai-codex" ? undefined : editor.apiKey || undefined
      }),
    onSuccess: ({ result }) => {
      setFeedback(`Connection test succeeded: ${result.outputPreview}`);
    },
    onError: (error) => {
      setFeedback(
        error instanceof Error ? error.message : "Connection test failed."
      );
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
    }
  });

  useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (!settings) return;
    setBasicChatConnectionId(
      settings.modelSettings.forgeAgent.basicChat.connectionId ?? ""
    );
    setBasicChatModel(settings.modelSettings.forgeAgent.basicChat.model);
    setWikiConnectionId(settings.modelSettings.forgeAgent.wiki.connectionId ?? "");
    setWikiModel(settings.modelSettings.forgeAgent.wiki.model);
  }, [settingsQuery.data]);

  const connections = settingsQuery.data?.settings.modelSettings.connections ?? [];
  const oauthSession: OpenAiCodexOauthSession | null =
    oauthSessionQuery.data?.session ?? null;

  const canSaveConnection = useMemo(() => {
    if (!editor.label.trim() || !editor.model.trim()) return false;
    if (editor.provider === "openai-codex") {
      return Boolean(editor.id || oauthSession?.status === "authorized");
    }
    return editor.apiKey.trim().length > 0 || Boolean(editor.id);
  }, [editor, oauthSession?.status]);

  if (settingsQuery.isLoading) {
    return (
      <LoadingState
        eyebrow="Models"
        title="Loading model settings"
        description="Fetching Forge agent defaults and configured AI connections."
      />
    );
  }

  if (settingsQuery.isError || !settingsQuery.data?.settings) {
    return (
      <ErrorState
        eyebrow="Models"
        error={
          settingsQuery.error ??
          new Error("Forge returned an empty model settings payload.")
        }
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  const settings = settingsQuery.data.settings;

  return (
    <div className="mx-auto grid w-full max-w-[1440px] gap-5">
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
            <div className="text-sm text-white">Forge Agent defaults</div>
            <div className="text-xs leading-5 text-white/52">
              Forge Agent stays the default system agent. Choose which model
              connection powers basic chat and the managed wiki workflow.
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="grid gap-2 rounded-[20px] bg-white/[0.04] p-4">
            <span className="text-sm text-white/72">Basic chat connection</span>
            <select
              className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
              value={basicChatConnectionId}
              onChange={(event) => setBasicChatConnectionId(event.target.value)}
            >
              <option value="">No external connection</option>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.label} ({connection.agentLabel})
                </option>
              ))}
            </select>
            <input
              className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
              value={basicChatModel}
              onChange={(event) => setBasicChatModel(event.target.value)}
              placeholder="Model"
            />
          </label>

          <label className="grid gap-2 rounded-[20px] bg-white/[0.04] p-4">
            <span className="text-sm text-white/72">Wiki model connection</span>
            <select
              className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
              value={wikiConnectionId}
              onChange={(event) => setWikiConnectionId(event.target.value)}
            >
              <option value="">No external connection</option>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.label} ({connection.agentLabel})
                </option>
              ))}
            </select>
            <input
              className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
              value={wikiModel}
              onChange={(event) => setWikiModel(event.target.value)}
              placeholder="Model"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            pending={saveDefaultsMutation.isPending}
            pendingLabel="Saving defaults"
            onClick={() => void saveDefaultsMutation.mutateAsync()}
          >
            Save Forge Agent defaults
          </Button>
          <Badge className="bg-white/[0.06] text-white/78">
            Forge Agent
            {settings.modelSettings.forgeAgent.basicChat.connectionLabel
              ? ` basic chat: ${settings.modelSettings.forgeAgent.basicChat.connectionLabel}`
              : " basic chat stays local"}
          </Badge>
          <Badge className="bg-white/[0.06] text-white/78">
            {settings.modelSettings.forgeAgent.wiki.connectionLabel
              ? `Wiki: ${settings.modelSettings.forgeAgent.wiki.connectionLabel}`
              : "Wiki: no external model selected"}
          </Badge>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="grid gap-4">
          <div className="flex items-center gap-3">
            <PlugZap className="size-4 text-[var(--secondary)]" />
            <div>
              <div className="text-sm text-white">Connection editor</div>
              <div className="text-xs leading-5 text-white/52">
                Every saved connection becomes a first-class agent layered on
                top of Forge Agent.
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="grid gap-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                Provider
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {(
                  [
                    ["openai-api", "OpenAI API"],
                    ["openai-codex", "OpenAI Codex OAuth"],
                    ["openai-compatible", "OpenAI-compatible"]
                  ] as const
                ).map(([provider, label]) => (
                  <button
                    key={provider}
                    type="button"
                    className={`rounded-[18px] px-4 py-3 text-left text-sm transition ${
                      editor.provider === provider
                        ? "bg-[var(--primary)]/[0.18] text-white"
                        : "bg-white/[0.04] text-white/62 hover:bg-white/[0.08]"
                    }`}
                    onClick={() => {
                      setEditor(defaultEditorState(provider));
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
              className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
              value={editor.label}
              onChange={(event) =>
                setEditor((current) => ({ ...current, label: event.target.value }))
              }
              placeholder="Connection label"
            />
            <input
              className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
              value={editor.model}
              onChange={(event) =>
                setEditor((current) => ({ ...current, model: event.target.value }))
              }
              placeholder="Model"
            />

            {editor.provider !== "openai-codex" ? (
              <>
                <input
                  className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                  value={editor.baseUrl}
                  onChange={(event) =>
                    setEditor((current) => ({
                      ...current,
                      baseUrl: event.target.value
                    }))
                  }
                  placeholder="Base URL"
                />
                <input
                  className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                  value={editor.apiKey}
                  onChange={(event) =>
                    setEditor((current) => ({
                      ...current,
                      apiKey: event.target.value
                    }))
                  }
                  placeholder={
                    editor.id ? "Leave blank to keep the stored key" : "API key"
                  }
                  type="password"
                />
              </>
            ) : (
              <div className="grid gap-3 rounded-[20px] bg-white/[0.04] p-4">
                <div className="text-sm text-white">
                  OpenAI Codex uses the documented PKCE flow with the local
                  callback at {settings.modelSettings.oauth.openAiCodex.callbackUrl}.
                </div>
                <div className="text-xs leading-5 text-white/52">
                  Start OAuth, finish the browser sign-in, then save the
                  resulting connection as a chat agent backed by the ChatGPT
                  Codex runtime.
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    pending={startOauthMutation.isPending}
                    pendingLabel="Starting OAuth"
                    onClick={() => void startOauthMutation.mutateAsync()}
                  >
                    <Sparkles className="size-4" />
                    Start OAuth
                  </Button>
                  {oauthSession?.authUrl ? (
                    <Button
                      variant="secondary"
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
                  <div className="grid gap-2 rounded-[18px] bg-black/20 p-3 text-sm text-white/72">
                    <div>Status: {oauthSession.status}</div>
                    {oauthSession.accountLabel ? (
                      <div>Account: {oauthSession.accountLabel}</div>
                    ) : null}
                    {oauthSession.error ? (
                      <div className="text-rose-200">{oauthSession.error}</div>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <input
                    className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                    value={manualOauthCode}
                    onChange={(event) => setManualOauthCode(event.target.value)}
                    placeholder="Paste the authorization code or full redirect URL"
                  />
                  <Button
                    variant="secondary"
                    disabled={!manualOauthCode.trim() || !oauthSessionId}
                    pending={submitManualCodeMutation.isPending}
                    pendingLabel="Submitting"
                    onClick={() => void submitManualCodeMutation.mutateAsync()}
                  >
                    Submit manual code
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Button
                pending={saveConnectionMutation.isPending}
                pendingLabel="Saving connection"
                disabled={!canSaveConnection}
                onClick={() => void saveConnectionMutation.mutateAsync()}
              >
                Save connection
              </Button>
              <Button
                variant="secondary"
                pending={testConnectionMutation.isPending}
                pendingLabel="Testing"
                disabled={
                  editor.provider === "openai-codex"
                    ? !editor.id
                    : !editor.id && !editor.apiKey.trim()
                }
                onClick={() => void testConnectionMutation.mutateAsync()}
              >
                <KeyRound className="size-4" />
                Test connection
              </Button>
            </div>
            {feedback ? (
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm text-white/72">
                {feedback}
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="grid gap-4">
          <div className="flex items-center gap-3">
            <Bot className="size-4 text-[var(--secondary)]" />
            <div>
              <div className="text-sm text-white">Connected agents</div>
              <div className="text-xs leading-5 text-white/52">
                Each connection registers its own chat-facing agent identity.
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            {connections.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-5 text-sm leading-6 text-white/58">
                No external model connection yet. Add one with OAuth or API
                credentials and Forge will expose it as a first-class agent.
              </div>
            ) : null}

            {connections.map((connection) => (
              <div
                key={connection.id}
                className="grid gap-3 rounded-[20px] bg-white/[0.04] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-white">{connection.label}</div>
                    <div className="mt-1 text-xs text-white/46">
                      {connection.agentLabel} · {connection.provider} ·{" "}
                      {connection.model}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditor(editorFromConnection(connection));
                        setOauthSessionId(null);
                        setManualOauthCode("");
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      pending={deleteConnectionMutation.isPending}
                      pendingLabel="Deleting"
                      onClick={() =>
                        void deleteConnectionMutation.mutateAsync(connection.id)
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-white/[0.06] text-white/78">
                    {connection.authMode === "oauth" ? "OAuth" : "API key"}
                  </Badge>
                  <Badge className="bg-white/[0.06] text-white/78">
                    {connection.status}
                  </Badge>
                  <Badge className="bg-white/[0.06] text-white/78">
                    {connection.baseUrl}
                  </Badge>
                  {connection.accountLabel ? (
                    <Badge className="bg-white/[0.06] text-white/78">
                      {connection.accountLabel}
                    </Badge>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
