import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Plus
} from "lucide-react";
import { AttentionSourceReturn } from "@/components/attention/attention-source-return";
import { AgentTokenFlowDialog } from "@/components/settings/agent-token-flow-dialog";
import { LogWorkFlowDialog } from "@/components/settings/log-work-flow-dialog";
import { RemotePairingApprovalCard } from "@/components/settings/remote-pairing-approval-card";
import {
  TokenRevealDialog,
  type TokenRevealState
} from "@/components/settings/token-reveal-dialog";
import {
  SettingsSectionNav,
  SettingsStateFrame
} from "@/components/settings/settings-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { MetricTile } from "@/components/ui/metric-tile";
import { ErrorState } from "@/components/ui/page-state";
import {
  approveApprovalRequest,
  createAgentToken,
  disconnectAgentRuntimeSession,
  ensureOperatorSession,
  getAgentRuntimeSessionHistory,
  getAgentOnboarding,
  getOperatorContext,
  getSettings,
  listApprovalRequests,
  listAgentRuntimeSessions,
  logOperatorWork,
  reconnectAgentRuntimeSession,
  rejectApprovalRequest,
  revokeAgentToken,
  rotateAgentToken
} from "@/lib/api";
import type {
  AgentAction,
  AgentRuntimeSession,
  AgentRuntimeSessionEvent,
  AgentTokenSummary,
  Task
} from "@/lib/types";
import type { CreateAgentTokenInput } from "@/lib/schemas";

