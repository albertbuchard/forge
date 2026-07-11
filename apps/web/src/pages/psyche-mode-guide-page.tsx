import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import {
  buildModeGuideHypothesis,
  buildModeGuideSessionInput,
  DEFAULT_MODE_GUIDE_DRAFT,
  getModeGuideStepError,
  type ModeGuideDraft
} from "@/components/psyche/mode-guide-model";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import {
  psycheFocusClass,
  usePsycheFocusTarget
} from "@/components/psyche/use-psyche-focus-target";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  EmptyState,
  ErrorState,
  LoadingState
} from "@/components/ui/page-state";
import { Textarea } from "@/components/ui/textarea";
import { createModeGuideSession, listModeGuideSessions } from "@/lib/api";
import {
  collectQueryCollectionState,
  retryQueryCollection
} from "@/lib/query-collection";
import { modeGuideSessionSchema } from "@/lib/psyche-schemas";
import { cn } from "@/lib/utils";

const COPING_OPTIONS = [
  {
    value: "fight",
    label: "Push back",
    description: "I argued, confronted, or tried to regain control."
  },
  {
    value: "flight",
    label: "Get away",
    description: "I escaped, avoided, or became very busy."
  },
  {
    value: "freeze",
    label: "Go still",
    description: "I stalled, blanked, or could not choose a move."
  },
  {
    value: "detach",
    label: "Go distant",
    description: "I numbed out or reduced contact with the feeling."
  },
  {
    value: "comply",
    label: "Yield",
    description: "I gave in to reduce conflict or preserve connection."
  },
  {
    value: "overcompensate",
    label: "Take over",
    description: "I became forceful, perfect, or intensely self-reliant."
  },
  {
    value: "none",
    label: "Mixed or unclear",
    description: "Several responses were present, or none fits yet."
  }
];

const NEED_OPTIONS = [
  { value: "vulnerable", label: "Safety or care" },
  { value: "angry", label: "Fairness or a boundary" },
  { value: "impulsive", label: "Relief or room for a strong need" },
  { value: "lonely", label: "Contact or dependable connection" },
  { value: "ashamed", label: "Acceptance without attack" },
  { value: "none", label: "Not clear yet" }
];

const CRITIC_OPTIONS = [
  {
    value: "demanding",
    label: "Demanding pressure",
    description: "Rules, urgency, perfection, or relentless standards."
  },
  {
    value: "punitive",
    label: "Punishing pressure",
    description: "Blame, contempt, threats, or attacks on worth."
  },
  {
    value: "none",
    label: "Neither or unclear",
    description: "No clear critical voice, or it is difficult to name."
  }
];

const HEALTHY_OPTIONS = [
  {
    value: "healthy_adult",
    label: "Steady perspective",
    description: "Some realistic, caring leadership was available."
  },
  {
    value: "happy_child",
    label: "Playful aliveness",
    description: "Some curiosity, ease, or uncomplicated enjoyment remained."
  },
  {
    value: "none",
    label: "Hard to reach",
    description: "Neither felt available, or I am not sure."
  }
];

const NEXT_RESPONSE_OPTIONS = [
  { value: "ground", label: "Settle my body first" },
  { value: "name_need", label: "Name the need without judging it" },
  { value: "set_boundary", label: "State one clear boundary" },
  { value: "small_value_move", label: "Take one small values-led action" },
  { value: "seek_support", label: "Ask a trusted person for support" },
  { value: "pause", label: "Pause without deciding yet" }
];

type ModeGuideChoice = {
  value: string;
  label: string;
  description?: string;
};

