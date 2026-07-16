import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircleQuestion, Radio, ShieldQuestion } from "lucide-react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePeopleGateway } from "@/components/people/people-gateway";
import {
  FreshnessBadge,
  PeopleStateBanner,
  formatPeopleDateTime
} from "@/components/people/people-status";
import type {
  PersonContext,
  QuestionInterpretation,
  QuestionResult
} from "@/components/people/people-types";

type AskDraft = {
  question: string;
  revision: number;
  interpretedRevision: number | null;
  interpretedQuestion: string | null;
  preferLive: boolean;
  interpretation: QuestionInterpretation | null;
  result: QuestionResult | null;
};

function emptyAskDraft(): AskDraft {
  return {
    question: "",
    revision: 0,
    interpretedRevision: null,
    interpretedQuestion: null,
    preferLive: true,
    interpretation: null,
    result: null
  };
}

function sharedInformationLabel(projectionId: string) {
  const knownLabels: Record<string, string> = {
    "calendar.availability.v1": "Calendar availability",
    "goals.horizon_summary.v1": "Goal summaries",
    "health.cycling.aggregate.v1": "Cycling totals",
    "movement.aggregate.v1": "Movement totals",
    "person.profile.v1": "Profile details",
    "custom.selected_entities.v1": "Selected records"
  };
  if (knownLabels[projectionId]) {
    return knownLabels[projectionId];
  }
  const words = projectionId
    .replace(/\.v\d+$/, "")
    .split(".")
    .flatMap((part) => part.split("_"))
    .filter(Boolean);
  const label = words.join(" ");
  return label
    ? `${label[0]!.toUpperCase()}${label.slice(1)}`
    : "Shared information";
}