function tokenHasScopes(token: AgentTokenSummary, scopes: readonly string[]) {
  return scopes.every((scope) => token.scopes.includes(scope));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Never";
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function runtimeStatusTone(status: AgentRuntimeSession["status"]) {
  if (status === "connected") {
    return "text-[color-mix(in_srgb,var(--success)_78%,var(--ui-ink-strong)_22%)]";
  }
  if (status === "stale" || status === "reconnecting") {
    return "text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]";
  }
  if (status === "error") {
    return "text-[color-mix(in_srgb,var(--danger)_78%,var(--ui-ink-strong)_22%)]";
  }
  return "text-[var(--ui-ink-muted)]";
}

function resolveRuntimeGroupStatus(sessions: AgentRuntimeSession[]) {
  if (sessions.some((session) => session.status === "connected")) {
    return "connected" as const;
  }
  if (sessions.some((session) => session.status === "reconnecting")) {
    return "reconnecting" as const;
  }
  if (sessions.some((session) => session.status === "error")) {
    return "error" as const;
  }
  if (sessions.some((session) => session.status === "stale")) {
    return "stale" as const;
  }
  return "disconnected" as const;
}

function groupRuntimeSessions(sessions: AgentRuntimeSession[]) {
  const groups = new Map<
    string,
    {
      key: string;
      agentId: string | null;
      agentLabel: string;
      provider: AgentRuntimeSession["provider"];
      status: AgentRuntimeSession["status"];
      primary: AgentRuntimeSession;
      sessions: AgentRuntimeSession[];
      actionCount: number;
      eventCount: number;
    }
  >();

  for (const session of sessions) {
    const key = session.agentId ?? `${session.provider}:${session.agentLabel}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        agentId: session.agentId,
        agentLabel: session.agentLabel,
        provider: session.provider,
        status: session.status,
        primary: session,
        sessions: [session],
        actionCount: session.actionCount,
        eventCount: session.eventCount
      });
      continue;
    }
    existing.sessions.push(session);
    existing.actionCount += session.actionCount;
    existing.eventCount += session.eventCount;
    existing.sessions.sort(
      (a, b) => Date.parse(b.lastHeartbeatAt) - Date.parse(a.lastHeartbeatAt)
    );
    existing.primary = existing.sessions[0] ?? existing.primary;
    existing.status = resolveRuntimeGroupStatus(existing.sessions);
  }

  return Array.from(groups.values()).sort(
    (a, b) =>
      Date.parse(b.primary.lastHeartbeatAt) -
      Date.parse(a.primary.lastHeartbeatAt)
  );
}

function formatBootstrapMode(
  mode: AgentTokenSummary["bootstrapPolicy"]["mode"]
) {
  return mode.replaceAll("_", " ");
}

function formatScopeSummary(token: AgentTokenSummary) {
  const parts: string[] = [];
  if (token.scopePolicy.userIds.length > 0) {
    parts.push(
      `${token.scopePolicy.userIds.length} user${token.scopePolicy.userIds.length === 1 ? "" : "s"}`
    );
  } else {
    parts.push("all visible users");
  }
  if (token.scopePolicy.projectIds.length > 0) {
    parts.push(
      `${token.scopePolicy.projectIds.length} project${token.scopePolicy.projectIds.length === 1 ? "" : "s"}`
    );
  }
  if (token.scopePolicy.tagIds.length > 0) {
    parts.push(
      `${token.scopePolicy.tagIds.length} tag${token.scopePolicy.tagIds.length === 1 ? "" : "s"}`
    );
  }
  return parts.join(" · ");
}

export function SettingsAgentsPage() {
  const queryClient = useQueryClient();

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [tokenDialogPreset, setTokenDialogPreset] = useState<
    "review" | "operator" | "autonomous" | "custom"
  >("operator");
  const [revealState, setRevealState] = useState<TokenRevealState | null>(null);
  const [revealDialogOpen, setRevealDialogOpen] = useState(false);
  const [logWorkDialogOpen, setLogWorkDialogOpen] = useState(false);
  const [onboardingExpanded, setOnboardingExpanded] = useState(false);
  const [expandedRuntimeSessionId, setExpandedRuntimeSessionId] = useState<
    string | null
  >(null);
  const [credentialFeedback, setCredentialFeedback] = useState<string | null>(
    null
  );

  // ── Queries ───────────────────────────────────────────────────────────────
  const operatorSessionQuery = useQuery({
    queryKey: ["forge-operator-session"],
    queryFn: ensureOperatorSession
  });
  const operatorReady = operatorSessionQuery.isSuccess;

  const settingsQuery = useQuery({
    queryKey: ["forge-settings"],
    queryFn: getSettings,
    enabled: operatorReady
  });
  const approvalsQuery = useQuery({
    queryKey: ["forge-approval-requests"],
    queryFn: listApprovalRequests,
    enabled: operatorReady
  });
  const onboardingQuery = useQuery({
    queryKey: ["forge-agent-onboarding"],
    queryFn: getAgentOnboarding
  });
  const runtimeSessionsQuery = useQuery({
    queryKey: ["forge-agent-runtime-sessions"],
    queryFn: listAgentRuntimeSessions,
    enabled: operatorReady
  });
  const runtimeSessionHistoryQuery = useQuery({
    queryKey: ["forge-agent-runtime-session-history", expandedRuntimeSessionId],
    queryFn: () => getAgentRuntimeSessionHistory(expandedRuntimeSessionId!),
    enabled: operatorReady && Boolean(expandedRuntimeSessionId)
  });
  const operatorContextQuery = useQuery({
    queryKey: ["forge-operator-context"],
    queryFn: getOperatorContext,
    enabled: operatorReady
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["forge-operator-session"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-settings"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-approval-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-agent-onboarding"] }),
      queryClient.invalidateQueries({
        queryKey: ["forge-agent-runtime-sessions"]
      }),
      queryClient.invalidateQueries({
        queryKey: ["forge-agent-runtime-session-history"]
      }),
      queryClient.invalidateQueries({ queryKey: ["forge-operator-context"] })
    ]);
  };

  const tokenMutation = useMutation({
    mutationFn: (input: CreateAgentTokenInput) => createAgentToken(input),
    onSuccess: invalidateAll,
    onError: (error) => {
      setCredentialFeedback(
        error instanceof Error ? error.message : "Could not issue the token."
      );
    }
  });
  const rotateMutation = useMutation({
    mutationFn: (tokenId: string) => rotateAgentToken(tokenId),
    onSuccess: async (data) => {
      await invalidateAll();
      // Show the reveal dialog for the rotated token
      if (onboarding) {
        const rotatedSummary = data.token;
        setRevealState({
          tokenString: rotatedSummary.token,
          agentLabel: rotatedSummary.tokenSummary.agentLabel ?? "forge-agent",
          onboarding
        });
        setRevealDialogOpen(true);
      }
    },
    onError: (error) => {
      setCredentialFeedback(
        error instanceof Error ? error.message : "Could not rotate the token."
      );
    }
  });
  const revokeMutation = useMutation({
    mutationFn: (tokenId: string) => revokeAgentToken(tokenId),
    onSuccess: async () => {
      setCredentialFeedback(
        "Token revoked. Existing callers can no longer use it."
      );
      await invalidateAll();
    },
    onError: (error) => {
      setCredentialFeedback(
        error instanceof Error ? error.message : "Could not revoke the token."
      );
    }
  });
  const approveMutation = useMutation({
    mutationFn: (id: string) => approveApprovalRequest(id),
    onSuccess: invalidateAll
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectApprovalRequest(id),
    onSuccess: invalidateAll
  });
  const reconnectSessionMutation = useMutation({
    mutationFn: ({ sessionId, note }: { sessionId: string; note?: string }) =>
      reconnectAgentRuntimeSession(sessionId, note),
    onSuccess: invalidateAll
  });
  const disconnectSessionMutation = useMutation({
    mutationFn: ({
      sessionId,
      note,
      lastError
    }: {
      sessionId: string;
      note?: string;
      lastError?: string | null;
    }) => disconnectAgentRuntimeSession(sessionId, { note, lastError }),
    onSuccess: invalidateAll
  });
  const logWorkMutation = useMutation({
    mutationFn: logOperatorWork,
    onSuccess: invalidateAll
  });

  // ── Derived data ─────────────────────────────────────────────────────────
  const settings = settingsQuery.data?.settings;
  const approvals = approvalsQuery.data?.approvalRequests ?? [];
  const onboarding = onboardingQuery.data?.onboarding;
  const runtimeSessions = useMemo(
    () => runtimeSessionsQuery.data?.sessions ?? [],
    [runtimeSessionsQuery.data?.sessions]
  );
  const runtimeSessionGroups = useMemo(
    () => groupRuntimeSessions(runtimeSessions),
    [runtimeSessions]
  );
  const runtimeSessionHistory = runtimeSessionHistoryQuery.data;
  const operatorContext = operatorContextQuery.data?.context;

  const activeTokens =
    settings?.agentTokens.filter((t) => t.status === "active") ?? [];
  const recommendedScopes = onboarding?.recommendedScopes ?? [];
  const hasFullOperatorToken =
    Boolean(onboarding) &&
    recommendedScopes.length > 0 &&
    activeTokens.some((t) => tokenHasScopes(t, recommendedScopes));
  const hasRewardManager = activeTokens.some((t) =>
    tokenHasScopes(t, ["rewards.manage"])
  );
  const hasPsycheWriter = activeTokens.some((t) =>
    tokenHasScopes(t, ["psyche.write"])
  );
  const hasScopedWriter = activeTokens.some(
    (t) =>
      t.autonomyMode !== "approval_required" && tokenHasScopes(t, ["write"])
  );
  const hasAnyToken = activeTokens.length > 0;
  const connectedRuntimeSessions = runtimeSessionGroups.filter(
    (group) => group.status === "connected"
  );
  const staleRuntimeSessions = runtimeSessionGroups.filter(
    (group) => group.status === "stale"
  );

  const operatorTasks = useMemo(() => {
    if (!operatorContext) return [] as Task[];
    const pool = [
      ...operatorContext.focusTasks,
      ...operatorContext.currentBoard.backlog,
      ...operatorContext.currentBoard.focus,
      ...operatorContext.currentBoard.inProgress,
      ...operatorContext.currentBoard.blocked,
      ...operatorContext.currentBoard.done
    ];
    const unique = new Map<string, Task>();
    for (const task of pool) unique.set(task.id, task);
    return [...unique.values()];
  }, [operatorContext]);

  const defaultOwner = settings?.profile.operatorName ?? "";

  // Capability rows — each has an action button when not configured
  const capabilities = [
    {
      label: "Operator session",
      ok: true,
      badge: "active",
      badgeTone: "emerald",
      detail: operatorSessionQuery.data?.session
        ? `Session open as ${operatorSessionQuery.data.session.actorLabel}. Direct localhost access is verified through the local owner helper.`
        : "Direct localhost access is verified through the local owner helper.",
      action: null
    },
    {
      label: "Agent token",
      ok: hasAnyToken,
      badge: hasAnyToken ? `${activeTokens.length} active` : "none issued",
      badgeTone: hasAnyToken ? "emerald" : "amber",
      detail: hasAnyToken
        ? `${activeTokens.length} active compatibility token${activeTokens.length === 1 ? "" : "s"} allow scoped external API access.`
        : "No compatibility token is active. Remote clients still require a Forge-issued scoped credential.",
      action: hasAnyToken
        ? null
        : {
            label: "Issue token",
            preset: "operator" as const,
            onClick: () => {
              setTokenDialogPreset("operator");
              setTokenDialogOpen(true);
            }
          }
    },
    {
      label: "Full operator bundle",
      ok: hasFullOperatorToken,
      badge: hasFullOperatorToken ? "ready" : "optional",
      badgeTone: hasFullOperatorToken ? "emerald" : "neutral",
      detail: hasFullOperatorToken
        ? "A token covers all recommended scopes for full operator collaboration."
        : "No token covers the full recommended scope bundle. Issue one to unlock complete agent collaboration.",
      action: hasFullOperatorToken
        ? null
        : {
            label: "Set up",
            preset: "operator" as const,
            onClick: () => {
              setTokenDialogPreset("operator");
              setTokenDialogOpen(true);
            }
          }
    },
    {
      label: "Reward control",
      ok: hasRewardManager,
      badge: hasRewardManager ? "ready" : "optional",
      badgeTone: hasRewardManager ? "emerald" : "neutral",
      detail: hasRewardManager
        ? "An agent can tune reward rules and issue bonus XP grants."
        : "No token has rewards.manage — agents cannot adjust XP rules or issue bonuses.",
      action: hasRewardManager
        ? null
        : {
            label: "Add scope",
            preset: "operator" as const,
            onClick: () => {
              setTokenDialogPreset("operator");
              setTokenDialogOpen(true);
            }
          }
    },
    {
      label: "Psyche writes",
      ok: hasPsycheWriter,
      badge: hasPsycheWriter ? "ready" : "optional",
      badgeTone: hasPsycheWriter ? "emerald" : "neutral",
      detail: hasPsycheWriter
        ? "Sensitive Psyche collaboration is enabled — agents can create and update therapeutic records."
        : "No token has psyche.write — agent collaboration on sensitive Psyche records is disabled.",
      action: hasPsycheWriter
        ? null
        : {
            label: "Add scope",
            preset: "operator" as const,
            onClick: () => {
              setTokenDialogPreset("operator");
              setTokenDialogOpen(true);
            }
          }
    },
    {
      label: "Scoped writes",
      ok: hasScopedWriter,
      badge: hasScopedWriter ? "ready" : "optional",
      badgeTone: hasScopedWriter ? "emerald" : "neutral",
      detail: hasScopedWriter
        ? "A trusted agent can write without constant approval prompts."
        : "All write tokens are approval-required. Agents must queue every mutation for your review.",
      action: hasScopedWriter
        ? null
        : {
            label: "Configure",
            preset: "operator" as const,
            onClick: () => {
              setTokenDialogPreset("operator");
              setTokenDialogOpen(true);
            }
          }
    }
  ] as const;

  // ── Loading / error gates ─────────────────────────────────────────────────
  if (operatorSessionQuery.isLoading || settingsQuery.isLoading) {
    return (
      <SettingsStateFrame>
        <SurfaceSkeleton
          eyebrow="Settings · Agents"
          title="Loading agent console"
          description="Establishing the operator session and loading agent configuration."
          columns={2}
          blocks={6}
        />
      </SettingsStateFrame>
    );
  }

  if (operatorSessionQuery.isError) {
    return (
      <SettingsStateFrame>
        <ErrorState
          eyebrow="Settings · Agents"
          error={operatorSessionQuery.error}
          onRetry={() => void operatorSessionQuery.refetch()}
        />
      </SettingsStateFrame>
    );
  }

  if (settingsQuery.isError || !settings) {
    return (
      <SettingsStateFrame>
        <ErrorState
          eyebrow="Settings · Agents"
          error={settingsQuery.error ?? new Error("Could not load settings.")}
          onRetry={() => void settingsQuery.refetch()}
        />
      </SettingsStateFrame>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1220px] gap-5">
      <PageHero
        title="Agents"
        description="Connection status, capability access, tokens, approval queue, and work logging."
      />

      <SettingsSectionNav />

      {/* ── Dialogs ── */}
      <AgentTokenFlowDialog
        open={tokenDialogOpen}
        onOpenChange={setTokenDialogOpen}
        pending={tokenMutation.isPending}
        initialPreset={tokenDialogPreset}
        defaultAgentLabel={onboarding?.defaultActorLabel ?? "OpenClaw"}
        recommendedScopes={recommendedScopes}
        onSubmit={async (input) => {
          if (!onboarding) {
            throw new Error(
              "Live onboarding must load before Forge can issue and reveal a correctly scoped token."
            );
          }
          const result = await tokenMutation.mutateAsync(input);
          // Close the wizard and open the reveal dialog
          setTokenDialogOpen(false);
          setRevealState({
            tokenString: result.token.token,
            agentLabel: input.agentLabel,
            onboarding
          });
          setRevealDialogOpen(true);
        }}
      />
      <TokenRevealDialog
        open={revealDialogOpen}
        onOpenChange={setRevealDialogOpen}
        state={revealState}
      />
      <LogWorkFlowDialog
        open={logWorkDialogOpen}
        onOpenChange={setLogWorkDialogOpen}
        pending={logWorkMutation.isPending}
        defaultOwner={defaultOwner}
        availableTasks={operatorTasks}
        availableProjects={operatorContext?.activeProjects ?? []}
        onSubmit={async (input) => {
          await logWorkMutation.mutateAsync(input);
        }}
      />

      <div className="grid gap-5">
        {operatorSessionQuery.data?.session.profile === "operator" ? (
          <RemotePairingApprovalCard />
        ) : null}
        {onboardingQuery.isError ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)]">
            <div className="text-sm leading-6 text-[var(--danger)]">
              Live onboarding is unavailable. Token issue and rotation are
              paused so Forge cannot reveal a credential with stale scopes or
              incomplete adapter guidance.
            </div>
            <Button
              variant="secondary"
              onClick={() => void onboardingQuery.refetch()}
            >
              Retry onboarding
            </Button>
          </Card>
        ) : null}
        {credentialFeedback ? (
          <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-medium)]">
            {credentialFeedback}
          </div>
        ) : null}
        {/* ── Operator console overview ── */}
        {operatorContext ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              label="Active sessions"
              value={connectedRuntimeSessions.length}
              tone="core"
            />
            <MetricTile
              label="Stale sessions"
              value={staleRuntimeSessions.length}
              tone="core"
            />
            <MetricTile
              label="Pending approvals"
              value={approvals.filter((a) => a.status === "pending").length}
              tone="core"
            />
            <MetricTile
              label="Operator level"
              value={operatorContext.xp.profile.level}
              tone="core"
              detail={`${operatorContext.xp.profile.totalXp} total XP`}
            />
          </div>
        ) : null}

        {/* ── Capability status ── */}
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
            Capability status
          </div>
          <div className="mt-4 grid gap-3">
            {capabilities.map((cap) => (
              <div
                key={cap.label}
                className="flex items-start justify-between gap-4 rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="font-medium text-[var(--ui-ink-strong)]">
                      {cap.label}
                    </span>
                    <Badge
                      className={
                        cap.badgeTone === "emerald"
                          ? "text-[color-mix(in_srgb,var(--success)_78%,var(--ui-ink-strong)_22%)]"
                          : cap.badgeTone === "amber"
                            ? "text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]"
                            : "text-[var(--ui-ink-muted)]"
                      }
                    >
                      {cap.badge}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm leading-6 text-[var(--ui-ink-muted)]">
                    {cap.detail}
                  </div>
                </div>
                {cap.action ? (
                  <button
                    type="button"
                    disabled={!onboarding}
                    onClick={cap.action.onClick}
                    className="mt-0.5 flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--ui-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cap.action.label}
                    <ArrowRight className="size-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Runtime sessions
              </div>
              <div className="mt-1 text-sm text-[var(--ui-ink-muted)]">
                Live OpenClaw, Hermes, Codex, and Claude Code sessions
                registered against this Forge runtime, with stale detection and
                reconnect guidance.
              </div>
            </div>
            {runtimeSessionGroups.length > 0 ? (
              <Badge className="text-[var(--ui-ink-medium)]">
                {connectedRuntimeSessions.length} live ·{" "}
                {staleRuntimeSessions.length} stale
              </Badge>
            ) : null}
          </div>
          <div className="mt-4 grid gap-3">
            {runtimeSessionsQuery.isLoading ? (
              <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-4 text-sm text-[var(--ui-ink-muted)]">
                Loading agent runtime sessions…
              </div>
            ) : runtimeSessionGroups.length === 0 ? (
              <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-4 text-sm text-[var(--ui-ink-muted)]">
                No runtime sessions have registered yet. OpenClaw, Hermes, and
                Codex now self-register here when their Forge adapter starts.
              </div>
            ) : (
              runtimeSessionGroups.map((group) => {
                const session = group.primary;
                return (
                  <div
                    key={group.key}
                    className="min-w-0 rounded-[18px] bg-[var(--ui-surface-2)] p-4"
                  >
                    <AttentionSourceReturn
                      sourceRef={`agent_runtime_session:${session.id}`}
                    />
                    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                          <div className="font-medium text-[var(--ui-ink-strong)]">
                            {group.agentLabel}
                          </div>
                          <Badge className={runtimeStatusTone(group.status)}>
                            {group.status}
                          </Badge>
                        </div>
                        <div className="mt-1 text-sm text-[var(--ui-ink-muted)]">
                          {group.provider} ·{" "}
                          {session.connectionMode.replaceAll("_", " ")} · last
                          heartbeat {formatDateTime(session.lastHeartbeatAt)}
                        </div>
                        <div className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ui-ink-muted)]">
                          <span>
                            {group.sessions.length} runtime session
                            {group.sessions.length === 1 ? "" : "s"}
                          </span>
                          <span className="min-w-0 break-all">
                            Current key {session.sessionKey}
                          </span>
                          <span>{group.actionCount} recorded actions</span>
                          <span>{group.eventCount} session events</span>
                        </div>
                        {session.lastError ? (
                          <div className="mt-3 text-sm text-[color-mix(in_srgb,var(--danger)_78%,var(--ui-ink-strong)_22%)]">
                            {session.lastError}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex min-w-0 flex-wrap gap-2 lg:shrink-0 lg:justify-end">
                        {group.status !== "connected" ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="flex-1 sm:flex-none"
                            pending={reconnectSessionMutation.isPending}
                            pendingLabel="Requesting"
                            onClick={() =>
                              reconnectSessionMutation.mutate({
                                sessionId: session.id
                              })
                            }
                          >
                            Reconnect
                          </Button>
                        ) : null}
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex-1 sm:flex-none"
                          onClick={() =>
                            setExpandedRuntimeSessionId((current) =>
                              current === session.id ? null : session.id
                            )
                          }
                        >
                          {expandedRuntimeSessionId === session.id
                            ? "Hide history"
                            : "View history"}
                        </Button>
                        {group.status !== "disconnected" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1 sm:flex-none"
                            pending={disconnectSessionMutation.isPending}
                            pendingLabel="Closing"
                            onClick={() =>
                              disconnectSessionMutation.mutate({
                                sessionId: session.id,
                                note: "Marked disconnected from the Forge agents console."
                              })
                            }
                          >
                            Mark offline
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {session.recentEvents.length > 0 ? (
                      <div className="mt-4 grid gap-2">
                        {session.recentEvents
                          .slice(0, 3)
                          .map((event: AgentRuntimeSessionEvent) => (
                            <div
                              key={event.id}
                              className="flex items-start justify-between gap-3 rounded-[16px] bg-[var(--ui-surface-2)] px-3 py-2.5"
                            >
                              <div className="min-w-0">
                                <div className="text-sm text-[var(--ui-ink-strong)]">
                                  {event.title}
                                </div>
                                <div className="mt-0.5 text-xs leading-5 text-[var(--ui-ink-muted)]">
                                  {event.summary || event.eventType}
                                </div>
                              </div>
                              <div className="shrink-0 text-xs text-[var(--ui-ink-muted)]">
                                {formatDateTime(event.createdAt)}
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : null}

                    <div className="mt-4 rounded-[16px] bg-[var(--ui-code-bg)] p-3">
                      <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                        Reconnect plan
                      </div>
                      <div className="mt-2 text-sm text-[var(--ui-ink-medium)]">
                        {session.reconnectPlan.summary}
                      </div>
                      <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-[var(--ui-ink-medium)] md:overflow-x-auto md:whitespace-pre">
                        <code className="break-words">
                          {session.reconnectPlan.commands.join("\n")}
                        </code>
                      </pre>
                    </div>

                    {group.sessions.length > 1 ? (
                      <div className="mt-4 rounded-[16px] bg-[var(--ui-code-bg)] p-3">
                        <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                          Session history under this agent
                        </div>
                        <div className="mt-2 grid gap-2">
                          {group.sessions.slice(0, 6).map((entry) => (
                            <div
                              key={entry.id}
                              className="grid min-w-0 gap-1 rounded-[12px] bg-[var(--ui-surface-2)] px-3 py-2 text-xs text-[var(--ui-ink-muted)] sm:flex sm:items-center sm:justify-between sm:gap-2"
                            >
                              <span className="min-w-0 break-all sm:truncate">
                                {entry.sessionKey}
                              </span>
                              <span
                                className={`${runtimeStatusTone(entry.status)} min-w-0 break-words sm:shrink-0`}
                              >
                                {entry.status} ·{" "}
                                {formatDateTime(entry.lastHeartbeatAt)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {expandedRuntimeSessionId === session.id ? (
                      <div className="mt-4 rounded-[16px] bg-[var(--ui-code-bg)] p-3">
                        <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                          Work history
                        </div>
                        {runtimeSessionHistoryQuery.isLoading ? (
                          <div className="mt-3 text-sm text-[var(--ui-ink-muted)]">
                            Loading session history…
                          </div>
                        ) : runtimeSessionHistoryQuery.isError ? (
                          <div className="mt-3 text-sm text-[color-mix(in_srgb,var(--danger)_78%,var(--ui-ink-strong)_22%)]">
                            Could not load session history.
                          </div>
                        ) : runtimeSessionHistory?.session.id === session.id ? (
                          <div className="mt-3 grid gap-4 lg:grid-cols-2">
                            <div>
                              <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                                Agent actions
                              </div>
                              <div className="mt-2 grid gap-2">
                                {runtimeSessionHistory.actions.length > 0 ? (
                                  runtimeSessionHistory.actions.map(
                                    (action: AgentAction) => (
                                      <div
                                        key={action.id}
                                        className="rounded-[14px] bg-[var(--ui-surface-2)] px-3 py-2.5"
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="text-sm text-[var(--ui-ink-strong)]">
                                            {action.title}
                                          </div>
                                          <Badge className="text-[var(--ui-ink-muted)]">
                                            {action.status}
                                          </Badge>
                                        </div>
                                        <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-muted)]">
                                          {action.summary || action.actionType}
                                        </div>
                                        <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                                          {formatDateTime(action.createdAt)}
                                        </div>
                                      </div>
                                    )
                                  )
                                ) : (
                                  <div className="rounded-[14px] bg-[var(--ui-surface-2)] px-3 py-2.5 text-sm text-[var(--ui-ink-muted)]">
                                    No recorded agent actions for this session
                                    yet.
                                  </div>
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                                Session events
                              </div>
                              <div className="mt-2 grid gap-2">
                                {runtimeSessionHistory.events.length > 0 ? (
                                  runtimeSessionHistory.events.map(
                                    (event: AgentRuntimeSessionEvent) => (
                                      <div
                                        key={event.id}
                                        className="rounded-[14px] bg-[var(--ui-surface-2)] px-3 py-2.5"
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="text-sm text-[var(--ui-ink-strong)]">
                                            {event.title}
                                          </div>
                                          <Badge className="text-[var(--ui-ink-muted)]">
                                            {event.level}
                                          </Badge>
                                        </div>
                                        <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-muted)]">
                                          {event.summary || event.eventType}
                                        </div>
                                        <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                                          {formatDateTime(event.createdAt)}
                                        </div>
                                      </div>
                                    )
                                  )
                                ) : (
                                  <div className="rounded-[14px] bg-[var(--ui-surface-2)] px-3 py-2.5 text-sm text-[var(--ui-ink-muted)]">
                                    No session events recorded yet.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* ── Token management ── */}
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
              Agent tokens
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!onboarding}
              onClick={() => {
                setTokenDialogPreset("operator");
                setTokenDialogOpen(true);
              }}
            >
              <Plus className="size-3.5" />
              Issue token
            </Button>
          </div>

          <div className="mt-4 grid gap-3">
            {settings.agentTokens.length === 0 ? (
              <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-4 text-sm text-[var(--ui-ink-muted)]">
                No tokens yet. Issue one to let external agents or scripts
                authenticate with Forge.
              </div>
            ) : (
              settings.agentTokens.map((token) => (
                <div
                  key={token.id}
                  className="min-w-0 rounded-[18px] bg-[var(--ui-surface-2)] p-4"
                >
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--ui-ink-strong)]">
                        {token.label}
                      </div>
                      <div className="mt-0.5 text-sm text-[var(--ui-ink-muted)]">
                        {token.agentLabel ?? "Unassigned agent"} ·{" "}
                        <span className="break-all font-mono text-xs">
                          {token.tokenPrefix}
                        </span>
                      </div>
                    </div>
                    <Badge
                      className={`${token.status === "active" ? "text-[color-mix(in_srgb,var(--success)_78%,var(--ui-ink-strong)_22%)]" : "text-[var(--ui-ink-muted)]"} self-start`}
                    >
                      {token.status}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--ui-ink-muted)]">
                    <span>{token.trustLevel}</span>
                    <span>·</span>
                    <span>{token.autonomyMode.replaceAll("_", " ")}</span>
                    <span>·</span>
                    <span>{token.approvalMode.replaceAll("_", " ")}</span>
                  </div>
                  <div className="mt-2 text-xs text-[var(--ui-ink-muted)]">
                    Bootstrap: {formatBootstrapMode(token.bootstrapPolicy.mode)}
                    {" · "}
                    {token.bootstrapPolicy.projectsLimit} projects
                    {" · "}
                    {token.bootstrapPolicy.tasksLimit} tasks
                    {token.bootstrapPolicy.includePeoplePages
                      ? ` · ${token.bootstrapPolicy.peoplePageLimit} people pages`
                      : " · no people pages"}
                  </div>
                  <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                    Default read scope: {formatScopeSummary(token)}
                  </div>
                  <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                    Identity: {token.agentId ?? "unlinked"} · Last used:{" "}
                    {formatDateTime(token.lastUsedAt)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {token.scopes.map((scope) => (
                      <Badge
                        key={scope}
                        className="text-[color-mix(in_srgb,var(--success)_78%,var(--ui-ink-strong)_22%)]"
                      >
                        {scope}
                      </Badge>
                    ))}
                  </div>
                  {token.status === "active" ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        pending={rotateMutation.isPending}
                        pendingLabel="Rotating"
                        disabled={!onboarding}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Rotate ${token.label}? The current token stops working immediately and the replacement is shown only once.`
                            )
                          ) {
                            rotateMutation.mutate(token.id);
                          }
                        }}
                      >
                        Rotate &amp; reveal new token
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        pending={revokeMutation.isPending}
                        pendingLabel="Revoking"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Revoke ${token.label}? Existing callers using this token will lose access immediately.`
                            )
                          ) {
                            revokeMutation.mutate(token.id);
                          }
                        }}
                      >
                        Revoke
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-4 text-xs text-[var(--ui-ink-muted)]">
                      Revoked credentials cannot be rotated or reused. Issue a
                      new token if this agent needs access again.
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="mt-3 px-1 text-xs text-[var(--ui-ink-muted)]">
            Raw token values are shown once and are never recoverable. If a
            token is lost, rotate or issue a new one.
          </div>
        </Card>

        {/* ── Agent roster ── */}
        {settings.agents.length > 0 ? (
          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
              Connected agents
            </div>
            <div className="mt-4 grid gap-3">
              {settings.agents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex min-w-0 flex-col gap-3 rounded-[18px] bg-[var(--ui-surface-2)] p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--ui-ink-strong)]">
                      {agent.label}
                    </div>
                    {agent.description ? (
                      <div className="mt-1 text-sm text-[var(--ui-ink-muted)]">
                        {agent.description}
                      </div>
                    ) : null}
                    {agent.linkedUsers.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {agent.linkedUsers.map((link) => (
                          <Badge
                            key={link.userId}
                            className="text-[var(--ui-ink-muted)]"
                          >
                            {link.user?.displayName ?? link.userId}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--ui-ink-muted)]">
                      <span>{agent.agentType}</span>
                      {agent.identityKey ? (
                        <span className="min-w-0 break-all font-mono text-xs">
                          {agent.identityKey}
                        </span>
                      ) : null}
                      <span>{agent.autonomyMode.replaceAll("_", " ")}</span>
                      <span>
                        {agent.activeTokenCount} active token
                        {agent.activeTokenCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <Badge className="self-start text-[var(--ui-ink-medium)]">
                    {agent.trustLevel}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {/* ── Board overview ── */}
        {operatorContext ? (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <Card>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Recommended next move
              </div>
              {operatorContext.recommendedNextTask ? (
                <div className="mt-4 grid gap-2">
                  <EntityName
                    kind="task"
                    label={operatorContext.recommendedNextTask.title}
                    variant="heading"
                    size="lg"
                  />
                  <div className="text-sm leading-6 text-[var(--ui-ink-muted)]">
                    {operatorContext.recommendedNextTask.description ||
                      "No extra notes yet."}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge>
                      {operatorContext.recommendedNextTask.status.replaceAll(
                        "_",
                        " "
                      )}
                    </Badge>
                    <Badge>
                      {operatorContext.recommendedNextTask.points} xp
                    </Badge>
                    <Badge>{operatorContext.recommendedNextTask.owner}</Badge>
                  </div>
                </div>
              ) : (
                <div className="mt-4 text-sm text-[var(--ui-ink-muted)]">
                  Board is clear. No recommended task right now.
                </div>
              )}
            </Card>
            <Card>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Board pulse
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  {
                    label: "Backlog",
                    value: operatorContext.currentBoard.backlog.length
                  },
                  {
                    label: "Focus",
                    value: operatorContext.currentBoard.focus.length
                  },
                  {
                    label: "In progress",
                    value: operatorContext.currentBoard.inProgress.length
                  },
                  {
                    label: "Blocked",
                    value: operatorContext.currentBoard.blocked.length
                  }
                ].map((col) => (
                  <div
                    key={col.label}
                    className="rounded-[18px] bg-[var(--ui-surface-2)] p-4"
                  >
                    <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                      {col.label}
                    </div>
                    <div className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
                      {col.value}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : null}

        {/* ── Active projects ── */}
        {operatorContext && operatorContext.activeProjects.length > 0 ? (
          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
              Active projects
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {operatorContext.activeProjects.slice(0, 6).map((project) => (
                <div
                  key={project.id}
                  className="min-w-0 rounded-[18px] bg-[var(--ui-surface-2)] p-4"
                >
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <EntityName kind="project" label={project.title} />
                    </div>
                    <Badge className="self-start">{project.progress}%</Badge>
                  </div>
                  <div className="mt-2">
                    <EntityBadge
                      kind="goal"
                      label={project.goalTitle}
                      compact
                      gradient={false}
                    />
                  </div>
                  <div className="mt-2 text-xs text-[var(--ui-ink-muted)]">
                    {project.activeTaskCount} active ·{" "}
                    {project.completedTaskCount} done
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {/* ── Approval queue ── */}
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
              Approval queue
            </div>
            {approvals.filter((a) => a.status === "pending").length > 0 ? (
              <Badge className="text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]">
                {approvals.filter((a) => a.status === "pending").length} pending
              </Badge>
            ) : null}
          </div>
          <div className="mt-4 grid gap-3">
            {approvals.length === 0 ? (
              <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-4 text-sm text-[var(--ui-ink-muted)]">
                No pending approvals. Agent actions are flowing through.
              </div>
            ) : (
              approvals.map((approval) => (
                <div
                  key={approval.id}
                  className="rounded-[18px] bg-[var(--ui-surface-2)] p-4"
                >
                  <AttentionSourceReturn
                    sourceRef={`approval_request:${approval.id}`}
                  />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--ui-ink-strong)]">
                        {approval.title}
                      </div>
                      <div className="mt-0.5 text-sm text-[var(--ui-ink-muted)]">
                        {approval.summary || approval.actionType}
                      </div>
                    </div>
                    <Badge
                      className={
                        approval.status === "pending"
                          ? "text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]"
                          : "text-[var(--ui-ink-muted)]"
                      }
                    >
                      {approval.status}
                    </Badge>
                  </div>
                  {approval.status === "pending" ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        pending={approveMutation.isPending}
                        pendingLabel="Approving"
                        onClick={() => approveMutation.mutate(approval.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        pending={rejectMutation.isPending}
                        pendingLabel="Rejecting"
                        onClick={() => rejectMutation.mutate(approval.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Card>

        {/* ── Log work ── */}
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Retroactive work log
              </div>
              <div className="mt-1 text-sm text-[var(--ui-ink-muted)]">
                Capture work done outside the timer so it counts toward progress
                and XP.
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setLogWorkDialogOpen(true)}
            >
              <ClipboardList className="size-3.5" />
              Log work
            </Button>
          </div>
          {logWorkMutation.data ? (
            <div className="mt-4 rounded-[18px] bg-[var(--ui-accent-soft)] px-4 py-3 text-sm text-[var(--ui-ink-strong)]">
              Logged{" "}
              <span className="inline-block align-middle">
                <EntityName
                  kind="task"
                  label={logWorkMutation.data.task.title}
                  showKind={false}
                />
              </span>
              . Operator XP updated to {logWorkMutation.data.xp.profile.totalXp}
              .
            </div>
          ) : null}
        </Card>

        {/* ── Connection & onboarding info ── */}
        <Card>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 text-left"
            onClick={() => setOnboardingExpanded((v) => !v)}
          >
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Connection &amp; onboarding
              </div>
              {onboarding ? (
                <div className="mt-1 text-sm text-[var(--ui-ink-muted)]">
                  {onboarding.forgeBaseUrl}
                </div>
              ) : null}
            </div>
            {onboardingExpanded ? (
              <ChevronUp className="size-4 shrink-0 text-[var(--ui-ink-muted)]" />
            ) : (
              <ChevronDown className="size-4 shrink-0 text-[var(--ui-ink-muted)]" />
            )}
          </button>

          {onboardingExpanded && onboarding ? (
            <div className="mt-5 grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                    Forge API
                  </div>
                  <div className="mt-2 break-all text-sm text-[var(--ui-ink-strong)]">
                    {onboarding.forgeBaseUrl}
                  </div>
                </div>
                <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                    Web app
                  </div>
                  <div className="mt-2 break-all text-sm text-[var(--ui-ink-strong)]">
                    {onboarding.webAppUrl}
                  </div>
                </div>
                <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                    OpenAPI spec
                  </div>
                  <div className="mt-2 break-all text-sm text-[var(--ui-ink-strong)]">
                    {onboarding.openApiUrl}
                  </div>
                </div>
                <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                    Default policy
                  </div>
                  <div className="mt-2 text-sm text-[var(--ui-ink-strong)]">
                    {onboarding.recommendedTrustLevel} ·{" "}
                    {onboarding.recommendedAutonomyMode.replaceAll("_", " ")} ·{" "}
                    {onboarding.recommendedApprovalMode.replaceAll("_", " ")}
                  </div>
                  <div className="mt-2 text-xs text-[var(--ui-ink-muted)]">
                    Bootstrap default:{" "}
                    {formatBootstrapMode(
                      onboarding.defaultBootstrapPolicy.mode
                    )}
                    {" · "}
                    {onboarding.defaultBootstrapPolicy.projectsLimit} projects
                    {" · "}
                    {onboarding.defaultBootstrapPolicy.tasksLimit} tasks
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                  <div className="font-medium text-[var(--ui-ink-strong)]">
                    {onboarding.authModes.operatorSession.label}
                  </div>
                  <Badge className="mt-1 text-[color-mix(in_srgb,var(--success)_78%,var(--ui-ink-strong)_22%)]">
                    {onboarding.defaultConnectionMode === "operator_session"
                      ? "default"
                      : "available"}
                  </Badge>
                  <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    {onboarding.authModes.operatorSession.summary}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {onboarding.authModes.operatorSession.trustedTargets.map(
                      (t) => (
                        <Badge key={t} className="text-[var(--ui-ink-medium)]">
                          {t}
                        </Badge>
                      )
                    )}
                  </div>
                </div>
                <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                  <div className="font-medium text-[var(--ui-ink-strong)]">
                    {onboarding.authModes.managedToken.label}
                  </div>
                  <Badge className="mt-1 text-[var(--ui-ink-muted)]">
                    optional
                  </Badge>
                  <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    {onboarding.authModes.managedToken.summary}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-muted)]">
                    {onboarding.tokenRecovery.rotationSummary}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                    Shared runtime
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    Keep Forge, OpenClaw, Hermes, and the browser on the same
                    runtime when they should see one shared user directory, one
                    strategy graph, and one task history.
                  </div>
                  <div className="mt-3 text-xs leading-5 text-[var(--ui-ink-muted)]">
                    Base URL: {onboarding.forgeBaseUrl}
                  </div>
                </div>
                <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                    Agent identity
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    Create each agent as a bot user, then write with that
                    user&apos;s `userId`. The relationship graph in Settings
                    -&gt; Users controls what each direction can see, message,
                    share, plan, and affect.
                  </div>
                  <div className="mt-3 text-xs leading-5 text-[var(--ui-ink-muted)]">
                    Cross-owner links stay valid even when ownership differs.
                  </div>
                </div>
                <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                    Contract timing
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    Leave strategies editable while humans and bots refine the
                    graph. Lock them only when the plan becomes the contract the
                    alignment metrics should judge.
                  </div>
                  <div className="mt-3 text-xs leading-5 text-[var(--ui-ink-muted)]">
                    Coverage, sequencing, scope discipline, and quality all
                    contribute to alignment now.
                  </div>
                </div>
              </div>

              <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                  Fast onboarding checklist
                </div>
                <div className="mt-3 grid gap-2 text-sm leading-6 text-[var(--ui-ink-medium)]">
                  <div>
                    1. Create the human and bot users in Settings -&gt; Users.
                  </div>
                  <div>
                    2. Keep the default graph permissive until collaboration is
                    flowing cleanly.
                  </div>
                  <div>
                    3. Point OpenClaw and Hermes at the same Forge runtime and
                    storage root when they should collaborate.
                  </div>
                  <div>
                    4. Give each adapter a distinct actor label so activity
                    stays readable.
                  </div>
                  <div>
                    5. Build strategies as drafts first, then lock when the plan
                    is ready to become the contract.
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                    Rights language
                  </div>
                  <div className="mt-3 grid gap-2 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    <div>
                      `See` means discover, search, and read another owner.
                    </div>
                    <div>
                      `Message` means coordinate and hand off through Forge.
                    </div>
                    <div>
                      `Plan` means draft or edit that owner&apos;s strategies.
                    </div>
                    <div>
                      `Affect` means create or mutate that owner&apos;s work.
                    </div>
                  </div>
                </div>
                <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                    Strategy lifecycle
                  </div>
                  <div className="mt-3 grid gap-2 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    <div>
                      1. Save an incomplete draft while the plan is still being
                      negotiated.
                    </div>
                    <div>
                      2. Let humans and bots refine targets, nodes, and sequence
                      together.
                    </div>
                    <div>
                      3. Lock only when the graph becomes the contract for
                      alignment.
                    </div>
                    <div>
                      4. Unlock only when the contract itself is being
                      renegotiated.
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                  Quick-connect verification
                </div>
                <pre className="mt-3 overflow-x-auto rounded-[16px] bg-[var(--ui-code-bg)] p-4 text-xs leading-6 text-[var(--ui-ink-medium)]">
                  <code>
                    {[
                      `curl -s ${onboarding.healthUrl}`,
                      `openclaw plugins install ./projects/forge`,
                      "openclaw gateway restart"
                    ].join("\n")}
                  </code>
                </pre>
              </div>

              <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                  Required API headers
                </div>
                <div className="mt-3 grid gap-1 text-sm text-[var(--ui-ink-medium)]">
                  <div>{onboarding.requiredHeaders.authorization}</div>
                  <div>{onboarding.requiredHeaders.source}</div>
                  <div>{onboarding.requiredHeaders.actor}</div>
                </div>
              </div>

              <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                  Session registry
                </div>
                <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                  {onboarding.sessionRegistry.summary}
                </div>
                <div className="mt-3 grid gap-1 text-xs leading-5 text-[var(--ui-ink-muted)]">
                  <div>Register: {onboarding.sessionRegistry.registerUrl}</div>
                  <div>
                    Heartbeat: {onboarding.sessionRegistry.heartbeatUrl}
                  </div>
                  <div>Events: {onboarding.sessionRegistry.eventsUrl}</div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {(
                  [
                    onboarding.connectionGuides.openclaw,
                    onboarding.connectionGuides.hermes,
                    onboarding.connectionGuides.codex
                  ] as const
                ).map((guide) => (
                  <div
                    key={guide.label}
                    className="rounded-[18px] bg-[var(--ui-surface-2)] p-4"
                  >
                    <div className="font-medium text-[var(--ui-ink-strong)]">
                      {guide.label}
                    </div>
                    <div className="mt-3 grid gap-2 text-sm leading-6 text-[var(--ui-ink-medium)]">
                      {guide.installSteps.map((step) => (
                        <div key={step}>{step}</div>
                      ))}
                    </div>
                    <pre className="mt-4 overflow-x-auto rounded-[16px] bg-[var(--ui-code-bg)] p-4 text-xs leading-6 text-[var(--ui-ink-medium)]">
                      <code>{guide.verifyCommands.join("\n")}</code>
                    </pre>
                    <div className="mt-3 grid gap-1 text-sm leading-6 text-[var(--ui-ink-muted)]">
                      {guide.configNotes.map((note) => (
                        <div key={note}>{note}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                    Multi-user model
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    {onboarding.multiUserModel.summary}
                  </div>
                  <div className="mt-3 grid gap-1 text-sm leading-6 text-[var(--ui-ink-muted)]">
                    {onboarding.multiUserModel.routeScoping.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                </div>
                <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                    Strategy contracts
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    {onboarding.strategyContractModel.lockSummary}
                  </div>
                  <div className="mt-3 grid gap-1 text-sm leading-6 text-[var(--ui-ink-muted)]">
                    {onboarding.strategyContractModel.metricBreakdown.map(
                      (line) => (
                        <div key={line}>{line}</div>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : onboardingExpanded && onboardingQuery.isError ? (
            <div className="mt-4 rounded-[18px] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[color-mix(in_srgb,var(--danger)_78%,var(--ui-ink-strong)_22%)]">
              Could not load the onboarding contract. Check the API bridge.
            </div>
          ) : onboardingExpanded ? (
            <div className="mt-4 text-sm text-[var(--ui-ink-muted)]">
              Loading…
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
