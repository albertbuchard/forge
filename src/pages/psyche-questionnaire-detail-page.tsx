import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { CopyPlus, Play, SquarePen } from "lucide-react";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/page-state";
import { getQuestionnaire } from "@/lib/api";

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
        <Card className="bg-[linear-gradient(180deg,rgba(15,23,34,0.98),rgba(9,14,22,0.96))]">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[rgba(110,231,183,0.74)]">
            Guided definition
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-[22px] bg-white/[0.04] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                Flow
              </div>
              <div className="mt-2 text-sm text-white/84">
                {instrument.presentationMode.replaceAll("_", " ")}
              </div>
            </div>
            <div className="rounded-[22px] bg-white/[0.04] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                Response style
              </div>
              <div className="mt-2 text-sm text-white/84">
                {instrument.responseStyle.replaceAll("_", " ")}
              </div>
            </div>
            <div className="rounded-[22px] bg-white/[0.04] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                Version
              </div>
              <div className="mt-2 text-sm text-white/84">
                {instrument.currentVersionNumber ? `v${instrument.currentVersionNumber}` : "Draft"}
              </div>
            </div>
          </div>

          {version ? (
            <>
              <p className="mt-5 text-sm leading-6 text-white/62">
                {version.definition.instructions}
              </p>
              <div className="mt-5 grid gap-3">
                {version.definition.sections.map((section) => (
                  <div
                    key={section.id}
                    className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">
                          {section.title}
                        </div>
                        {section.description ? (
                          <div className="mt-1 text-sm text-white/54">
                            {section.description}
                          </div>
                        ) : null}
                      </div>
                      <Badge className="bg-white/[0.08] text-white/78">
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
          <Card className="bg-[linear-gradient(180deg,rgba(17,25,34,0.98),rgba(10,15,24,0.96))]">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
              Provenance
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge className="bg-[rgba(125,211,252,0.12)] text-sky-100/88">
                {instrument.sourceClass.replaceAll("_", " ")}
              </Badge>
              <Badge className="bg-[rgba(192,193,255,0.12)] text-white/84">
                {instrument.availability.replaceAll("_", " ")}
              </Badge>
              {instrument.symptomDomains.map((domain) => (
                <Badge key={domain} className="bg-white/[0.06] text-white/72">
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
                    className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4 transition hover:bg-white/[0.05]"
                  >
                    <div className="text-sm font-medium text-white">
                      {source.label}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-white/56">
                      {source.citation}
                    </div>
                  </a>
                ))}
              </div>
            ) : null}
          </Card>

          <Card className="bg-[linear-gradient(180deg,rgba(15,23,33,0.98),rgba(9,15,23,0.96))]">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
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
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={[...instrument.history].reverse()}>
                      <XAxis
                        dataKey="completedAt"
                        tickFormatter={(value) =>
                          new Date(value).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric"
                          })
                        }
                        stroke="rgba(255,255,255,0.38)"
                      />
                      <YAxis stroke="rgba(255,255,255,0.38)" />
                      <Tooltip
                        contentStyle={{
                          background: "rgba(10,15,24,0.96)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 18
                        }}
                        labelFormatter={(value) =>
                          new Date(String(value)).toLocaleString()
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="primaryScore"
                        stroke="rgba(110,231,183,0.95)"
                        strokeWidth={3}
                        dot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 grid gap-3">
                  {instrument.history.slice(0, 5).map((entry) => (
                    <Link
                      key={entry.runId}
                      to={`/psyche/questionnaire-runs/${entry.runId}`}
                      className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4 transition hover:bg-white/[0.05]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-white">
                            {entry.primaryScoreLabel || "Primary score"}
                          </div>
                          <div className="mt-1 text-sm text-white/56">
                            {new Date(entry.completedAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-white">
                            {entry.primaryScore ?? "—"}
                          </div>
                          {entry.bandLabel ? (
                            <div className="text-xs uppercase tracking-[0.16em] text-[rgba(110,231,183,0.78)]">
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
