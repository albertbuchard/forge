import { useQuery } from "@tanstack/react-query";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import {
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

function groupMetrics(metrics: PsycheMetricsViewData): DailyMetricCategoryGroup[] {
  return metrics.summary.categoryBreakdown.map((category) => ({
    ...category,
    metrics: metrics.metrics.filter((metric) => metric.category === category.category)
  }));
}

function EmptyPsycheMetrics() {
  return (
    <Card className="rounded-[30px] border-white/8 bg-[linear-gradient(180deg,rgba(14,20,32,0.96),rgba(9,13,24,0.98))] p-6">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
        No daily metrics yet
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">
        Psyche metrics will appear after the first local backfill finds conversations.
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-white/58">
        This surface stays quiet until Forge has stored daily metric rows. It does not run the scanner while rendering the page.
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
  const swearMetric = metrics.metrics.find((metric) => metric.metric === "devrageSwearCount") ?? null;
  const percentMetric = metrics.metrics.find((metric) => metric.metric === "swearingMessagePercent") ?? null;

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
            <Card className="rounded-[28px] border border-amber-200/12 bg-[linear-gradient(180deg,rgba(39,31,17,0.96),rgba(19,21,17,0.95))] p-5">
              <div className="text-[11px] uppercase tracking-[0.18em] text-amber-100/72">
                Seven-day averages
              </div>
              <div className="mt-4 grid gap-3">
                <div className="flex items-center justify-between gap-3 rounded-[18px] bg-white/[0.045] px-4 py-3">
                  <span className="text-sm text-white/58">Swears</span>
                  <span className="text-xl font-semibold text-white">
                    {formatCount(metrics.context.weeklyAverage.rawSwearCount)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[18px] bg-white/[0.045] px-4 py-3">
                  <span className="text-sm text-white/58">Swearing messages</span>
                  <span className="text-xl font-semibold text-white">
                    {formatPercent(metrics.context.weeklyAverage.swearingMessagePercent)}
                  </span>
                </div>
              </div>
            </Card>
            <Card className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(13,19,37,0.96),rgba(10,14,30,0.96))] p-5">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                Stored coverage
              </div>
              <div className="mt-3 text-2xl font-semibold text-white">
                {metrics.summary.trackedDays} days
              </div>
              <div className="mt-3 grid gap-2 text-sm text-white/62">
                <div>{formatCount(metrics.context.conversationsScanned)} conversations</div>
                <div>{formatCount(metrics.context.messagesScanned)} user messages</div>
                <div>{metrics.context.sourceCount} source families</div>
              </div>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
            <Card className="overflow-hidden rounded-[30px] border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.14),transparent_36%),linear-gradient(180deg,rgba(20,18,31,0.98),rgba(10,13,26,0.98))] p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="grid gap-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                    Coverage
                  </div>
                  <div className="text-2xl font-semibold text-white">
                    {metrics.summary.trackedDays} tracked days across {metrics.summary.metricCount} metrics
                  </div>
                  <div className="max-w-3xl text-sm leading-6 text-white/58">
                    Devrage is stored as daily Psyche measurements, so this view reads history from SQLite instead of rescanning conversations during page load.
                  </div>
                </div>
                <Badge className="bg-white/[0.08] text-white/72">
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
                        "rounded-[22px] border bg-white/[0.03] p-4",
                        tone.ring
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Badge className={tone.badge}>{category.category}</Badge>
                        <div className="text-xs text-white/44">
                          {category.coverageDays} days
                        </div>
                      </div>
                      <div className="mt-3 text-2xl font-semibold text-white">
                        {category.metricCount}
                      </div>
                      <div className="mt-1 text-sm text-white/58">
                        active metric{category.metricCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="rounded-[30px] border-white/8 bg-[linear-gradient(180deg,rgba(13,19,37,0.96),rgba(10,14,30,0.96))] p-6">
              <div className="grid gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                  Summary statistics
                </div>
                <div className="text-lg font-semibold text-white">
                  {formatCount(metrics.context.totalSwears)} total swears across stored history.
                </div>
                <div className="grid gap-3 text-sm leading-6 text-white/58">
                  <div>
                    Daily average: {formatCount(metrics.context.dailyAverage.rawSwearCount)} swears and {formatPercent(metrics.context.dailyAverage.swearingMessagePercent)} swearing messages.
                  </div>
                  <div>
                    Weekly average: {formatCount(metrics.context.weeklyAverage.rawSwearCount)} swears and {formatPercent(metrics.context.weeklyAverage.swearingMessagePercent)} swearing messages.
                  </div>
                  <div>
                    {formatCount(metrics.context.messagesWithSwears)} user messages contained at least one tracked swear.
                  </div>
                </div>
                <div className="mt-2 rounded-[22px] border border-white/8 bg-white/[0.035] p-4 text-sm text-white/70">
                  {metrics.summary.latestMetricCount} metrics updated on the latest tracked day.
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
