import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { CopyPlus, Play, SquarePen } from "lucide-react";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/page-state";
import { getQuestionnaire } from "@/lib/api";
import type { QuestionnaireInstrumentDetail } from "@/lib/questionnaire-types";

const sectionLabelClass =
  "font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const metricCardClass =
  "min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4";
const metricLabelClass =
  "text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const metricValueClass =
  "mt-2 break-words text-sm font-medium text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]";
const detailLinkClass =
  "block min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4 transition hover:bg-[var(--ui-surface-2)]";

function HistorySparkline({
  history
}: {
  history: QuestionnaireInstrumentDetail["history"];
}) {
  const data = [...history]
    .reverse()
    .filter((entry) => typeof entry.primaryScore === "number");
  if (data.length === 0) {
    return null;
  }
  const values = data.map((entry) => Number(entry.primaryScore));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const points = data.map((entry, index) => {
    const x = data.length === 1 ? 50 : 8 + (index / (data.length - 1)) * 84;
    const y = 84 - ((Number(entry.primaryScore) - min) / span) * 68;
    return {
      x,
      y,
      label: new Date(entry.completedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric"
      }),
      score: Number(entry.primaryScore)
    };
  });
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className="mt-4 min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label="Questionnaire score history"
        className="h-56 w-full overflow-visible"
        preserveAspectRatio="none"
      >
        {[16, 50, 84].map((y) => (
          <line
            key={y}
            x1="6"
            x2="94"
            y1={y}
            y2={y}
            stroke="var(--ui-border-subtle)"
            strokeWidth="0.6"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polyline
          fill="none"
          points={linePoints}
          stroke="var(--success)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((point) => (
          <g key={`${point.label}-${point.score}-${point.x}`}>
            <circle
              cx={point.x}
              cy={point.y}
              r="2.8"
              fill="var(--ui-surface-section)"
              stroke="var(--success)"
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
            />
            <title>{`${point.label}: ${point.score}`}</title>
          </g>
        ))}
      </svg>
      <div className="mt-2 flex min-w-0 flex-wrap justify-between gap-2 text-xs text-[var(--ui-ink-faint)]">
        <span>Oldest {points[0]?.label}</span>
        <span>Latest {points.at(-1)?.label}</span>
      </div>
    </div>
  );
}

export function PsycheQuestionnaireDetailPage() {
  const { instrumentId = "" } = useParams();
  const detailQuery = useQuery({
    queryKey: ["forge-psyche-questionnaire", instrumentId],
    queryFn: () => getQuestionnaire(instrumentId),
    enabled: instrumentId.length > 0
  });

  if (detailQuery.isLoading) {
    return (
      <LoadingState
        eyebrow="Questionnaire"
        title="Loading questionnaire detail"
        description="Hydrating the versioned definition, source provenance, and run history."
      />
    );
  }

  if (detailQuery.isError || !detailQuery.data?.instrument) {
    return (
      <ErrorState
        eyebrow="Questionnaire"
        error={detailQuery.error}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const instrument = detailQuery.data.instrument;
  const version = instrument.currentVersion ?? instrument.draftVersion;
  const canEdit = !instrument.isSystem;

  return (
    <div className="grid gap-5">
      <PageHero
        eyebrow="Psyche"
        title={instrument.title}
        description={instrument.description}
        badge={`${instrument.itemCount} items`}
        actions={
          <>
            <Link to={`/psyche/questionnaires/${instrument.id}/take`}>
              <Button>
                <Play className="mr-2 size-4" />
                Start run
              </Button>
            </Link>
            {canEdit ? (
              <Link to={`/psyche/questionnaires/${instrument.id}/edit`}>
                <Button variant="secondary">
                  <SquarePen className="mr-2 size-4" />
                  Edit draft
                </Button>
              </Link>
            ) : (
              <Link to={`/psyche/questionnaires/${instrument.id}/edit`}>
                <Button variant="secondary">
                  <CopyPlus className="mr-2 size-4" />
                  Clone to draft
                </Button>
              </Link>
            )}
          </>
        }
      />

      <PsycheSectionNav />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
        <Card className="min-w-0 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)]">
          <div className={sectionLabelClass}>
            Guided definition
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className={metricCardClass}>
              <div className={metricLabelClass}>
                Flow
              </div>
              <div className={metricValueClass}>
                {instrument.presentationMode.replaceAll("_", " ")}
              </div>
            </div>
            <div className={metricCardClass}>
              <div className={metricLabelClass}>
                Response style
              </div>
              <div className={metricValueClass}>
                {instrument.responseStyle.replaceAll("_", " ")}
              </div>
            </div>
            <div className={metricCardClass}>
              <div className={metricLabelClass}>
                Version
              </div>
              <div className={metricValueClass}>
                {instrument.currentVersionNumber ? `v${instrument.currentVersionNumber}` : "Draft"}
              </div>
            </div>
          </div>

          {version ? (
            <>
              <p className="mt-5 break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                {version.definition.instructions}
              </p>
              <div className="mt-5 grid gap-3">
                {version.definition.sections.map((section) => (
                  <div
                    key={section.id}
                    className="min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-medium text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
                          {section.title}
                        </div>
                        {section.description ? (
                          <div className="mt-1 break-words text-sm text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                            {section.description}
                          </div>
                        ) : null}
                      </div>
                      <Badge className="shrink-0 border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                        {section.itemIds.length} items
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </Card>

        <div className="grid gap-4">
          <Card className="min-w-0 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)]">
            <div className={sectionLabelClass}>
              Provenance
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge className="border border-[var(--ui-border-subtle)] bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]">
                {instrument.sourceClass.replaceAll("_", " ")}
              </Badge>
              <Badge className="border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                {instrument.availability.replaceAll("_", " ")}
              </Badge>
              {instrument.symptomDomains.map((domain) => (
                <Badge
                  key={domain}
                  className="max-w-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                >
                  {domain}
                </Badge>
              ))}
            </div>

            {version ? (
              <div className="mt-4 grid gap-3">
                {version.provenance.sources.map((source) => (
                  <a
                    key={source.url}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className={detailLinkClass}
                  >
                    <div className="break-words text-sm font-medium text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
                      {source.label}
                    </div>
                    <div className="mt-2 break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                      {source.citation}
                    </div>
                  </a>
                ))}
              </div>
            ) : null}
          </Card>

          <Card className="min-w-0 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)]">
            <div className={sectionLabelClass}>
              History over time
            </div>
            {instrument.history.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  eyebrow="Run history"
                  title="No completed runs yet"
                  description="Complete the first guided run and the longitudinal score trace will appear here."
                />
              </div>
            ) : (
              <>
                <HistorySparkline history={instrument.history} />
                <div className="mt-4 grid gap-3">
                  {instrument.history.slice(0, 5).map((entry) => (
                    <Link
                      key={entry.runId}
                      to={`/psyche/questionnaire-runs/${entry.runId}`}
                      className={detailLinkClass}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="break-words text-sm font-medium text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
                            {entry.primaryScoreLabel || "Primary score"}
                          </div>
                          <div className="mt-1 break-words text-sm text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                            {new Date(entry.completedAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-lg font-semibold text-[var(--ui-ink-strong)]">
                            {entry.primaryScore ?? "—"}
                          </div>
                          {entry.bandLabel ? (
                            <div className="max-w-[10rem] break-words text-xs uppercase tracking-[0.16em] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)] [overflow-wrap:anywhere]">
                              {entry.bandLabel}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