export function AskPersonFlow({
  open,
  context,
  onOpenChange,
  onReviewIncomingAccess
}: {
  open: boolean;
  context: PersonContext;
  onOpenChange: (open: boolean) => void;
  onReviewIncomingAccess: () => void;
}) {
  const gateway = usePeopleGateway();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AskDraft>(emptyAskDraft);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(emptyAskDraft());
    setSubmitError(null);
  }, [open]);

  const interpretMutation = useMutation({
    mutationFn: (input: { question: string; revision: number }) =>
      gateway.interpretQuestion({
        personId: context.person.id,
        question: input.question
      }),
    onSuccess: (interpretation, input) => {
      setDraft((current) =>
        current.revision === input.revision &&
        current.question === input.question
          ? {
              ...current,
              interpretation,
              interpretedRevision: input.revision,
              interpretedQuestion: input.question,
              result: null
            }
          : current
      );
    }
  });

  const executeMutation = useMutation({
    mutationFn: (input: {
      typedQueryId: string;
      question: string;
      revision: number;
      preferLive: boolean;
    }) =>
      gateway.executeQuestion({
        personId: context.person.id,
        question: input.question,
        typedQueryId: input.typedQueryId,
        preferLive: input.preferLive
      }),
    onSuccess: async (result, input) => {
      setDraft((current) =>
        current.revision === input.revision &&
        current.question === input.question &&
        current.interpretedRevision === input.revision &&
        current.interpretedQuestion === input.question
          ? { ...current, result }
          : current
      );
      await queryClient.invalidateQueries({
        queryKey: ["people", "context", context.person.id]
      });
    }
  });

  const interpretationIsCurrent =
    draft.interpretation !== null &&
    draft.interpretedRevision === draft.revision &&
    draft.interpretedQuestion === draft.question;

  const steps = useMemo<Array<QuestionFlowStep<AskDraft>>>(
    () => [
      {
        id: "question",
        title: `What do you want to ask about ${context.person.displayName}?`,
        description:
          "Forge checks the question here and shows what information it would request before anything is sent. Your wording stays on this Forge.",
        render: (value, setValue) => (
          <div className="grid gap-5">
            <FlowField
              label="Question"
              error={!value.question.trim() ? "Enter a question." : null}
            >
              <Textarea
                autoFocus
                value={value.question}
                onChange={(event) =>
                  setValue({
                    question: event.target.value,
                    revision: value.revision + 1,
                    interpretedRevision: null,
                    interpretedQuestion: null,
                    interpretation: null,
                    result: null
                  })
                }
                autoComplete="off"
                data-sensitive="person-question"
              />
            </FlowField>
            <FlowChoiceGrid
              value={value.question}
              onChange={(question) =>
                setValue({
                  question,
                  revision: value.revision + 1,
                  interpretedRevision: null,
                  interpretedQuestion: null,
                  interpretation: null,
                  result: null
                })
              }
              columns={3}
              options={[
                {
                  value: `What is ${context.person.preferredName ?? context.person.displayName} doing next Monday?`,
                  label: "Next Monday",
                  description:
                    "Shows only the level of availability they chose to share."
                },
                {
                  value: `What is ${context.person.preferredName ?? context.person.displayName}'s main goal this quarter?`,
                  label: "Current goals",
                  description:
                    "Shows only the goal summaries and time range they chose to share."
                },
                {
                  value: `How much is ${context.person.preferredName ?? context.person.displayName} cycling?`,
                  label: "Cycling aggregate",
                  description:
                    "Shows totals. Individual workouts and raw health samples stay hidden."
                }
              ]}
            />
          </div>
        )
      },
      {
        id: "interpretation",
        title: draft.result
          ? "Review the answer"
          : interpretationIsCurrent
            ? "Review what Forge will ask"
            : "Check what can be asked",
        description:
          "Review what will be requested, which permission covers it, whether a current answer is available, and how precise or complete the answer may be.",
        render: (value, setValue) => {
          if (!value.interpretation) {
            return (
              <div className="grid justify-items-center gap-3 rounded-lg border border-dashed border-[var(--ui-border-strong)] px-5 py-8 text-center">
                <MessageCircleQuestion
                  className="size-8 text-[var(--primary)]"
                  aria-hidden="true"
                />
                <p className="max-w-lg text-sm leading-6 text-[var(--ui-ink-medium)]">
                  Forge checks which approved question this matches. Nothing is
                  sent until you review it and continue.
                </p>
              </div>
            );
          }

          if (value.result) {
            return (
              <div className="grid gap-4" data-sensitive="question-result">
                <div className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <FreshnessBadge state={value.result.freshness} />
                    <Badge size="xs" tone="meta">
                      {value.result.live ? "Current answer" : "Saved answer"}
                    </Badge>
                    <Badge size="xs" tone="meta">
                      {value.result.completeness.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <p className="mt-4 text-base leading-7 text-[var(--ui-ink-strong)]">
                    {value.result.answer}
                  </p>
                  <dl className="mt-4 grid gap-3 border-t border-[var(--ui-border-subtle)] pt-4 text-sm text-[var(--ui-ink-medium)] md:grid-cols-2">
                    <div>
                      <dt className="text-[var(--ui-ink-muted)]">
                        Shared information
                      </dt>
                      <dd className="mt-1">
                        <span className="block">
                          {sharedInformationLabel(value.result.projectionId)}
                        </span>
                        <span className="mt-1 block break-all font-mono text-xs">
                          Exact ID: {value.result.projectionId}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--ui-ink-muted)]">
                        Source identity ID
                      </dt>
                      <dd className="mt-1">
                        {value.result.sourcePrincipalId ?? "Unavailable"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--ui-ink-muted)]">
                        Source device ID
                      </dt>
                      <dd className="mt-1">
                        {value.result.sourceDeviceId ?? "Unavailable"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--ui-ink-muted)]">
                        Level of detail
                      </dt>
                      <dd className="mt-1">
                        {value.result.precision.replaceAll("_", " ")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--ui-ink-muted)]">As of</dt>
                      <dd className="mt-1">
                        {formatPeopleDateTime(value.result.asOf)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--ui-ink-muted)]">Received</dt>
                      <dd className="mt-1">
                        {formatPeopleDateTime(value.result.receivedAt)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {value.result.redactions.map((redaction) => (
                      <Badge key={redaction} size="xs" tone="meta" wrap>
                        Hidden: {redaction}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div className="grid gap-4">
              <div className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    size="sm"
                    tone={
                      value.interpretation.status === "supported"
                        ? "signal"
                        : "meta"
                    }
                  >
                    {value.interpretation.status.replaceAll("_", " ")}
                  </Badge>
                  {value.interpretation.projectionId ? (
                    <Badge size="sm" tone="meta" wrap>
                      {sharedInformationLabel(
                        value.interpretation.projectionId
                      )}{" "}
                      · Exact ID: {value.interpretation.projectionId}
                    </Badge>
                  ) : null}
                </div>
                <dl className="mt-4 grid gap-3 text-[var(--ui-ink-medium)] md:grid-cols-2">
                  <div>
                    <dt className="text-[var(--ui-ink-muted)]">
                      What Forge understood
                    </dt>
                    <dd className="mt-1">
                      {value.interpretation.interpretationLabel}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--ui-ink-muted)]">Time range</dt>
                    <dd className="mt-1">
                      {value.interpretation.timeRangeLabel ?? "Not applicable"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--ui-ink-muted)]">
                      Required permission
                    </dt>
                    <dd className="mt-1">
                      {value.interpretation.requiredGrantLabel ??
                        "No matching permission"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--ui-ink-muted)]">
                      Current answer
                    </dt>
                    <dd className="mt-1">
                      {value.interpretation.liveRefreshPossible
                        ? "Available"
                        : "Unavailable"}
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 border-t border-[var(--ui-border-subtle)] pt-4 leading-6 text-[var(--ui-ink-medium)]">
                  {value.interpretation.explanation}
                </p>
              </div>

              {value.interpretation.status === "supported" ? (
                <label className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-info-soft)] p-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                  <input
                    type="checkbox"
                    className="mt-1 size-4"
                    checked={value.preferLive}
                    disabled={!value.interpretation.liveRefreshPossible}
                    onChange={(event) =>
                      setValue({ preferLive: event.target.checked })
                    }
                  />
                  <span className="inline-flex min-w-0 items-start gap-2">
                    <Radio
                      className="mt-1 size-4 shrink-0"
                      aria-hidden="true"
                    />
                    Ask for a current answer when their Forge is reachable. A
                    saved answer will be clearly marked with its date.
                  </span>
                </label>
              ) : (
                <PeopleStateBanner
                  state="warning"
                  title={
                    value.interpretation.status === "missing_grant"
                      ? "A sharing permission is missing"
                      : "This question is unsupported"
                  }
                >
                  <p>{value.interpretation.explanation}</p>
                  {value.interpretation.status === "missing_grant" ? (
                    <>
                      <p className="mt-2">
                        Only {context.person.displayName} can choose to share
                        this information from their Forge. You cannot approve
                        that access for them.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="mt-3 min-h-11"
                        onClick={() => {
                          onOpenChange(false);
                          onReviewIncomingAccess();
                        }}
                      >
                        <ShieldQuestion className="size-4" aria-hidden="true" />
                        Review connection and requests
                      </Button>
                    </>
                  ) : null}
                </PeopleStateBanner>
              )}
            </div>
          );
        }
      }
    ],
    [
      context.person.displayName,
      context.person.preferredName,
      draft.result,
      interpretationIsCurrent,
      onOpenChange,
      onReviewIncomingAccess
    ]
  );

  const pending = interpretMutation.isPending || executeMutation.isPending;
  const mutationError = interpretMutation.error ?? executeMutation.error;
  const submitLabel = draft.result
    ? "Done"
    : !interpretationIsCurrent
      ? "Review question"
      : draft.interpretation?.status === "supported"
        ? "Ask for answer"
        : "Done";

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Ask about a person"
      title={`Ask about ${context.person.displayName}`}
      description="Review exactly what Forge will request, then see where the answer came from and how current it is."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={submitLabel}
      pending={pending}
      pendingLabel={
        interpretMutation.isPending ? "Reviewing question" : "Getting answer"
      }
      error={
        submitError ??
        (mutationError instanceof Error ? mutationError.message : null)
      }
      resolveContinueBlocker={(stepId, value) =>
        stepId === "question" && !value.question.trim()
          ? "Enter or choose a question to continue."
          : null
      }
      onSubmit={async () => {
        setSubmitError(null);
        try {
          if (draft.result) {
            onOpenChange(false);
            return;
          }
          if (!interpretationIsCurrent || !draft.interpretation) {
            if (!draft.question.trim()) {
              setSubmitError("Enter a question first.");
              return;
            }
            await interpretMutation.mutateAsync({
              question: draft.question,
              revision: draft.revision
            });
            return;
          }
          if (
            draft.interpretation.status !== "supported" ||
            !draft.interpretation.typedQueryId
          ) {
            onOpenChange(false);
            return;
          }
          await executeMutation.mutateAsync({
            typedQueryId: draft.interpretation.typedQueryId,
            question: draft.question,
            revision: draft.revision,
            preferLive: draft.preferLive
          });
        } catch {
          // The active mutation error is rendered by the guided flow.
        }
      }}
    />
  );
}
