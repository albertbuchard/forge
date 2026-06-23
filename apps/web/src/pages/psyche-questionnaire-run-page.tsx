import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  LoaderCircle
} from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  completeQuestionnaireAssessment,
  patchQuestionnaireRun,
  startQuestionnaireRun
} from "@/lib/api";
import { getQuestionnaireVisibilityState } from "@/lib/questionnaire-flow";
import type {
  QuestionnaireAnswerInput,
  QuestionnaireItem,
  QuestionnaireRunDetail,
  QuestionnaireSection
} from "@/lib/questionnaire-types";
import { cn } from "@/lib/utils";

const sectionLabelClass =
  "font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const optionButtonClass =
  "min-w-0 rounded-[8px] border px-5 py-5 text-left transition";
const compactOptionButtonClass =
  "min-w-0 rounded-[8px] border px-3 py-3 text-sm transition";
const selectedOptionClass =
  "border-[color-mix(in_srgb,var(--success)_42%,var(--ui-border-subtle)_58%)] bg-[var(--ui-success-soft)] text-[var(--ui-ink-strong)]";
const idleOptionClass =
  "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-2)]";

function toAnswer(
  item: QuestionnaireItem,
  optionKey: string
): QuestionnaireAnswerInput | null {
  const option = item.options.find((entry) => entry.key === optionKey);
  if (!option) {
    return null;
  }
  return {
    itemId: item.id,
    optionKey: option.key,
    valueText: option.label,
    numericValue: option.value,
    answer: {
      label: option.label,
      value: option.value
    }
  };
}

