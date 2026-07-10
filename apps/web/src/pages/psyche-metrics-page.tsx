import { useQuery } from "@tanstack/react-query";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import {
  DevrageRageFigure,
  MetricDetailSections,
  SpotlightCard,
  formatDateKey,
  type DailyMetricCategoryGroup
} from "@/components/metrics/daily-metrics-dashboard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { getPsycheMetricsView } from "@/lib/api";
import type { PsycheMetricsViewData } from "@/lib/psyche-types";
import { metricTone } from "@/components/metrics/daily-metrics-dashboard";
import { cn } from "@/lib/utils";

function formatCount(value: number) {
  return new Intl.NumberFormat().format(Math.round(value));
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function groupMetrics(
  metrics: PsycheMetricsViewData
): DailyMetricCategoryGroup[] {
  return metrics.summary.categoryBreakdown.map((category) => ({
    ...category,
    metrics: metrics.metrics.filter(
      (metric) => metric.category === category.category
    )
  }));
}

function EmptyPsycheMetrics() {
  return (
    <Card className="rounded-[30px] border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-6">
      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
        No daily metrics yet
      </div>
      <div className="mt-2 text-2xl font-semibold text-[var(--ui-ink-strong)]">
        Psyche metrics will appear after the first local backfill finds
        conversations.
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
        This surface stays quiet until Forge has stored daily metric rows. It
        does not run the scanner while rendering the page.
      </p>
    </Card>
  );
}

export function PsycheMetricsPage() {
  const metricsQuery = useQuery({
    queryKey: ["forge-psyche-metrics-view"],
    queryFn: async () => (await getPsycheMetricsView()).metrics
  });

  if (metricsQuery.isLoading) {
    return (
      <LoadingState
        title="Loading Psyche metrics"
        description="Reading stored daily metric rows and summary statistics."
      />
    );
  }

  if (metricsQuery.isError || !metricsQuery.data) {
    return (
      <ErrorState
        eyebrow="Psyche metrics"
        error={metricsQuery.error ?? new Error("Psyche metrics unavailable")}
        onRetry={() => void metricsQuery.refetch()}
      />
    );
  }

  const metrics = metricsQuery.data;
  const groups = groupMetrics(metrics);
  const swearMetric =
    metrics.metrics.find((metric) => metric.metric === "devrageSwearCount") ??
    null;
  const percentMetric =
    metrics.metrics.find(
      (metric) => metric.metric === "swearingMessagePercent"
    ) ?? null;
  const averageRageMetric =
    metrics.metrics.find(
      (metric) => metric.metric === "devrageAverageMaxCumulativeRage"
    ) ?? null;
  const maxRageMetric =
    metrics.metrics.find(
      (metric) => metric.metric === "devrageMaxCumulativeRage"
    ) ?? null;

  return (
    <div className="mx-auto grid w-full max-w-[1380px] gap-5">
      <PageHero
        title="Psyche Metrics"
        titleText="Psyche Metrics"
        description="Daily Psyche measurements from stored history, presented with the same operational shape as Vitals."
        badge={
          metrics.summary.hasData
            ? `${metrics.summary.metricCount} daily metrics`
            : "No daily metrics yet"
        }
      />
      <PsycheSectionNav />

      {!metrics.summary.hasData ? (
        <EmptyPsycheMetrics />
      ) : (
        <>
          <DevrageRageFigure
            swearMetric={swearMetric}
            percentMetric={percentMetric}
            averageRageMetric={averageRageMetric}
            maxRageMetric={maxRageMetric}
          />

          <section className="grid gap-4 xl:grid-cols-4">
            <SpotlightCard
              title="Devrage count"
              description="Raw daily swear count across scanned user messages."
              metric={swearMetric}
            />
            <SpotlightCard
              title="Swearing rate"
              description="Percentage of user messages that contained at least one tracked swear."
              metric={percentMetric}
            />
            <SpotlightCard
              title="Average rage peak"
              description="Average per-thread peak after swears add and clean messages cool the score down."
              metric={averageRageMetric}
            />
            <SpotlightCard
              title="Max rage peak"
              description="Highest cumulative thread score reached on the latest tracked day."
              metric={maxRageMetric}
            />
            <Card className="rounded-[28px] border border-[color-mix(in_srgb,var(--warning)_22%,var(--ui-border-subtle)_78%)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--ui-warning-soft)_52%,var(--ui-surface-section)_48%),var(--ui-surface-section))] p-5">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--warning)]">
                Seven-day averages
              </div>
              <div className="mt-4 grid gap-3">
                <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3">
                  <span className="text-sm text-[var(--ui-ink-soft)]">
                    Swears
                  </span>
                  <span className="text-xl font-semibold text-[var(--ui-ink-strong)]">
                    {formatCount(metrics.context.weeklyAverage.rawSwearCount)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3">
                  <span className="text-sm text-[var(--ui-ink-soft)]">
                    Swearing messages
                  </span>
                  <span className="text-xl font-semibold text-[var(--ui-ink-strong)]">
                    {formatPercent(
                      metrics.context.weeklyAverage.swearingMessagePercent
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3">
                  <span className="text-sm text-[var(--ui-ink-soft)]">
                    Average rage peak
                  </span>
                  <span className="text-xl font-semibold text-[var(--ui-ink-strong)]">
                    {formatCount(
                      metrics.context.weeklyAverage.averageMaxCumulativeRage
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3">
                  <span className="text-sm text-[var(--ui-ink-soft)]">
                    Max rage peak
                  </span>
                  <span className="text-xl font-semibold text-[var(--ui-ink-strong)]">
                    {formatCount(
                      metrics.context.weeklyAverage.maxCumulativeRage
                    )}
                  </span>
                </div>
              </div>
            </Card>
            <Card className="rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-5">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                Stored coverage
              </div>
              <div className="mt-3 text-2xl font-semibold text-[var(--ui-ink-strong)]">
                {metrics.summary.trackedDays} days
              </div>
              <div className="mt-3 grid gap-2 text-sm text-[var(--ui-ink-medium)]">
                <div>
                  {formatCount(metrics.context.conversationsScanned)}{" "}
                  conversations
                </div>
                <div>
                  {formatCount(metrics.context.messagesScanned)} user messages
                </div>
                <div>{metrics.context.sourceCount} source families</div>
              </div>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
            <Card className="overflow-hidden rounded-[30px] border-[var(--ui-border-subtle)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--ui-warning-soft)_34%,var(--ui-surface-section)_66%),var(--ui-surface-section))] p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="grid gap-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                    Coverage
                  </div>
                  <div className="text-2xl font-semibold text-[var(--ui-ink-strong)]">
                    {metrics.summary.trackedDays} tracked days across{" "}
                    {metrics.summary.metricCount} metrics
                  </div>
                  <div className="max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
                    Devrage is stored as daily Psyche measurements, so this view
                    reads history from SQLite instead of rescanning
                    conversations during page load.
                  </div>
                </div>
                <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                  Latest snapshot {formatDateKey(metrics.summary.latestDateKey)}
                </Badge>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {metrics.summary.categoryBreakdown.map((category) => {
                  const tone = metricTone(category.category);
                  return (
                    <div
                      key={category.category}
                      className={cn(
                        "rounded-[22px] border bg-[var(--ui-surface-1)] p-4",
                        tone.ring
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Badge className={tone.badge}>
                          {category.category}
                        </Badge>
                        <div className="text-xs text-[var(--ui-ink-faint)]">
                          {category.coverageDays} days
                        </div>
                      </div>
                      <div className="mt-3 text-2xl font-semibold text-[var(--ui-ink-strong)]">
                        {category.metricCount}
                      </div>
                      <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                        active metric{category.metricCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="rounded-[30px] border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-6">
              <div className="grid gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Summary statistics
                </div>
                <div className="text-lg font-semibold text-[var(--ui-ink-strong)]">
                  {formatCount(metrics.context.totalSwears)} total swears across
                  stored history.
                </div>
                <div className="grid gap-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                  <div>
                    Daily average:{" "}
                    {formatCount(metrics.context.dailyAverage.rawSwearCount)}{" "}
                    swears,{" "}
                    {formatPercent(
                      metrics.context.dailyAverage.swearingMessagePercent
                    )}{" "}
                    swearing messages, and{" "}
                    {formatCount(
                      metrics.context.dailyAverage.averageMaxCumulativeRage
                    )}{" "}
                    average rage peak.
                  </div>
                  <div>
                    Weekly average:{" "}
                    {formatCount(metrics.context.weeklyAverage.rawSwearCount)}{" "}
                    swears,{" "}
                    {formatPercent(
                      metrics.context.weeklyAverage.swearingMessagePercent
                    )}{" "}
                    swearing messages, and{" "}
                    {formatCount(
                      metrics.context.weeklyAverage.maxCumulativeRage
                    )}{" "}
                    max rage peak.
                  </div>
                  <div>
                    {formatCount(metrics.context.messagesWithSwears)} user
                    messages contained at least one tracked swear.
                  </div>
                </div>
                <div className="mt-2 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm text-[var(--ui-ink-medium)]">
                  {metrics.summary.latestMetricCount} metrics updated on the
                  latest tracked day.
                </div>
              </div>
            </Card>
          </section>

          <MetricDetailSections groups={groups} />
        </>
      )}
    </div>
  );
}
