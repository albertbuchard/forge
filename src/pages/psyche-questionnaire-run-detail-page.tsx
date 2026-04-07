import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/page-state";
import { getQuestionnaireRun } from "@/lib/api";

export function PsycheQuestionnaireRunDetailPage() {
  const { runId = "" } = useParams();
  const runQuery = useQuery({
    queryKey: ["forge-psyche-questionnaire-run", runId],
    queryFn: () => getQuestionnaireRun(runId),
    enabled: runId.length > 0
  });

  if (runQuery.isLoading) {
    return (
      <LoadingState
        eyebrow="Questionnaire result"
        title="Loading scored run"
        description="Hydrating the recorded answers, stored scores, and longitudinal context."
      />
    );
  }

  if (runQuery.isError || !runQuery.data) {
    return (
      <ErrorState
        eyebrow="Questionnaire result"
        error={runQuery.error}
        onRetry={() => void runQuery.refetch()}
      />
    );
  }

  const detail = runQuery.data;
  const answersById = new Map(detail.answers.map((answer) => [answer.itemId, answer]));

  return (
    <div className="grid gap-5">
      <PageHero
        eyebrow="Questionnaire result"
        title={detail.instrument.title}
        description="Stored raw answers, computed scores, and score history all remain attached to the exact version used for this run."
        badge={detail.run.completedAt ? "Completed" : "Draft"}
        actions={
          <>
            <Link to={`/psyche/questionnaires/${detail.instrument.id}`}>
              <Button variant="secondary">Back to questionnaire</Button>
            </Link>
            <Link to={`/psyche/questionnaires/${detail.instrument.id}/take`}>
              <Button>Take again</Button>
            </Link>
          </>
        }
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(18rem,1.1fr)]">
        <Card className="bg-[linear-gradient(180deg,rgba(16,24,34,0.98),rgba(10,15,24,0.96))]">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
            Stored scores
          </div>
          {detail.scores.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                eyebrow="Scores"
                title="No scores stored yet"
                description="This run has not been completed, so there are no persisted score rows yet."
              />
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {detail.scores.map((score) => (
                <div
                  key={score.scoreKey}
                  className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        {score.label}
                      </div>
                      {score.bandLabel ? (
                        <div className="mt-2 text-xs uppercase tracking-[0.16em] text-[rgba(110,231,183,0.74)]">
                          {score.bandLabel}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right text-lg font-semibold text-white">
                      {score.valueText ?? score.valueNumeric ?? "—"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="bg-[linear-gradient(180deg,rgba(15,23,33,0.98),rgba(9,15,23,0.96))]">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
            Answer ledger
          </div>
          <div className="mt-4 grid gap-3">
            {detail.version.definition.items.map((item) => {
              const answer = answersById.get(item.id);
              return (
                <div
                  key={item.id}
                  className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4"
                >
                  <div className="text-sm font-medium leading-6 text-white">
                    {item.prompt}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.options.map((option) => {
                      const selected = answer?.optionKey === option.key;
                      return (
                        <Badge
                          key={`${item.id}-${option.key}`}
                          className={
                            selected
                              ? "bg-[rgba(110,231,183,0.16)] text-[rgba(187,247,208,0.94)]"
                              : "bg-white/[0.05] text-white/54"
                          }
                        >
                          {option.label}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </section>
    </div>
  );
}
