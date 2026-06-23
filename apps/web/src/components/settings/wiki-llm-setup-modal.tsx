import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CircleCheckBig, Cpu, KeyRound, Sparkles } from "lucide-react";
import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createWikiLlmProfile, testWikiLlmProfile } from "@/lib/api";
import type { WikiLlmConnectionTestResult, WikiLlmProfile } from "@/lib/types";
import {
  buildWikiLlmMetadata,
  DEFAULT_WIKI_LLM_MODEL,
  DEFAULT_WIKI_SYSTEM_PROMPT,
  OPENAI_WIKI_MODELS,
  readWikiLlmReasoning,
  readWikiLlmVerbosity,
  type WikiLlmReasoningEffort,
  type WikiLlmVerbosity
} from "@/lib/wiki-llm";
import { cn } from "@/lib/utils";

type FormState = {
  label: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  systemPrompt: string;
  reasoningEffort: WikiLlmReasoningEffort;
  verbosity: WikiLlmVerbosity;
};

function buildInitialState(profile: WikiLlmProfile | null): FormState {
  return {
    label: profile?.label ?? "Forge wiki ingest",
    model: profile?.model ?? DEFAULT_WIKI_LLM_MODEL,
    apiKey: "",
    baseUrl: profile?.baseUrl ?? "https://api.openai.com/v1",
    systemPrompt: profile?.systemPrompt ?? DEFAULT_WIKI_SYSTEM_PROMPT,
    reasoningEffort: readWikiLlmReasoning(profile?.metadata),
    verbosity: readWikiLlmVerbosity(profile?.metadata)
  };
}

