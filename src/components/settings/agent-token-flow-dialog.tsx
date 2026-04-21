import { useEffect, useState } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import {
  createAgentTokenSchema,
  type CreateAgentTokenInput
} from "@/lib/schemas";

const FULL_OPERATOR_SCOPES = [
  "read",
  "write",
  "insights",
  "rewards.manage",
  "psyche.read",
  "psyche.write",
  "psyche.note",
  "psyche.insight",
  "psyche.mode"
] as const;

const TOKEN_SCOPE_OPTIONS = [
  {
    value: "read",
    label: "Read",
    description: "Inspect goals, projects, tasks, reviews, and metrics."
  },
  {
    value: "write",
    label: "Write",
    description: "Create and update work through the versioned API."
  },
  {
    value: "insights",
    label: "Insights",
    description: "Store structured findings, rationale, and feedback."
  },
  {
    value: "rewards.manage",
    label: "Rewards",
    description: "Tune reward rules and issue explainable bonus XP grants."
  },
  {
    value: "psyche.read",
    label: "Psyche read",
    description: "Read sensitive values, patterns, and trigger analyses."
  },
  {
    value: "psyche.write",
    label: "Psyche write",
    description: "Create and update sensitive therapeutic records."
  },
  {
    value: "psyche.note",
    label: "Psyche note",
    description: "Create and edit Markdown notes linked to reflective records."
  },
  {
    value: "psyche.insight",
    label: "Psyche insight",
    description: "Store therapeutic insights on Psyche entities."
  },
  {
    value: "psyche.mode",
    label: "Psyche mode",
    description: "Name, refine, and map mode profiles and guided mode results."
  }
] as const;

const DEFAULT_BOOTSTRAP_POLICY = {
  mode: "active_only" as const,
  goalsLimit: 5,
  projectsLimit: 8,
  tasksLimit: 10,
  habitsLimit: 6,
  strategiesLimit: 4,
  peoplePageLimit: 4,
  includePeoplePages: true
};
type BootstrapMode = "disabled" | "active_only" | "scoped" | "full";
type BootstrapPolicy = {
  mode: BootstrapMode;
  goalsLimit: number;
  projectsLimit: number;
  tasksLimit: number;
  habitsLimit: number;
  strategiesLimit: number;
  peoplePageLimit: number;
  includePeoplePages: boolean;
};
type ScopePolicy = {
  userIds: string[];
  projectIds: string[];
  tagIds: string[];
};
const DEFAULT_SCOPE_POLICY: ScopePolicy = {
  userIds: [],
  projectIds: [],
  tagIds: []
};

type TokenPreset = "review" | "operator" | "autonomous" | "custom";

type TokenDraft = {
  preset: TokenPreset;
  label: string;
  agentLabel: string;
  agentType: string;
  description: string;
  trustLevel: "standard" | "trusted" | "autonomous";
  autonomyMode: "approval_required" | "scoped_write" | "autonomous";
  approvalMode: "approval_by_default" | "high_impact_only" | "none";
  scopes: string[];
  bootstrapPolicy: BootstrapPolicy;
  scopePolicy: ScopePolicy;
};

function bootstrapPolicyForPreset(preset: TokenPreset): BootstrapPolicy {
  if (preset === "review") {
    return {
      mode: "active_only",
      goalsLimit: 3,
      projectsLimit: 5,
      tasksLimit: 6,
      habitsLimit: 4,
      strategiesLimit: 3,
      peoplePageLimit: 0,
      includePeoplePages: false
    };
  }
  if (preset === "operator") {
    return { ...DEFAULT_BOOTSTRAP_POLICY };
  }
  if (preset === "autonomous") {
    return {
      mode: "scoped",
      goalsLimit: 10,
      projectsLimit: 14,
      tasksLimit: 16,
      habitsLimit: 10,
      strategiesLimit: 8,
      peoplePageLimit: 6,
      includePeoplePages: true
    };
  }
  return { ...DEFAULT_BOOTSTRAP_POLICY };
}

function parseIdList(raw: string) {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
}

