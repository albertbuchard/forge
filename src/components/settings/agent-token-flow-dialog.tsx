import { useEffect, useState } from "react";
import { FlowChoiceGrid, FlowField, QuestionFlowDialog, type QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { createAgentTokenSchema, type CreateAgentTokenInput } from "@/lib/schemas";

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
  { value: "read", label: "Read", description: "Inspect goals, projects, tasks, reviews, and metrics." },
  { value: "write", label: "Write", description: "Create and update work through the versioned API." },
  { value: "insights", label: "Insights", description: "Store structured findings, rationale, and feedback." },
  { value: "rewards.manage", label: "Rewards", description: "Tune reward rules and issue explainable bonus XP grants." },
  { value: "psyche.read", label: "Psyche read", description: "Read sensitive values, patterns, and trigger analyses." },
  { value: "psyche.write", label: "Psyche write", description: "Create and update sensitive therapeutic records." },
  { value: "psyche.note", label: "Psyche note", description: "Create and edit Markdown notes linked to reflective records." },
  { value: "psyche.insight", label: "Psyche insight", description: "Store therapeutic insights on Psyche entities." },
  { value: "psyche.mode", label: "Psyche mode", description: "Name, refine, and map mode profiles and guided mode results." }
] as const;

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
};

function applyPreset(draft: TokenDraft, preset: TokenPreset, recommendedScopes: readonly string[]): TokenDraft {
  if (preset === "review") {
    return {
      ...draft,
      preset,
      trustLevel: "trusted",
      autonomyMode: "approval_required",
      approvalMode: "approval_by_default",
      scopes: [...recommendedScopes]
    };
  }
  if (preset === "operator") {
    return {
      ...draft,
      preset,
      trustLevel: "trusted",
      autonomyMode: "scoped_write",
      approvalMode: "high_impact_only",
      scopes: [...FULL_OPERATOR_SCOPES]
    };
  }
  if (preset === "autonomous") {
    return {
      ...draft,
      preset,
      trustLevel: "autonomous",
      autonomyMode: "autonomous",
      approvalMode: "none",
      scopes: [...FULL_OPERATOR_SCOPES]
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
    scopes: [...FULL_OPERATOR_SCOPES]
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
      setDraft(buildInitialDraft(initialPreset, defaultAgentLabel, recommendedScopes));
      setSubmitError(null);
    }
  }, [open, initialPreset, defaultAgentLabel, recommendedScopes]);

  const patch = (update: Partial<TokenDraft>) => setDraft((prev) => ({ ...prev, ...update }));

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
            <FlowField label="Description" description="Optional note about what this agent does.">
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
              onChange={(next) => setValue({ trustLevel: next as TokenDraft["trustLevel"] })}
              options={[
                { value: "standard", label: "Standard", description: "Read-only by default, limited write surface." },
                { value: "trusted", label: "Trusted", description: "Full write surface with policy guardrails active." },
                { value: "autonomous", label: "Autonomous", description: "All checks bypassed — maximum capability." }
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
              onChange={(next) => setValue({ autonomyMode: next as TokenDraft["autonomyMode"] })}
              options={[
                { value: "approval_required", label: "Approval required", description: "Every write action queues for your review." },
                { value: "scoped_write", label: "Scoped write", description: "Acts freely within its assigned scopes." },
                { value: "autonomous", label: "Autonomous", description: "No gates — full freedom to write." }
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
              onChange={(next) => setValue({ approvalMode: next as TokenDraft["approvalMode"] })}
              options={[
                { value: "approval_by_default", label: "Approve by default", description: "Everything needs a sign-off unless explicitly exempt." },
                { value: "high_impact_only", label: "High impact only", description: "Routine writes pass through; high-stakes actions are held." },
                { value: "none", label: "None", description: "No approval gates — actions execute immediately." }
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
                      setValue({ scopes: value.scopes.filter((s) => s !== scope.value) });
                    } else {
                      setValue({ scopes: [...value.scopes, scope.value] });
                    }
                  }}
                >
                  <div className="font-medium">{scope.label}</div>
                  <div className="mt-1 text-xs leading-5 text-white/58">{scope.description}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-xs text-white/40">
            {value.scopes.length} scope{value.scopes.length !== 1 ? "s" : ""} selected
          </div>
        </FlowField>
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
          scopes: draft.scopes
        });

        if (!payload.success) {
          const firstIssue = payload.error.issues[0];
          setSubmitError(firstIssue?.message ?? "Check the agent name and at least one scope before issuing.");
          return;
        }

        try {
          await onSubmit(payload.data);
          onOpenChange(false);
        } catch (error) {
          setSubmitError(error instanceof Error ? error.message : "Could not issue the token right now.");
        }
      }}
    />
  );
}