function SegmentedPicker<T extends string>({
  label,
  options,
  value,
  onChange,
  tooltip
}: {
  label: string;
  options: Array<{ value: T; label: string; description: string }>;
  value: T;
  onChange: (value: T) => void;
  tooltip: string;
}) {
  return (
    <div className="grid gap-2.5">
      <div className="flex items-center gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/48">
          {label}
        </div>
        <InfoTooltip content={tooltip} />
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              className={cn(
                "rounded-full border px-3 py-2 text-left transition",
                active
                  ? "border-[rgba(192,193,255,0.35)] bg-[rgba(192,193,255,0.16)] text-white"
                  : "border-white/10 bg-white/[0.03] text-white/62 hover:border-white/18 hover:text-white"
              )}
              onClick={() => onChange(option.value)}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.12em]">
                {option.label}
              </div>
              <div className="mt-1 text-[11px] leading-5 text-inherit/80">
                {option.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function WikiLlmSetupModal({
  open,
  onOpenChange,
  profile,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: WikiLlmProfile | null;
  onSaved: (profile: WikiLlmProfile) => Promise<void> | void;
}) {
  const [form, setForm] = useState<FormState>(() => buildInitialState(profile));
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [connectionResult, setConnectionResult] =
    useState<WikiLlmConnectionTestResult | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(buildInitialState(profile));
    setFeedback(null);
    setConnectionResult(null);
  }, [open, profile]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setFeedback(null);
    setConnectionResult(null);
  }, [
    open,
    form.apiKey,
    form.baseUrl,
    form.model,
    form.reasoningEffort,
    form.verbosity
  ]);

  const usingStoredKey = Boolean(profile?.secretId && !form.apiKey.trim());
  const canSubmit = useMemo(
    () =>
      form.label.trim().length > 0 &&
      form.model.trim().length > 0 &&
      (form.apiKey.trim().length > 0 || Boolean(profile?.secretId)),
    [form.apiKey, form.label, form.model, profile?.secretId]
  );

  const saveMutation = useMutation({
    mutationFn: async () =>
      createWikiLlmProfile({
        id: profile?.id,
        label: form.label.trim(),
        provider: "openai-responses",
        baseUrl: form.baseUrl.trim(),
        model: form.model,
        apiKey: form.apiKey.trim() || undefined,
        systemPrompt: form.systemPrompt.trim(),
        reasoningEffort: form.reasoningEffort,
        verbosity: form.verbosity,
        enabled: true,
        metadata: buildWikiLlmMetadata({
          reasoningEffort: form.reasoningEffort,
          verbosity: form.verbosity
        })
      }),
    onSuccess: async (result) => {
      setFeedback({
        tone: "success",
        message: "OpenAI profile saved."
      });
      await onSaved(result.profile);
      onOpenChange(false);
    },
    onError: (error) => {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Unable to save the profile."
      });
    }
  });

  const testMutation = useMutation({
    mutationFn: async () =>
      testWikiLlmProfile({
        profileId: profile?.id,
        provider: "openai-responses",
        baseUrl: form.baseUrl.trim(),
        model: form.model,
        apiKey: form.apiKey.trim() || undefined,
        reasoningEffort: form.reasoningEffort,
        verbosity: form.verbosity
      }),
    onSuccess: ({ result }) => {
      setConnectionResult(result);
      setFeedback({
        tone: "success",
        message: result.usingStoredKey
          ? "Stored OpenAI key worked."
          : "OpenAI key accepted."
      });
    },
    onError: (error) => {
      setConnectionResult(null);
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "OpenAI rejected the connection test."
      });
    }
  });

  const steps: Array<QuestionFlowStep<FormState>> = [
    {
      id: "profile",
      eyebrow: "OpenAI profile",
      title: profile
        ? "Update the wiki drafting profile"
        : "Create the wiki drafting profile",
      description:
        "Start with the identity and credentials Forge will use for wiki auto-ingest. The key stays in local encrypted storage.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Profile label"
            description="This is the name Forge will show in Wiki Settings."
            labelHelp="Use a plain operational label like Forge wiki ingest."
          >
            <Input
              value={value.label}
              onChange={(event) => setValue({ label: event.target.value })}
              placeholder="Forge wiki ingest"
            />
          </FlowField>

          <FlowField
            label="OpenAI API key"
            description="Paste a key from your OpenAI account to enable auto-ingest."
            labelHelp="Leave this blank when editing if you want to keep the saved key already stored in Forge."
            hint={
              usingStoredKey
                ? "Using the saved key until you replace it."
                : "Forge will store the key locally and use it for future ingest runs."
            }
          >
            <Input
              value={value.apiKey}
              onChange={(event) => setValue({ apiKey: event.target.value })}
              type="password"
              placeholder={
                profile?.secretId ? "Saved key already present" : "sk-..."
              }
            />
          </FlowField>
        </>
      )
    },
    {
      id: "model",
      eyebrow: "Model choice",
      title: "Pick the GPT-5.4 model tier",
      description:
        "Choose the OpenAI model Forge should use when it drafts wiki pages and entity proposals from imported source material.",
      render: (value, setValue) => (
        <div className="grid gap-3 md:grid-cols-3">
          {OPENAI_WIKI_MODELS.map((model) => {
            const active = value.model === model.value;
            return (
              <button
                key={model.value}
                type="button"
                className={cn(
                  "rounded-[24px] border p-4 text-left transition",
                  active
                    ? "border-[rgba(192,193,255,0.38)] bg-[rgba(192,193,255,0.13)]"
                    : "border-white/10 bg-white/[0.03] hover:border-white/18 hover:bg-white/[0.05]"
                )}
                onClick={() => setValue({ model: model.value })}
              >
                <div className="flex items-center gap-2 text-white">
                  <Cpu className="size-4 text-[var(--primary)]" />
                  <span className="font-semibold">{model.label}</span>
                </div>
                <div className="mt-2 text-sm leading-6 text-white/56">
                  {model.description}
                </div>
              </button>
            );
          })}
        </div>
      )
    },
    {
      id: "controls",
      eyebrow: "Drafting controls",
      title: "Tune reasoning and output shape",
      description:
        "Set how much thinking budget Forge should spend and how verbose the generated wiki drafts should be. Advanced settings stay optional.",
      render: (value, setValue) => (
        <>
          <SegmentedPicker
            label="Thinking"
            value={value.reasoningEffort}
            onChange={(reasoningEffort) => setValue({ reasoningEffort })}
            tooltip="OpenAI exposes this as reasoning.effort on the Responses API. Higher values spend more reasoning tokens before the model drafts the result."
            options={[
              {
                value: "none",
                label: "None",
                description: "Fastest response."
              },
              {
                value: "low",
                label: "Low",
                description: "Short reasoning budget."
              },
              {
                value: "medium",
                label: "Medium",
                description: "Balanced depth."
              },
              {
                value: "high",
                label: "High",
                description: "More drafting effort."
              },
              {
                value: "xhigh",
                label: "X-High",
                description: "Deepest reasoning."
              }
            ]}
          />

          <SegmentedPicker
            label="Verbosity"
            value={value.verbosity}
            onChange={(verbosity) => setValue({ verbosity })}
            tooltip="OpenAI exposes this as text.verbosity on the Responses API. Lower values keep drafts tighter; higher values let the model write fuller structured output."
            options={[
              {
                value: "low",
                label: "Low",
                description: "Shorter drafts."
              },
              {
                value: "medium",
                label: "Medium",
                description: "Balanced detail."
              },
              {
                value: "high",
                label: "High",
                description: "Richer drafting."
              }
            ]}
          />

          <div className="grid gap-4 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/48">
                Advanced
              </div>
              <div className="mt-2 text-sm leading-6 text-white/56">
                Leave these at the defaults unless you are intentionally routing
                through another compatible endpoint or customizing the drafting
                behavior.
              </div>
            </div>

            <FlowField
              label="Base URL"
              description="Forge defaults to the official OpenAI API endpoint."
            >
              <Input
                value={value.baseUrl}
                onChange={(event) => setValue({ baseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </FlowField>

            <FlowField
              label="System prompt"
              description="Optional custom instructions for how wiki drafts should be structured."
            >
              <Textarea
                value={value.systemPrompt}
                onChange={(event) =>
                  setValue({ systemPrompt: event.target.value })
                }
                className="min-h-36"
                placeholder="Optional system prompt for wiki drafting"
              />
            </FlowField>
          </div>
        </>
      )
    },
    {
      id: "review",
      eyebrow: "Review and test",
      title: "Check the configuration before saving",
      description:
        "Review the final setup, run a live connection test, and then save the profile once the model accepts the configuration.",
      render: (value) => (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-white">
                <Sparkles className="size-4 text-[var(--primary)]" />
                <div className="text-sm font-semibold">Profile summary</div>
              </div>
              <div className="mt-4 grid gap-3 text-sm">
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                    Label
                  </div>
                  <div className="mt-2 text-white">
                    {value.label || "Untitled profile"}
                  </div>
                </div>
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                    Provider
                  </div>
                  <div className="mt-2 text-white">OpenAI Responses API</div>
                </div>
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                    Model
                  </div>
                  <div className="mt-2 text-white">{value.model}</div>
                </div>
              </div>
            </div>

            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-white">
                <KeyRound className="size-4 text-[var(--primary)]" />
                <div className="text-sm font-semibold">Runtime controls</div>
              </div>
              <div className="mt-4 grid gap-3 text-sm">
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                    Key status
                  </div>
                  <div className="mt-2 text-white">
                    {value.apiKey.trim()
                      ? "New key ready to test"
                      : profile?.secretId
                        ? "Saved key available"
                        : "No key saved yet"}
                  </div>
                </div>
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                    Controls
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-white/78">
                      thinking {value.reasoningEffort}
                    </span>
                    <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-white/78">
                      verbosity {value.verbosity}
                    </span>
                  </div>
                </div>
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                    Base URL
                  </div>
                  <div className="mt-2 break-all text-white/72">
                    {value.baseUrl}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">
                  Connection check
                </div>
                <div className="mt-1 text-sm leading-6 text-white/58">
                  Test the exact model and control settings before you save
                  them.
                </div>
              </div>
              <Button
                variant="secondary"
                pending={testMutation.isPending}
                pendingLabel="Testing"
                disabled={!canSubmit}
                onClick={() => void testMutation.mutateAsync()}
              >
                Test connection
              </Button>
            </div>

            {feedback ? (
              <div
                className={cn(
                  "rounded-[20px] border px-4 py-3 text-sm leading-6",
                  feedback.tone === "success"
                    ? "border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-100"
                    : "border-rose-400/18 bg-rose-400/[0.08] text-rose-100"
                )}
              >
                {feedback.message}
              </div>
            ) : null}

            {connectionResult ? (
              <div className="rounded-[20px] border border-emerald-400/18 bg-emerald-400/[0.08] px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-100">
                  <CircleCheckBig className="size-4" />
                  OpenAI accepted this configuration
                </div>
                <div className="mt-2 text-sm leading-6 text-emerald-100/86">
                  Preview: {connectionResult.outputPreview}
                </div>
              </div>
            ) : null}
          </div>
        </>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="OpenAI setup"
      title={profile ? "Update wiki drafting" : "Set up wiki drafting"}
      description="Forge wiki auto-ingest uses the OpenAI Responses API to turn uploads into draft wiki pages and entity proposals before you review them."
      value={form}
      onChange={setForm}
      draftPersistenceKey={
        profile ? `settings.wiki-llm.${profile.id}` : "settings.wiki-llm.new"
      }
      steps={steps}
      submitLabel={profile ? "Update profile" : "Save profile"}
      pending={saveMutation.isPending}
      pendingLabel="Saving"
      error={feedback?.tone === "error" ? feedback.message : null}
      contentClassName="lg:w-[min(60rem,calc(100vw-1.5rem))]"
      onSubmit={async () => {
        if (!canSubmit) {
          setFeedback({
            tone: "error",
            message:
              form.label.trim().length === 0
                ? "Add a profile label before saving."
                : form.model.trim().length === 0
                  ? "Pick a model before saving."
                  : "Add an OpenAI API key or keep using the saved one before saving."
          });
          return;
        }
        await saveMutation.mutateAsync();
      }}
    />
  );
}