function applyPreset(
  draft: TokenDraft,
  preset: TokenPreset,
  recommendedScopes: readonly string[]
): TokenDraft {
  if (preset === "review") {
    return {
      ...draft,
      preset,
      trustLevel: "trusted",
      autonomyMode: "approval_required",
      approvalMode: "approval_by_default",
      scopes: [...recommendedScopes],
      bootstrapPolicy: bootstrapPolicyForPreset(preset),
      scopePolicy: { ...DEFAULT_SCOPE_POLICY }
    };
  }
  if (preset === "operator") {
    return {
      ...draft,
      preset,
      trustLevel: "trusted",
      autonomyMode: "scoped_write",
      approvalMode: "high_impact_only",
      scopes: [...FULL_OPERATOR_SCOPES],
      bootstrapPolicy: bootstrapPolicyForPreset(preset),
      scopePolicy: { ...DEFAULT_SCOPE_POLICY }
    };
  }
  if (preset === "autonomous") {
    return {
      ...draft,
      preset,
      trustLevel: "autonomous",
      autonomyMode: "autonomous",
      approvalMode: "none",
      scopes: [...FULL_OPERATOR_SCOPES],
      bootstrapPolicy: bootstrapPolicyForPreset(preset),
      scopePolicy: { ...DEFAULT_SCOPE_POLICY }
    };
  }
  return { ...draft, preset };
}

function buildInitialDraft(
  initialPreset: TokenPreset,
  defaultAgentLabel: string,
  recommendedScopes: readonly string[]
): TokenDraft {
  const base: TokenDraft = {
    preset: initialPreset,
    label: "Forge Pilot Token",
    agentLabel: defaultAgentLabel,
    agentType: "assistant",
    description: "Collaborative planning agent.",
    trustLevel: "trusted",
    autonomyMode: "scoped_write",
    approvalMode: "high_impact_only",
    scopes: [...FULL_OPERATOR_SCOPES],
    bootstrapPolicy: { ...DEFAULT_BOOTSTRAP_POLICY },
    scopePolicy: { ...DEFAULT_SCOPE_POLICY }
  };
  return applyPreset(base, initialPreset, recommendedScopes);
}