export function PsycheQuestionnaireRunPage() {
  const { instrumentId = "" } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<QuestionnaireRunDetail | null>(null);

  const startMutation = useMutation({
    mutationFn: () =>
      startQuestionnaireRun(instrumentId, {
        userId: "user_operator"
      }),
    onSuccess: (payload) => setDetail(payload)
  });

  const patchMutation = useMutation({
    mutationFn: (input: {
      answers: QuestionnaireAnswerInput[];
      progressIndex: number;
    }) => patchQuestionnaireRun(detail!.run.id, input),
    onSuccess: (payload) => setDetail(payload)
  });

  const completeMutation = useMutation({
    mutationFn: () => completeQuestionnaireAssessment(detail!.run.id),
    onSuccess: (payload) => {
      setDetail(payload);
      navigate(`/psyche/questionnaire-runs/${payload.run.id}`);
    }
  });

  useEffect(() => {
    if (!instrumentId) {
      return;
    }
    startMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentId]);

  const runDetail = detail;
  const answerMap = useMemo(
    () =>
      new Map(
        (runDetail?.answers ?? []).map((answer) => [
          answer.itemId,
          answer.optionKey ?? ""
        ])
      ),
    [runDetail]
  );

  const sections = runDetail?.version.definition.sections ?? [];
  const items = runDetail?.version.definition.items ?? [];
  const visibility = useMemo(
    () =>
      runDetail
        ? getQuestionnaireVisibilityState(
            runDetail.version.definition,
            runDetail.answers
          )
        : {
            visibleItemIds: new Set<string>(),
            visibleSectionIds: new Set<string>(),
            visibleItemIdsBySection: new Map<string, string[]>()
          },
    [runDetail]
  );
  const visibleItems = useMemo(
    () => items.filter((item) => visibility.visibleItemIds.has(item.id)),
    [items, visibility]
  );
  const visibleSections = useMemo(
    () =>
      sections
        .filter((section) => visibility.visibleSectionIds.has(section.id))
        .map((section) => ({
          ...section,
          itemIds: visibility.visibleItemIdsBySection.get(section.id) ?? []
        })),
    [sections, visibility]
  );
  const progressCount =
    runDetail?.version.definition.presentationMode === "single_question"
      ? visibleItems.length
      : visibleSections.length;
  const currentIndex =
    progressCount > 0
      ? Math.min(runDetail?.run.progressIndex ?? 0, progressCount - 1)
      : 0;
  const currentSection = visibleSections[currentIndex] ?? null;
  const currentItem =
    runDetail?.version.definition.presentationMode === "single_question"
      ? (visibleItems[currentIndex] ?? null)
      : null;
  const requiredAnswered = visibleItems.every(
    (item) => !item.required || answerMap.has(item.id)
  );

  const persistProgressOnly = async (progressIndex: number) => {
    if (!runDetail) {
      return;
    }
    setDetail((current) =>
      current
        ? {
            ...current,
            run: {
              ...current.run,
              progressIndex
            }
          }
        : current
    );
    await patchMutation.mutateAsync({
      answers: [],
      progressIndex
    });
  };

  const updateAnswer = async (
    item: QuestionnaireItem,
    optionKey: string,
    progressIndex: number
  ) => {
    const answer = toAnswer(item, optionKey);
    if (!answer || !runDetail) {
      return;
    }
    setDetail((current) => {
      if (!current) {
        return current;
      }
      const filtered = current.answers.filter(
        (entry) => entry.itemId !== item.id
      );
      return {
        ...current,
        run: {
          ...current.run,
          progressIndex
        },
        answers: [
          ...filtered,
          {
            ...answer,
            optionKey: answer.optionKey ?? null,
            numericValue: answer.numericValue ?? null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ]
      };
    });
    await patchMutation.mutateAsync({
      answers: [answer],
      progressIndex
    });
  };

  if (startMutation.isError) {
    return (
      <ErrorState
        eyebrow="Questionnaire run"
        error={startMutation.error}
        onRetry={() => startMutation.mutate()}
      />
    );
  }

  if (startMutation.isPending || !runDetail) {
    return (
      <LoadingState
        eyebrow="Questionnaire run"
        title="Preparing guided run"
        description="Opening the current questionnaire version, loading any draft answers, and restoring your place."
      />
    );
  }

  const progress =
    progressCount > 0 ? ((currentIndex + 1) / progressCount) * 100 : 0;

  return (
    <div className="grid gap-5">
      <PageHero
        eyebrow="Guided questionnaire"
        title={runDetail.instrument.title}
        description={runDetail.version.definition.instructions}
        badge={`v${runDetail.version.versionNumber}`}
        actions={
          <Link to={`/psyche/questionnaires/${runDetail.instrument.id}`}>
            <Button variant="secondary">Back to detail</Button>
          </Link>
        }
      />

      <Card className="min-w-0 overflow-hidden border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-0">
        <div className="border-b border-[var(--ui-border-subtle)] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className={sectionLabelClass}>Progress</div>
              <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
                Step {currentIndex + 1} of {progressCount}
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--ui-ink-soft)]">
              {patchMutation.isPending ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Autosaving
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-4 text-[var(--tertiary)]" />
                  Saved
                </>
              )}
            </div>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-[var(--ui-surface-2)]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--success),var(--info))] transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {runDetail.version.definition.presentationMode === "single_question" &&
        currentItem ? (
          <div className="px-5 py-6 sm:px-6">
            <div className="mx-auto grid max-w-3xl gap-6">
              <div className="min-w-0 break-words font-display text-[clamp(1.7rem,3vw,2.4rem)] leading-tight text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
                {currentItem.prompt}
              </div>
              <div className="grid gap-3">
                {currentItem.options.map((option) => {
                  const selected = answerMap.get(currentItem.id) === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={cn(
                        optionButtonClass,
                        selected ? selectedOptionClass : idleOptionClass
                      )}
                      onClick={() =>
                        void updateAnswer(currentItem, option.key, currentIndex)
                      }
                    >
                      <div className="break-words text-base font-medium [overflow-wrap:anywhere]">
                        {option.label}
                      </div>
                      {option.description ? (
                        <div className="mt-2 break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                          {option.description}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  variant="secondary"
                  disabled={currentIndex === 0}
                  onClick={() =>
                    void persistProgressOnly(Math.max(0, currentIndex - 1))
                  }
                >
                  <ArrowLeft className="mr-2 size-4" />
                  Previous
                </Button>

                {currentIndex < visibleItems.length - 1 ? (
                  <Button
                    onClick={() =>
                      void persistProgressOnly(
                        Math.min(visibleItems.length - 1, currentIndex + 1)
                      )
                    }
                  >
                    Next
                    <ArrowRight className="ml-2 size-4" />
                  </Button>
                ) : (
                  <Button
                    disabled={!requiredAnswered || completeMutation.isPending}
                    onClick={() => completeMutation.mutate()}
                  >
                    Finish and score
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : currentSection ? (
          <div className="px-5 py-6 sm:px-6">
            <div className="mx-auto max-w-5xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className={sectionLabelClass}>
                    {currentSection.title}
                  </div>
                  {currentSection.description ? (
                    <div className="mt-2 break-words text-sm text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                      {currentSection.description}
                    </div>
                  ) : null}
                </div>
                <Badge className="shrink-0 border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                  {currentSection.itemIds.length} items
                </Badge>
              </div>

              <div className="mt-6 grid gap-4">
                {currentSection.itemIds.map((itemId) => {
                  const item = visibleItems.find(
                    (entry) => entry.id === itemId
                  );
                  if (!item) {
                    return null;
                  }
                  return (
                    <div
                      key={item.id}
                      className="min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4"
                    >
                      <div className="break-words text-sm leading-6 text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
                        {item.prompt}
                      </div>
                      <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                        {item.options.map((option) => {
                          const selected =
                            answerMap.get(item.id) === option.key;
                          return (
                            <button
                              key={option.key}
                              type="button"
                              className={cn(
                                compactOptionButtonClass,
                                selected ? selectedOptionClass : idleOptionClass
                              )}
                              onClick={() =>
                                void updateAnswer(
                                  item,
                                  option.key,
                                  currentIndex
                                )
                              }
                            >
                              <span className="break-words [overflow-wrap:anywhere]">
                                {option.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <Button
                  variant="secondary"
                  disabled={currentIndex === 0}
                  onClick={() =>
                    void persistProgressOnly(Math.max(0, currentIndex - 1))
                  }
                >
                  <ArrowLeft className="mr-2 size-4" />
                  Previous section
                </Button>

                {currentIndex < visibleSections.length - 1 ? (
                  <Button
                    onClick={() =>
                      void persistProgressOnly(
                        Math.min(visibleSections.length - 1, currentIndex + 1)
                      )
                    }
                  >
                    Next section
                    <ArrowRight className="ml-2 size-4" />
                  </Button>
                ) : (
                  <Button
                    disabled={!requiredAnswered || completeMutation.isPending}
                    onClick={() => completeMutation.mutate()}
                  >
                    Finish and score
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
