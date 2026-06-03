import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  EmptyState,
  ErrorState,
  LoadingState
} from "@/components/ui/page-state";
import { getQuestionnaireRun } from "@/lib/api";
import { cn } from "@/lib/utils";

const sectionLabelClass =
  "font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const panelCardClass =
  "min-w-0 overflow-hidden border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)]";
const ledgerCardClass =
  "min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4";
const selectedBadgeClass =
  "border border-[color-mix(in_srgb,var(--success)_36%,var(--ui-border-subtle)_64%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_70%,var(--ui-ink-strong)_30%)]";
const idleBadgeClass =
  "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]";

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
  const answersById = new Map(
    detail.answers.map((answer) => [answer.itemId, answer])
  );

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
        <Card className={panelCardClass}>
          <div className={sectionLabelClass}>Stored scores</div>
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
                <div key={score.scoreKey} className={ledgerCardClass}>
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-medium text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
                        {score.label}
                      </div>
                      {score.bandLabel ? (
                        <div className="mt-2 break-words text-xs uppercase tracking-[0.16em] text-[color-mix(in_srgb,var(--success)_74%,var(--ui-ink-strong)_26%)] [overflow-wrap:anywhere]">
                          {score.bandLabel}
                        </div>
                      ) : null}
                    </div>
                    <div className="min-w-0 break-words text-right text-lg font-semibold text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
                      {score.valueText ?? score.valueNumeric ?? "—"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className={panelCardClass}>
          <div className={sectionLabelClass}>Answer ledger</div>
          <div className="mt-4 grid gap-3">
            {detail.version.definition.items.map((item) => {
              const answer = answersById.get(item.id);
              return (
                <div key={item.id} className={ledgerCardClass}>
                  <div className="break-words text-sm font-medium leading-6 text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
                    {item.prompt}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.options.map((option) => {
                      const selected = answer?.optionKey === option.key;
                      return (
                        <Badge
                          key={`${item.id}-${option.key}`}
                          className={cn(
                            "max-w-full break-words [overflow-wrap:anywhere]",
                            selected ? selectedBadgeClass : idleBadgeClass
                          )}
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