function ModeGuideChoiceGrid({
  ariaLabel,
  options,
  value,
  onChange,
  columns = 2
}: {
  ariaLabel: string;
  options: ModeGuideChoice[];
  value: string;
  onChange: (value: string) => void;
  columns?: 2 | 3;
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % options.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + options.length) % options.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextOption = options[nextIndex];
    if (!nextOption) {
      return;
    }
    onChange(nextOption.value);
    optionRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "grid min-w-0 max-w-full gap-3",
        columns === 3 ? "md:grid-cols-3" : "md:grid-cols-2"
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === tabbableIndex ? 0 : -1}
            className={cn(
              "min-w-0 max-w-full overflow-hidden rounded-[22px] border px-4 py-4 text-left transition",
              selected
                ? "border-[var(--primary)]/28 bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)] shadow-[var(--ui-shadow-soft)]"
                : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]"
            )}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <div className="min-w-0 break-words font-medium">
              {option.label}
            </div>
            {option.description ? (
              <div className="mt-2 min-w-0 break-words text-sm leading-6 text-[var(--ui-ink-soft)]">
                {option.description}
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function PsycheModeGuidePage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const focusedSessionId = searchParams.get("focus")?.trim() || null;
  const [guideOpen, setGuideOpen] = useState(false);
  const [draft, setDraft] = useState<ModeGuideDraft>(DEFAULT_MODE_GUIDE_DRAFT);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [outcomeMessage, setOutcomeMessage] = useState<string | null>(null);
  usePsycheFocusTarget(focusedSessionId);

  const sessionsQuery = useQuery({
    queryKey: ["forge-psyche-mode-guide-sessions"],
    queryFn: listModeGuideSessions
  });

  const guideMutation = useMutation({
    mutationFn: createModeGuideSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["forge-psyche-mode-guide-sessions"]
      });
    }
  });

  const routeQueries = [sessionsQuery] as const;
  const routeState = collectQueryCollectionState(routeQueries);
  const latestSession =
    (focusedSessionId
      ? sessionsQuery.data?.sessions?.find(
          (session) => session.id === focusedSessionId
        )
      : null) ??
    guideMutation.data?.session ??
    sessionsQuery.data?.sessions?.[0];
  const hypothesis = useMemo(() => buildModeGuideHypothesis(draft), [draft]);

  const openGuide = () => {
    setDraft(DEFAULT_MODE_GUIDE_DRAFT);
    setFlowError(null);
    setOutcomeMessage(null);
    guideMutation.reset();
    setGuideOpen(true);
  };

  const finishGuide = async () => {
    const requiredSteps = ["moment", "check", "next-response", "consent"];
    const firstError = requiredSteps
      .map((stepId) => getModeGuideStepError(stepId, draft))
      .find((error) => error !== undefined);
    if (firstError) {
      setFlowError(firstError);
      return;
    }

    if (draft.saveDecision === "defer") {
      setGuideOpen(false);
      setDraft(DEFAULT_MODE_GUIDE_DRAFT);
      setOutcomeMessage(
        "Reflection closed without saving a Psyche record. You can return when it feels useful."
      );
      return;
    }

    try {
      setFlowError(null);
      const payload = modeGuideSessionSchema.parse(
        buildModeGuideSessionInput(draft)
      );
      await guideMutation.mutateAsync(payload);
      setGuideOpen(false);
      setDraft(DEFAULT_MODE_GUIDE_DRAFT);
      setOutcomeMessage(
        "Guided session saved. It remains a tentative reading, not a durable mode profile."
      );
    } catch (error) {
      setFlowError(
        error instanceof Error
          ? error.message
          : "The guided session could not be saved. Nothing new was written."
      );
    }
  };

  const steps: Array<QuestionFlowStep<ModeGuideDraft>> = [
    {
      id: "moment",
      eyebrow: "Start in your words",
      title: "What was happening, and what felt most important?",
      description:
        "Begin with the moment as you experienced it. Forge will listen for a possible function before offering any label.",
      render: (value, setValue) => (
        <FlowField
          label="Your account"
          hint="This is not saved unless you explicitly choose Save on the final step."
          error={getModeGuideStepError("moment", value)}
        >
          <Textarea
            autoFocus
            rows={7}
            value={value.summary}
            onChange={(event) => setValue({ summary: event.target.value })}
            placeholder="For example: I got a short reply, felt my chest tighten, and started assuming I had done something wrong."
          />
        </FlowField>
      )
    },
    {
      id: "coping",
      eyebrow: "Protective response",
      title: "What did your system seem to do next?",
      description:
        "Choose the closest observable response. Mixed or unclear is a complete answer.",
      render: (value, setValue) => (
        <ModeGuideChoiceGrid
          ariaLabel="Protective response"
          columns={2}
          value={value.copingResponse}
          onChange={(copingResponse) => setValue({ copingResponse })}
          options={COPING_OPTIONS}
        />
      )
    },
    {
      id: "need",
      eyebrow: "Possible need",
      title: "What might the response have been trying to protect?",
      description:
        "This is a functional hypothesis, not a claim about your motives.",
      render: (value, setValue) => (
        <ModeGuideChoiceGrid
          ariaLabel="Possible protected need"
          value={value.childState}
          onChange={(childState) => setValue({ childState })}
          options={NEED_OPTIONS}
        />
      )
    },
    {
      id: "pressure",
      eyebrow: "Inner pressure",
      title: "Did a critical voice add pressure?",
      description:
        "Name the tone only if it was present. There is no need to manufacture one.",
      render: (value, setValue) => (
        <ModeGuideChoiceGrid
          ariaLabel="Critical voice"
          value={value.criticStyle}
          onChange={(criticStyle) => setValue({ criticStyle })}
          options={CRITIC_OPTIONS}
        />
      )
    },
    {
      id: "contact",
      eyebrow: "Available capacity",
      title: "What supportive capacity was still reachable?",
      description:
        "Hard to reach is valid. The guide should not turn difficulty into failure.",
      render: (value, setValue) => (
        <ModeGuideChoiceGrid
          ariaLabel="Supportive capacity"
          value={value.healthyContact}
          onChange={(healthyContact) => setValue({ healthyContact })}
          options={HEALTHY_OPTIONS}
        />
      )
    },
    {
      id: "check",
      eyebrow: "Check the reflection",
      title: "Does this working hypothesis fit your experience?",
      description: hypothesis,
      render: (value, setValue) => (
        <div className="grid gap-5">
          <ModeGuideChoiceGrid
            ariaLabel="Working hypothesis fit"
            value={value.interpretationStance}
            onChange={(interpretationStance) =>
              setValue({
                interpretationStance:
                  interpretationStance as ModeGuideDraft["interpretationStance"]
              })
            }
            options={[
              { value: "fits", label: "Yes, this fits" },
              { value: "partly", label: "Partly; I want to correct it" },
              { value: "uncertain", label: "I am not sure yet" },
              { value: "decline", label: "No; do not use this reading" }
            ]}
          />
          {value.interpretationStance === "partly" ||
          value.interpretationStance === "decline" ? (
            <FlowField
              label="Your correction"
              description="Your words take precedence over the suggested interpretation."
            >
              <Textarea
                rows={4}
                value={value.correction}
                onChange={(event) =>
                  setValue({ correction: event.target.value })
                }
                placeholder="What did Forge misunderstand or miss?"
              />
            </FlowField>
          ) : null}
        </div>
      )
    },
    {
      id: "next-response",
      eyebrow: "Next response",
      title: "What is the smallest useful response now?",
      description:
        "Choose support rather than a verdict. Pausing without action remains available.",
      render: (value, setValue) => (
        <ModeGuideChoiceGrid
          ariaLabel="Next response"
          value={value.nextResponse}
          onChange={(nextResponse) => setValue({ nextResponse })}
          options={NEXT_RESPONSE_OPTIONS}
        />
      )
    },
    {
      id: "consent",
      eyebrow: "Your control",
      title: "What should happen to this reflection?",
      description:
        "Saving creates one guided-session record. It does not create or update a durable mode profile. Deferring closes the flow without an API write.",
      render: (value, setValue) => (
        <ModeGuideChoiceGrid
          ariaLabel="Save decision"
          value={value.saveDecision}
          onChange={(saveDecision) =>
            setValue({
              saveDecision: saveDecision as ModeGuideDraft["saveDecision"]
            })
          }
          options={[
            {
              value: "save",
              label: "Save guided session",
              description:
                "Keep your account, answers, correction, and next response."
            },
            {
              value: "defer",
              label: "Keep this unsaved",
              description: "Close now without creating a Psyche record."
            }
          ]}
        />
      )
    }
  ];

  if (routeState.isLoading) {
    return (
      <LoadingState
        eyebrow="Mode guide"
        title="Loading guided sessions"
        description="Hydrating previous mode-guide runs and the latest stored readings."
      />
    );
  }

  if (routeState.error) {
    return (
      <ErrorState
        eyebrow="Mode guide"
        error={routeState.error}
        onRetry={() => void retryQueryCollection(routeQueries)}
      />
    );
  }

  return (
    <div className="grid gap-5">
      <PageHero
        eyebrow="Mode guide"
        title="Guided Mode Identification"
        description="Describe one moment in your own words, test a tentative functional hypothesis, and choose what happens before anything is saved."
        badge={`${sessionsQuery.data?.sessions.length ?? 0} sessions`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/psyche/modes">
              <Button variant="secondary">Back to mode map</Button>
            </Link>
            <Button onClick={openGuide}>Start guided reflection</Button>
          </div>
        }
      />
      <PsycheSectionNav />

      {outcomeMessage ? (
        <div
          role="status"
          className="rounded-[var(--radius-panel)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-medium)]"
        >
          {outcomeMessage}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
        <div className="grid content-start gap-5">
          <Card className="bg-[var(--ui-surface-section)]">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Latest working reading
            </div>
            {!latestSession ? (
              <div className="mt-4">
                <EmptyState
                  eyebrow="Guided reading"
                  title="No guided sessions yet"
                  description="Start with one moment. You can correct, decline, or defer the interpretation before anything is saved."
                  action={<Button onClick={openGuide}>Start reflection</Button>}
                />
              </div>
            ) : (
              <div className="mt-4 grid gap-4">
                <div className="text-sm leading-6 text-[var(--ui-ink-medium)]">
                  Your account: {latestSession.summary}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {latestSession.results.map((result) => (
                    <div
                      key={`${result.family}:${result.label}`}
                      className="min-w-0 rounded-[var(--radius-panel)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 break-words font-medium text-[var(--ui-ink-strong)]">
                          {result.label}
                        </div>
                        <Badge className="text-[var(--ui-ink-medium)]">
                          {Math.round(result.confidence * 100)}% tentative
                        </Badge>
                      </div>
                      <div className="mt-2 text-xs uppercase text-[var(--ui-ink-faint)]">
                        Working hypothesis ·{" "}
                        {result.family.replaceAll("_", " ")}
                      </div>
                      <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                        {result.reasoning}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs leading-5 text-[var(--ui-ink-faint)]">
                  These rule-based readings organize reflection; they are not
                  diagnoses or causal claims.
                </div>
              </div>
            )}
          </Card>
        </div>

        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Session history
          </div>
          <div className="mt-4 grid gap-3">
            {(sessionsQuery.data?.sessions ?? []).length === 0 ? (
              <EmptyState
                eyebrow="Session history"
                title="No stored guide history"
                description="Only sessions you explicitly save will appear here."
              />
            ) : (
              (sessionsQuery.data?.sessions ?? []).map((session) => (
                <div
                  key={session.id}
                  data-psyche-focus-id={session.id}
                  aria-current={
                    focusedSessionId === session.id ? "true" : undefined
                  }
                  className={`min-w-0 rounded-[var(--radius-panel)] border border-transparent bg-[var(--ui-surface-1)] p-4 ${psycheFocusClass(
                    focusedSessionId === session.id
                  )}`}
                >
                  <div className="break-words font-medium text-[var(--ui-ink-strong)]">
                    {session.summary}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {session.results.map((result) => (
                      <Badge
                        key={`${session.id}:${result.label}`}
                        className="max-w-full text-[var(--ui-ink-medium)]"
                      >
                        <span className="truncate">{result.label}</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <QuestionFlowDialog
        open={guideOpen}
        onOpenChange={setGuideOpen}
        eyebrow="Mode guide"
        title="Reflect on one moment"
        description="A one-question-at-a-time reflection with correction and save control."
        value={draft}
        onChange={(value) => {
          setDraft(value);
          setFlowError(null);
        }}
        steps={steps}
        submitLabel={
          draft.saveDecision === "defer" ? "Close unsaved" : "Save session"
        }
        pending={guideMutation.isPending}
        pendingLabel="Saving session"
        error={flowError}
        resolveError={(stepId) => getModeGuideStepError(stepId, draft)}
        resolveContinueNudge={(stepId, value) =>
          getModeGuideStepError(stepId, value)
        }
        onSubmit={finishGuide}
      />
    </div>
  );
}
