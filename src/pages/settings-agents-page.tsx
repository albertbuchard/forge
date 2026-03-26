import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, ChevronUp, ClipboardList, Plus } from "lucide-react";
import { AgentTokenFlowDialog } from "@/components/settings/agent-token-flow-dialog";
import { LogWorkFlowDialog } from "@/components/settings/log-work-flow-dialog";
import { TokenRevealDialog, type TokenRevealState } from "@/components/settings/token-reveal-dialog";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
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
  ensureOperatorSession,
  getAgentOnboarding,
  getOperatorContext,
  getSettings,
  listApprovalRequests,
  logOperatorWork,
  rejectApprovalRequest,
  revokeAgentToken,
  rotateAgentToken
} from "@/lib/api";
import type { AgentTokenSummary, Task } from "@/lib/types";
import type { CreateAgentTokenInput } from "@/lib/schemas";

function tokenHasScopes(token: AgentTokenSummary, scopes: readonly string[]) {
  return scopes.every((scope) => token.scopes.includes(scope));
}

export function SettingsAgentsPage() {
  const queryClient = useQueryClient();

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [tokenDialogPreset, setTokenDialogPreset] = useState<"review" | "operator" | "autonomous" | "custom">("operator");
  const [revealState, setRevealState] = useState<TokenRevealState | null>(null);
  const [revealDialogOpen, setRevealDialogOpen] = useState(false);
  const [logWorkDialogOpen, setLogWorkDialogOpen] = useState(false);
  const [onboardingExpanded, setOnboardingExpanded] = useState(false);

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
      queryClient.invalidateQueries({ queryKey: ["forge-operator-context"] })
    ]);
  };

  const tokenMutation = useMutation({
    mutationFn: (input: CreateAgentTokenInput) => createAgentToken(input),
    onSuccess: invalidateAll
  });
  const rotateMutation = useMutation({
    mutationFn: (tokenId: string) => rotateAgentToken(tokenId),
    onSuccess: async (data, _tokenId) => {
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
    }
  });
  const revokeMutation = useMutation({
    mutationFn: (tokenId: string) => revokeAgentToken(tokenId),
    onSuccess: invalidateAll
  });
  const approveMutation = useMutation({
    mutationFn: (id: string) => approveApprovalRequest(id),
    onSuccess: invalidateAll
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectApprovalRequest(id),
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
  const operatorContext = operatorContextQuery.data?.context;

  const activeTokens = settings?.agentTokens.filter((t) => t.status === "active") ?? [];
  const recommendedScopes = onboarding?.recommendedScopes ?? [];
  const hasFullOperatorToken = activeTokens.some((t) => tokenHasScopes(t, recommendedScopes));
  const hasRewardManager = activeTokens.some((t) => tokenHasScopes(t, ["rewards.manage"]));
  const hasPsycheWriter = activeTokens.some((t) => tokenHasScopes(t, ["psyche.write"]));
  const hasScopedWriter = activeTokens.some((t) => t.autonomyMode !== "approval_required" && tokenHasScopes(t, ["write"]));
  const hasAnyToken = activeTokens.length > 0;

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
        ? `Session open as ${operatorSessionQuery.data.session.actorLabel}. Works for localhost and Tailscale without a token.`
        : "Passwordless session is active for local and Tailscale access.",
      action: null
    },
    {
      label: "Agent token",
      ok: hasAnyToken,
      badge: hasAnyToken ? `${activeTokens.length} active` : "none issued",
      badgeTone: hasAnyToken ? "emerald" : "amber",
      detail: hasAnyToken
        ? `${activeTokens.length} active token${activeTokens.length === 1 ? "" : "s"} allow external agents and scripts to authenticate.`
        : "No token yet. Issue one to let external agents connect via the API.",
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
      <SurfaceSkeleton
        eyebrow="Settings · Agents"
        title="Loading agent console"
        description="Establishing the operator session and loading agent configuration."
        columns={2}
        blocks={6}
      />
    );
  }

  if (operatorSessionQuery.isError) {
    return <ErrorState eyebrow="Settings · Agents" error={operatorSessionQuery.error} onRetry={() => void operatorSessionQuery.refetch()} />;
  }

  if (settingsQuery.isError || !settings) {
    return <ErrorState eyebrow="Settings · Agents" error={settingsQuery.error ?? new Error("Could not load settings.")} onRetry={() => void settingsQuery.refetch()} />;
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
          const result = await tokenMutation.mutateAsync(input);
          // Close the wizard and open the reveal dialog
          setTokenDialogOpen(false);
          if (onboarding) {
            setRevealState({
              tokenString: result.token.token,
              agentLabel: input.agentLabel,
              onboarding
            });
            setRevealDialogOpen(true);
          }
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

        {/* ── Operator console overview ── */}
        {operatorContext ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile label="Active projects" value={operatorContext.activeProjects.length} tone="core" />
            <MetricTile label="Focus tasks" value={operatorContext.focusTasks.length} tone="core" />
            <MetricTile label="Pending approvals" value={approvals.filter((a) => a.status === "pending").length} tone="core" />
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
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Capability status</div>
          <div className="mt-4 grid gap-3">
            {capabilities.map((cap) => (
              <div
                key={cap.label}
                className="flex items-start justify-between gap-4 rounded-[18px] bg-white/[0.04] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="font-medium text-white">{cap.label}</span>
                    <Badge
                      className={
                        cap.badgeTone === "emerald"
                          ? "text-emerald-300"
                          : cap.badgeTone === "amber"
                            ? "text-amber-300"
                            : "text-white/45"
                      }
                    >
                      {cap.badge}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm leading-6 text-white/55">{cap.detail}</div>
                </div>
                {cap.action ? (
                  <button
                    type="button"
                    onClick={cap.action.onClick}
                    className="mt-0.5 flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/72 transition hover:bg-white/[0.12] hover:text-white"
                  >
                    {cap.action.label}
                    <ArrowRight className="size-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        {/* ── Token management ── */}
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Agent tokens</div>
            <Button
              size="sm"
              variant="secondary"
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
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-4 text-sm text-white/55">
                No tokens yet. Issue one to let external agents or scripts authenticate with Forge.
              </div>
            ) : (
              settings.agentTokens.map((token) => (
                <div key={token.id} className="rounded-[18px] bg-white/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-white">{token.label}</div>
                      <div className="mt-0.5 text-sm text-white/50">
                        {token.agentLabel ?? "Unassigned agent"} · <span className="font-mono text-xs">{token.tokenPrefix}</span>
                      </div>
                    </div>
                    <Badge className={token.status === "active" ? "text-emerald-300" : "text-white/45"}>{token.status}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/55">
                    <span>{token.trustLevel}</span>
                    <span>·</span>
                    <span>{token.autonomyMode.replaceAll("_", " ")}</span>
                    <span>·</span>
                    <span>{token.approvalMode.replaceAll("_", " ")}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {["write", "rewards.manage", "psyche.write"].map((scope) => (
                      <Badge
                        key={scope}
                        className={token.scopes.includes(scope) ? "text-emerald-300" : "text-white/30"}
                      >
                        {scope}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      pending={rotateMutation.isPending}
                      pendingLabel="Rotating"
                      onClick={() => void rotateMutation.mutateAsync(token.id)}
                    >
                      Rotate &amp; reveal new token
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      pending={revokeMutation.isPending}
                      pendingLabel="Revoking"
                      onClick={() => void revokeMutation.mutateAsync(token.id)}
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="mt-3 px-1 text-xs text-white/35">
            Raw token values are shown once and are never recoverable. If a token is lost, rotate or issue a new one.
          </div>
        </Card>

        {/* ── Agent roster ── */}
        {settings.agents.length > 0 ? (
          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Connected agents</div>
            <div className="mt-4 grid gap-3">
              {settings.agents.map((agent) => (
                <div key={agent.id} className="flex items-start justify-between gap-3 rounded-[18px] bg-white/[0.04] p-4">
                  <div className="min-w-0">
                    <div className="font-medium text-white">{agent.label}</div>
                    {agent.description ? <div className="mt-1 text-sm text-white/52">{agent.description}</div> : null}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/55">
                      <span>{agent.agentType}</span>
                      <span>{agent.autonomyMode.replaceAll("_", " ")}</span>
                      <span>{agent.activeTokenCount} active token{agent.activeTokenCount !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <Badge className="text-white/60">{agent.trustLevel}</Badge>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {/* ── Board overview ── */}
        {operatorContext ? (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <Card>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Recommended next move</div>
              {operatorContext.recommendedNextTask ? (
                <div className="mt-4 grid gap-2">
                  <EntityName kind="task" label={operatorContext.recommendedNextTask.title} variant="heading" size="lg" />
                  <div className="text-sm leading-6 text-white/58">
                    {operatorContext.recommendedNextTask.description || "No extra notes yet."}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge>{operatorContext.recommendedNextTask.status.replaceAll("_", " ")}</Badge>
                    <Badge>{operatorContext.recommendedNextTask.points} xp</Badge>
                    <Badge>{operatorContext.recommendedNextTask.owner}</Badge>
                  </div>
                </div>
              ) : (
                <div className="mt-4 text-sm text-white/55">Board is clear. No recommended task right now.</div>
              )}
            </Card>
            <Card>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Board pulse</div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { label: "Backlog", value: operatorContext.currentBoard.backlog.length },
                  { label: "Focus", value: operatorContext.currentBoard.focus.length },
                  { label: "In progress", value: operatorContext.currentBoard.inProgress.length },
                  { label: "Blocked", value: operatorContext.currentBoard.blocked.length }
                ].map((col) => (
                  <div key={col.label} className="rounded-[18px] bg-white/[0.04] p-4">
                    <div className="text-xs uppercase tracking-[0.14em] text-white/38">{col.label}</div>
                    <div className="mt-2 font-display text-3xl text-white">{col.value}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : null}

        {/* ── Active projects ── */}
        {operatorContext && operatorContext.activeProjects.length > 0 ? (
          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Active projects</div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {operatorContext.activeProjects.slice(0, 6).map((project) => (
                <div key={project.id} className="rounded-[18px] bg-white/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <EntityName kind="project" label={project.title} />
                    <Badge>{project.progress}%</Badge>
                  </div>
                  <div className="mt-2">
                    <EntityBadge kind="goal" label={project.goalTitle} compact gradient={false} />
                  </div>
                  <div className="mt-2 text-xs text-white/38">
                    {project.activeTaskCount} active · {project.completedTaskCount} done
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {/* ── Approval queue ── */}
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Approval queue</div>
            {approvals.filter((a) => a.status === "pending").length > 0 ? (
              <Badge className="text-amber-300">{approvals.filter((a) => a.status === "pending").length} pending</Badge>
            ) : null}
          </div>
          <div className="mt-4 grid gap-3">
            {approvals.length === 0 ? (
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-4 text-sm text-white/55">
                No pending approvals. Agent actions are flowing through.
              </div>
            ) : (
              approvals.map((approval) => (
                <div key={approval.id} className="rounded-[18px] bg-white/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-white">{approval.title}</div>
                      <div className="mt-0.5 text-sm text-white/55">{approval.summary || approval.actionType}</div>
                    </div>
                    <Badge className={approval.status === "pending" ? "text-amber-300" : "text-white/45"}>
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
                        onClick={() => void approveMutation.mutateAsync(approval.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        pending={rejectMutation.isPending}
                        pendingLabel="Rejecting"
                        onClick={() => void rejectMutation.mutateAsync(approval.id)}
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
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Retroactive work log</div>
              <div className="mt-1 text-sm text-white/55">
                Capture work done outside the timer so it counts toward progress and XP.
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
            <div className="mt-4 rounded-[18px] bg-[rgba(192,193,255,0.10)] px-4 py-3 text-sm text-white">
              Logged{" "}
              <span className="inline-block align-middle">
                <EntityName kind="task" label={logWorkMutation.data.task.title} showKind={false} />
              </span>
              . Operator XP updated to {logWorkMutation.data.xp.profile.totalXp}.
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
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Connection &amp; onboarding</div>
              {onboarding ? (
                <div className="mt-1 text-sm text-white/55">
                  {onboarding.forgeBaseUrl}
                </div>
              ) : null}
            </div>
            {onboardingExpanded ? (
              <ChevronUp className="size-4 shrink-0 text-white/38" />
            ) : (
              <ChevronDown className="size-4 shrink-0 text-white/38" />
            )}
          </button>

          {onboardingExpanded && onboarding ? (
            <div className="mt-5 grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[18px] bg-white/[0.04] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-white/40">Forge API</div>
                  <div className="mt-2 break-all text-sm text-white">{onboarding.forgeBaseUrl}</div>
                </div>
                <div className="rounded-[18px] bg-white/[0.04] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-white/40">Web app</div>
                  <div className="mt-2 break-all text-sm text-white">{onboarding.webAppUrl}</div>
                </div>
                <div className="rounded-[18px] bg-white/[0.04] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-white/40">OpenAPI spec</div>
                  <div className="mt-2 break-all text-sm text-white">{onboarding.openApiUrl}</div>
                </div>
                <div className="rounded-[18px] bg-white/[0.04] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-white/40">Default policy</div>
                  <div className="mt-2 text-sm text-white">
                    {onboarding.recommendedTrustLevel} · {onboarding.recommendedAutonomyMode.replaceAll("_", " ")} · {onboarding.recommendedApprovalMode.replaceAll("_", " ")}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[18px] bg-white/[0.04] p-4">
                  <div className="font-medium text-white">{onboarding.authModes.operatorSession.label}</div>
                  <Badge className="mt-1 text-emerald-300">{onboarding.defaultConnectionMode === "operator_session" ? "default" : "available"}</Badge>
                  <div className="mt-3 text-sm leading-6 text-white/60">{onboarding.authModes.operatorSession.summary}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {onboarding.authModes.operatorSession.trustedTargets.map((t) => (
                      <Badge key={t} className="text-white/65">{t}</Badge>
                    ))}
                  </div>
                </div>
                <div className="rounded-[18px] bg-white/[0.04] p-4">
                  <div className="font-medium text-white">{onboarding.authModes.managedToken.label}</div>
                  <Badge className="mt-1 text-white/55">optional</Badge>
                  <div className="mt-3 text-sm leading-6 text-white/60">{onboarding.authModes.managedToken.summary}</div>
                  <div className="mt-2 text-sm leading-6 text-white/48">{onboarding.tokenRecovery.rotationSummary}</div>
                </div>
              </div>

              <div className="rounded-[18px] bg-white/[0.04] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-white/40">Quick-connect verification</div>
                <pre className="mt-3 overflow-x-auto rounded-[16px] bg-[rgba(8,13,28,0.78)] p-4 text-xs leading-6 text-white/72">
                  <code>{[`curl -s ${onboarding.healthUrl}`, `openclaw plugins install ./projects/forge`, "openclaw gateway restart"].join("\n")}</code>
                </pre>
              </div>

              <div className="rounded-[18px] bg-white/[0.04] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-white/40">Required API headers</div>
                <div className="mt-3 grid gap-1 text-sm text-white/60">
                  <div>{onboarding.requiredHeaders.authorization}</div>
                  <div>{onboarding.requiredHeaders.source}</div>
                  <div>{onboarding.requiredHeaders.actor}</div>
                </div>
              </div>
            </div>
          ) : onboardingExpanded && onboardingQuery.isError ? (
            <div className="mt-4 rounded-[18px] bg-[rgba(120,33,33,0.22)] px-4 py-3 text-sm text-rose-100/80">
              Could not load the onboarding contract. Check the API bridge.
            </div>
          ) : onboardingExpanded ? (
            <div className="mt-4 text-sm text-white/50">Loading…</div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