export function AgentTokenFlowDialog({
  open,
  onOpenChange,
  pending = false,
  initialPreset = "operator",
  defaultAgentLabel = "OpenClaw",
  recommendedScopes = [...FULL_OPERATOR_SCOPES],
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  initialPreset?: TokenPreset;
  defaultAgentLabel?: string;
  recommendedScopes?: readonly string[];
  onSubmit: (input: CreateAgentTokenInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TokenDraft>(() =>
    buildInitialDraft(initialPreset, defaultAgentLabel, recommendedScopes)
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(
        buildInitialDraft(initialPreset, defaultAgentLabel, recommendedScopes)
      );
      setSubmitError(null);
    }
  }, [open, initialPreset, defaultAgentLabel, recommendedScopes]);

  const patch = (update: Partial<TokenDraft>) =>
    setDraft((prev) => ({ ...prev, ...update }));

  const steps: Array<QuestionFlowStep<TokenDraft>> = [
    {
      id: "preset",
      eyebrow: "Agent token",
      title: "Choose a starting point for this token",
      description:
        "Each preset locks in a sensible trust, autonomy, and approval policy. You can tune any setting in the next steps.",
      render: (value, setValue) => (
        <FlowChoiceGrid
          columns={3}
          value={value.preset}
          onChange={(next) =>
            setValue(applyPreset(value, next as TokenPreset, recommendedScopes))
          }
          options={[
            {
              value: "review",
              label: "Review-first",
              description:
                "Every action waits for your approval. Safe starting point for a new agent you have not yet trusted."
            },
            {
              value: "operator",
              label: "Full operator",
              description:
                "Trusted collaborator with full scopes. High-impact actions still ask for approval."
            },
            {
              value: "autonomous",
              label: "Autonomous pilot",
              description:
                "No approval gates. Use only for agents you have fully verified in a controlled setup."
            },
            {
              value: "custom",
              label: "Custom",
              description:
                "Start from a blank slate and configure every dimension yourself."
            }
          ]}
        />
      )
    },
    {
      id: "identity",
      eyebrow: "Agent identity",
      title: "Name the agent and this token",
      description:
        "The agent name appears in logs, approval requests, and audit trails. The token label is for your reference.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Agent name"
            labelHelp="This label identifies the agent in every log entry, approval notification, and XP attribution. Pick something memorable."
          >
            <Input
              value={value.agentLabel}
              placeholder="OpenClaw"
              onChange={(e) => setValue({ agentLabel: e.target.value })}
            />
          </FlowField>
          <FlowField
            label="Token label"
            description="A short name for this credential — mainly for your reference in the token list."
          >
            <Input
              value={value.label}
              placeholder="Forge Pilot Token"
              onChange={(e) => setValue({ label: e.target.value })}
            />
          </FlowField>
          <div className="grid gap-5 md:grid-cols-2">
            <FlowField
              label="Agent type"
              labelHelp="Use 'assistant' for interactive agents. Use 'automation' for scripts or scheduled jobs with no conversational layer."
            >
              <select
                className="rounded-[14px] bg-white/[0.06] px-3 py-3 text-white"
                value={value.agentType}
                onChange={(e) => setValue({ agentType: e.target.value })}
              >
                <option value="assistant">assistant</option>
                <option value="automation">automation</option>
                <option value="observer">observer</option>
              </select>
            </FlowField>
            <FlowField
              label="Description"
              description="Optional note about what this agent does."
            >
              <Input
                value={value.description}
                placeholder="Collaborative planning agent."
                onChange={(e) => setValue({ description: e.target.value })}
              />
            </FlowField>
          </div>
        </>
      )
    },
    {
      id: "policy",
      eyebrow: "Access policy",
      title: "Set trust level and approval behaviour",
      description:
        "These three settings control how much autonomy the agent has and when it needs your sign-off. The preset you chose filled sensible defaults — adjust only if needed.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Trust level"
            labelHelp="Standard agents are sandboxed readers. Trusted agents can write with policy guardrails. Autonomous agents bypass all trust checks — use with care."
          >
            <FlowChoiceGrid
              columns={3}
              value={value.trustLevel}
              onChange={(next) =>
                setValue({ trustLevel: next as TokenDraft["trustLevel"] })
              }
              options={[
                {
                  value: "standard",
                  label: "Standard",
                  description: "Read-only by default, limited write surface."
                },
                {
                  value: "trusted",
                  label: "Trusted",
                  description:
                    "Full write surface with policy guardrails active."
                },
                {
                  value: "autonomous",
                  label: "Autonomous",
                  description: "All checks bypassed — maximum capability."
                }
              ]}
            />
          </FlowField>
          <FlowField
            label="Autonomy mode"
            labelHelp="Approval-required means every mutation is held for review. Scoped write lets the agent act within its scopes. Autonomous skips all gates."
          >
            <FlowChoiceGrid
              columns={3}
              value={value.autonomyMode}
              onChange={(next) =>
                setValue({ autonomyMode: next as TokenDraft["autonomyMode"] })
              }
              options={[
                {
                  value: "approval_required",
                  label: "Approval required",
                  description: "Every write action queues for your review."
                },
                {
                  value: "scoped_write",
                  label: "Scoped write",
                  description: "Acts freely within its assigned scopes."
                },
                {
                  value: "autonomous",
                  label: "Autonomous",
                  description: "No gates — full freedom to write."
                }
              ]}
            />
          </FlowField>
          <FlowField
            label="Approval policy"
            labelHelp="Controls which actions trigger the approval queue. High-impact-only is the balanced default: routine writes go through, large mutations get reviewed."
          >
            <FlowChoiceGrid
              columns={3}
              value={value.approvalMode}
              onChange={(next) =>
                setValue({ approvalMode: next as TokenDraft["approvalMode"] })
              }
              options={[
                {
                  value: "approval_by_default",
                  label: "Approve by default",
                  description:
                    "Everything needs a sign-off unless explicitly exempt."
                },
                {
                  value: "high_impact_only",
                  label: "High impact only",
                  description:
                    "Routine writes pass through; high-stakes actions are held."
                },
                {
                  value: "none",
                  label: "None",
                  description:
                    "No approval gates — actions execute immediately."
                }
              ]}
            />
          </FlowField>
        </>
      )
    },
    {
      id: "scopes",
      eyebrow: "Scopes",
      title: "Select what this agent can access",
      description:
        "Scope selection follows the principle of least privilege — only grant what the agent actually needs. The full operator bundle covers every capability.",
      render: (value, setValue) => (
        <FlowField
          label="Capabilities"
          labelHelp="Read lets the agent inspect the system. Write lets it create and update work. Rewards and Psyche scopes unlock more sensitive subsystems."
        >
          <div className="grid gap-3 md:grid-cols-3">
            {TOKEN_SCOPE_OPTIONS.map((scope) => {
              const selected = value.scopes.includes(scope.value);
              return (
                <button
                  key={scope.value}
                  type="button"
                  className={`rounded-[18px] border px-4 py-4 text-left transition ${
                    selected
                      ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white"
                      : "border-white/8 bg-white/[0.04] text-white/58 hover:bg-white/[0.08]"
                  }`}
                  onClick={() => {
                    if (selected) {
                      if (value.scopes.length === 1) return;
                      setValue({
                        scopes: value.scopes.filter((s) => s !== scope.value)
                      });
                    } else {
                      setValue({ scopes: [...value.scopes, scope.value] });
                    }
                  }}
                >
                  <div className="font-medium">{scope.label}</div>
                  <div className="mt-1 text-xs leading-5 text-white/58">
                    {scope.description}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-xs text-white/40">
            {value.scopes.length} scope{value.scopes.length !== 1 ? "s" : ""}{" "}
            selected
          </div>
        </FlowField>
      )
    },
    {
      id: "default-scope",
      eyebrow: "Default read scope",
      title: "Decide which owners and slices this agent sees by default",
      description:
        "Leave these blank for broad reads. When set, Forge automatically narrows overview, context, and bootstrap reads for this token unless the request narrows further.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Default user IDs"
            description="Comma-separated owner ids such as user_operator or user_forge_bot."
            labelHelp="If you set user ids here, this token only sees that owner slice by default. Explicit userIds in a request can narrow further, but they will not silently widen beyond this list."
          >
            <Input
              value={value.scopePolicy.userIds.join(", ")}
              placeholder="user_operator, user_forge_bot"
              onChange={(event) =>
                setValue({
                  scopePolicy: {
                    ...value.scopePolicy,
                    userIds: parseIdList(event.target.value)
                  }
                })
              }
            />
          </FlowField>
          <FlowField
            label="Project IDs"
            description="Optional project-level boundary for overview, context, and bootstrap reads."
          >
            <Input
              value={value.scopePolicy.projectIds.join(", ")}
              placeholder="project_123, project_456"
              onChange={(event) =>
                setValue({
                  scopePolicy: {
                    ...value.scopePolicy,
                    projectIds: parseIdList(event.target.value)
                  }
                })
              }
            />
          </FlowField>
          <FlowField
            label="Tag IDs"
            description="Optional tag-level boundary for overview, context, and bootstrap reads."
          >
            <Input
              value={value.scopePolicy.tagIds.join(", ")}
              placeholder="tag_focus, tag_client"
              onChange={(event) =>
                setValue({
                  scopePolicy: {
                    ...value.scopePolicy,
                    tagIds: parseIdList(event.target.value)
                  }
                })
              }
            />
          </FlowField>
          <div className="rounded-[16px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/62">
            Default scope summary:{" "}
            {value.scopePolicy.userIds.length > 0
              ? `${value.scopePolicy.userIds.length} user slice${value.scopePolicy.userIds.length === 1 ? "" : "s"}`
              : "all visible users"}
            {value.scopePolicy.projectIds.length > 0
              ? ` · ${value.scopePolicy.projectIds.length} project ${value.scopePolicy.projectIds.length === 1 ? "boundary" : "boundaries"}`
              : ""}
            {value.scopePolicy.tagIds.length > 0
              ? ` · ${value.scopePolicy.tagIds.length} tag ${value.scopePolicy.tagIds.length === 1 ? "boundary" : "boundaries"}`
              : ""}
          </div>
        </>
      )
    },
    {
      id: "bootstrap",
      eyebrow: "Bootstrap",
      title: "Decide how much Forge context is injected at session start",
      description:
        "This controls the automatic BOOTSTRAP snapshot for agent sessions. Keep it lean unless the agent genuinely needs broad context on every new session.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Bootstrap mode"
              labelHelp="Disabled injects nothing. Active-only keeps a compact current-work snapshot. Scoped keeps budgets but not status filters. Full mirrors the legacy broad bootstrap."
          >
            <FlowChoiceGrid
              columns={3}
              value={value.bootstrapPolicy.mode}
              onChange={(next) =>
                setValue({
                  bootstrapPolicy: {
                    ...value.bootstrapPolicy,
                    mode: next as TokenDraft["bootstrapPolicy"]["mode"]
                  }
                })
              }
              options={[
                {
                  value: "disabled",
                  label: "Disabled",
                  description: "No automatic Forge snapshot is injected."
                },
                {
                  value: "active_only",
                  label: "Active only",
                  description: "Only active projects, focus tasks, due habits, and bounded summaries."
                },
                {
                  value: "scoped",
                  label: "Scoped",
                  description: "Bounded lists without forcing only active items."
                },
                {
                  value: "full",
                  label: "Full",
                  description: "Legacy broad bootstrap. Highest context cost."
                }
              ]}
            />
          </FlowField>
          <div className="grid gap-5 md:grid-cols-3">
            {[
              ["goalsLimit", "Goals"],
              ["projectsLimit", "Projects"],
              ["tasksLimit", "Tasks"],
              ["habitsLimit", "Habits"],
              ["strategiesLimit", "Strategies"],
              ["peoplePageLimit", "People pages"]
            ].map(([key, label]) => (
              <FlowField key={key} label={label}>
                <Input
                  type="number"
                  min={0}
                  max={key === "peoplePageLimit" ? 50 : 100}
                  value={
                    value.bootstrapPolicy[
                      key as keyof TokenDraft["bootstrapPolicy"]
                    ] as number
                  }
                  onChange={(event) =>
                    setValue({
                      bootstrapPolicy: {
                        ...value.bootstrapPolicy,
                        [key]: Number(event.target.value || 0)
                      }
                    })
                  }
                />
              </FlowField>
            ))}
          </div>
          <label className="flex items-center gap-3 rounded-[16px] bg-white/[0.04] px-4 py-3 text-sm text-white/70">
            <input
              type="checkbox"
              checked={value.bootstrapPolicy.includePeoplePages}
              onChange={(event) =>
                setValue({
                  bootstrapPolicy: {
                    ...value.bootstrapPolicy,
                    includePeoplePages: event.target.checked
                  }
                })
              }
            />
            Include People wiki pages in the bootstrap snapshot
          </label>
        </>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Agent setup"
      title="Issue an agent token"
      description="Configure a new agent token step by step. The preset fills sensible defaults — adjust what you need."
      value={draft}
      onChange={setDraft}
      draftPersistenceKey="settings.agent-token.new"
      steps={steps}
      submitLabel="Issue token"
      pending={pending}
      pendingLabel="Issuing token…"
      error={submitError}
      onSubmit={async () => {
        setSubmitError(null);
        const payload = createAgentTokenSchema.safeParse({
          label: draft.label,
          agentLabel: draft.agentLabel,
          agentType: draft.agentType,
          description: draft.description,
          trustLevel: draft.trustLevel,
          autonomyMode: draft.autonomyMode,
          approvalMode: draft.approvalMode,
          scopes: draft.scopes,
          bootstrapPolicy: draft.bootstrapPolicy,
          scopePolicy: draft.scopePolicy
        });

        if (!payload.success) {
          const firstIssue = payload.error.issues[0];
          setSubmitError(
            firstIssue?.message ??
              "Check the agent name and at least one scope before issuing."
          );
          return;
        }

        try {
          await onSubmit(payload.data);
          onOpenChange(false);
        } catch (error) {
          setSubmitError(
            error instanceof Error
              ? error.message
              : "Could not issue the token right now."
          );
        }
      }}
    />
  );
}
