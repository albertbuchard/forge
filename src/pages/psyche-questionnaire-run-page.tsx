import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";
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
        ? getQuestionnaireVisibilityState(runDetail.version.definition, runDetail.answers)
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
      ? visibleItems[currentIndex] ?? null
      : null;
  const requiredAnswered =
    visibleItems.every(
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
      const filtered = current.answers.filter((entry) => entry.itemId !== item.id);
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

  if (startMutation.isPending || !runDetail) {
    return (
      <LoadingState
        eyebrow="Questionnaire run"
        title="Preparing guided run"
        description="Opening the current questionnaire version, loading any draft answers, and restoring your place."
      />
    );
  }

  if (startMutation.isError) {
    return (
      <ErrorState
        eyebrow="Questionnaire run"
        error={startMutation.error}
        onRetry={() => startMutation.mutate()}
      />
    );
  }

  const progress = progressCount > 0 ? ((currentIndex + 1) / progressCount) * 100 : 0;

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

      <Card className="overflow-hidden bg-[linear-gradient(180deg,rgba(15,23,34,0.98),rgba(8,13,20,0.98))] p-0">
        <div className="border-b border-white/8 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                Progress
              </div>
              <div className="mt-2 text-sm text-white/72">
                Step {currentIndex + 1} of {progressCount}
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-white/56">
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
          <div className="mt-3 h-1.5 rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,rgba(110,231,183,0.92),rgba(125,211,252,0.86))] transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {runDetail.version.definition.presentationMode === "single_question" && currentItem ? (
          <div className="px-5 py-6 sm:px-6">
            <div className="mx-auto max-w-3xl">
              <div className="font-display text-[clamp(1.7rem,3vw,2.4rem)] leading-tight text-white">
                {currentItem.prompt}
              </div>
              <div className="mt-6 grid gap-3">
                {currentItem.options.map((option) => {
                  const selected = answerMap.get(currentItem.id) === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={cn(
                        "rounded-[24px] border px-5 py-5 text-left transition",
                        selected
                          ? "border-[rgba(110,231,183,0.35)] bg-[rgba(110,231,183,0.14)] text-white"
                          : "border-white/8 bg-white/[0.03] text-white/74 hover:bg-white/[0.06]"
                      )}
                      onClick={() =>
                        void updateAnswer(currentItem, option.key, currentIndex)
                      }
                    >
                      <div className="text-base font-medium">{option.label}</div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <Button
                  variant="secondary"
                  disabled={currentIndex === 0}
                  onClick={() => void persistProgressOnly(Math.max(0, currentIndex - 1))}
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
                <div>
                  <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[rgba(110,231,183,0.72)]">
                    {currentSection.title}
                  </div>
                  {currentSection.description ? (
                    <div className="mt-2 text-sm text-white/56">
                      {currentSection.description}
                    </div>
                  ) : null}
                </div>
                <Badge className="bg-white/[0.08] text-white/78">
                  {currentSection.itemIds.length} items
                </Badge>
              </div>

              <div className="mt-6 grid gap-4">
                {currentSection.itemIds.map((itemId) => {
                  const item = visibleItems.find((entry) => entry.id === itemId);
                  if (!item) {
                    return null;
                  }
                  return (
                    <div
                      key={item.id}
                      className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4"
                    >
                      <div className="text-sm leading-6 text-white">
                        {item.prompt}
                      </div>
                      <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                        {item.options.map((option) => {
                          const selected = answerMap.get(item.id) === option.key;
                          return (
                            <button
                              key={option.key}
                              type="button"
                              className={cn(
                                "rounded-[18px] border px-3 py-3 text-sm transition",
                                selected
                                  ? "border-[rgba(110,231,183,0.35)] bg-[rgba(110,231,183,0.14)] text-white"
                                  : "border-white/8 bg-white/[0.03] text-white/66 hover:bg-white/[0.06]"
                              )}
                              onClick={() =>
                                void updateAnswer(item, option.key, currentIndex)
                              }
                            >
                              {option.label}
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
                  onClick={() => void persistProgressOnly(Math.max(0, currentIndex - 1))}
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
