import { useQuery } from "@tanstack/react-query";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import {
  DevrageRageFigure,
  MetricDetailSections,
  SpotlightCard,
  formatDateKey,
  metricTone,
  type DailyMetricCategoryGroup,
  type DailyMetricRecord
} from "@/components/metrics/daily-metrics-dashboard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { getPsycheMetricsView, getVitalsView } from "@/lib/api";
import type { VitalsViewData } from "@/lib/types";
import type { PsycheMetricsViewData } from "@/lib/psyche-types";
import { cn } from "@/lib/utils";

type VitalsMetric = VitalsViewData["metrics"][number];

const spotlightMetricKeys = [
  "restingHeartRate",
  "heartRateVariabilitySDNN",
  "vo2Max",
  "oxygenSaturation",
  "bodyMass",
  "stepCount"
] as const;

function groupDailyMetrics(metrics: DailyMetricRecord[], categoryBreakdown: VitalsViewData["summary"]["categoryBreakdown"]): DailyMetricCategoryGroup[] {
  return categoryBreakdown.map((category) => ({
    ...category,
    metrics: metrics.filter((metric) => metric.category === category.category)
  }));
}

function asDailyMetric(metric: VitalsMetric): DailyMetricRecord {
  return metric;
}

function PsycheMetricsVitalsSection({ metrics }: { metrics: PsycheMetricsViewData }) {
  if (!metrics.summary.hasData || metrics.metrics.length === 0) {
    return null;
  }

  const groups = groupDailyMetrics(metrics.metrics, metrics.summary.categoryBreakdown);
  const swearMetric = metrics.metrics.find((metric) => metric.metric === "devrageSwearCount") ?? null;
  const percentMetric = metrics.metrics.find((metric) => metric.metric === "swearingMessagePercent") ?? null;
  const averageRageMetric = metrics.metrics.find((metric) => metric.metric === "devrageAverageMaxCumulativeRage") ?? null;
  const maxRageMetric = metrics.metrics.find((metric) => metric.metric === "devrageMaxCumulativeRage") ?? null;

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">
            Psyche metrics
          </div>
          <div className="mt-1 text-2xl font-semibold text-white">
            Conversation tone alongside body signals
          </div>
        </div>
        <Badge className="bg-amber-200/10 text-amber-50">
          {metrics.summary.trackedDays} tracked days
        </Badge>
      </div>

      <DevrageRageFigure
        swearMetric={swearMetric}
        percentMetric={percentMetric}
        averageRageMetric={averageRageMetric}
        maxRageMetric={maxRageMetric}
        compact
      />

      <div className="grid gap-4 xl:grid-cols-4">
        <SpotlightCard
          title="Devrage count"
          description="Daily user-message swear count from stored conversation history."
          metric={swearMetric}
        />
        <SpotlightCard
          title="Swearing rate"
          description="Share of scanned user messages that contained at least one tracked swear."
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
      </div>

      <MetricDetailSections groups={groups} />
    </section>
  );
}

export function VitalsPage() {
  const shell = useForgeShell();
  const vitalsQuery = useQuery({
    queryKey: ["forge-vitals-view", ...shell.selectedUserIds],
    queryFn: async () => (await getVitalsView(shell.selectedUserIds)).vitals
  });
  const psycheMetricsQuery = useQuery({
    queryKey: ["forge-psyche-metrics-vitals-view"],
    queryFn: async () => (await getPsycheMetricsView()).metrics
  });

  if (vitalsQuery.isLoading) {
    return (
      <LoadingState
        title="Loading body signals"
        description="Reading recent HealthKit body metrics, recovery signals, and daily aggregates."
      />
    );
  }

  if (vitalsQuery.isError || !vitalsQuery.data) {
    return (
      <ErrorState
        error={vitalsQuery.error ?? new Error("Vitals data unavailable")}
        onRetry={() => void vitalsQuery.refetch()}
      />
    );
  }

  const vitals = vitalsQuery.data;
  const dailyMetrics = vitals.metrics.map(asDailyMetric);
  const spotlightMetrics = spotlightMetricKeys.map(
    (metricKey) => dailyMetrics.find((metric) => metric.metric === metricKey) ?? null
  );
  const categoryBreakdown = vitals.summary.categoryBreakdown;
  const metricsByCategory = groupDailyMetrics(dailyMetrics, categoryBreakdown);
  const psycheMetrics =
    !psycheMetricsQuery.isError && psycheMetricsQuery.data?.summary.hasData
      ? psycheMetricsQuery.data
      : null;

  return (
    <div className="mx-auto grid w-full max-w-[1380px] gap-5">
      <PageHero
        title="Vitals"
        description="Forge now keeps a daily body-signals layer across recovery, cardio fitness, breathing, composition, temperature, and activity. Use this surface to spot drift early, not just admire numbers late."
        badge={`${vitals.summary.metricCount} live metrics`}
      />

      <section className="grid gap-4 xl:grid-cols-4">
        <SpotlightCard
          title="Recovery pulse"
          description="Resting heart rate and HRV are the fastest read on load, stress, and whether today needs a gentler edge."
          metric={spotlightMetrics[0] ?? spotlightMetrics[1]}
        />
        <SpotlightCard
          title="Cardio engine"
          description="VO2 max and walking heart rate show whether baseline fitness is improving or whether your effort is costing more than usual."
          metric={spotlightMetrics[2]}
        />
        <SpotlightCard
          title="Breath and oxygen"
          description="Respiratory rate and oxygen saturation help catch nights or stretches where recovery quality starts to slip."
          metric={spotlightMetrics[3]}
        />
        <SpotlightCard
          title="Body composition"
          description="Mass and composition stay close to the daily story so progress is visible without flattening everything into weight alone."
          metric={spotlightMetrics[4]}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <Card className="overflow-hidden rounded-[30px] border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(108,99,255,0.16),transparent_36%),linear-gradient(180deg,rgba(15,19,38,0.98),rgba(9,13,28,0.98))] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid gap-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                Coverage
              </div>
              <div className="text-2xl font-semibold text-white">
                {vitals.summary.trackedDays} tracked days across {vitals.summary.metricCount} metrics
              </div>
              <div className="max-w-3xl text-sm leading-6 text-white/58">
                The companion is compressing HealthKit into daily signal bands, so what you see here is designed for decisions: how your recovery is trending, where your physiology is changing, and which body systems are actually being observed consistently.
              </div>
            </div>
            <Badge className="bg-white/[0.08] text-white/72">
              Latest snapshot {formatDateKey(vitals.summary.latestDateKey)}
            </Badge>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {categoryBreakdown.map((category) => {
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
              Daily interpretation
            </div>
            <div className="text-lg font-semibold text-white">
              Body signals should feel operational, not medical-chart dead.
            </div>
            <div className="grid gap-3 text-sm leading-6 text-white/58">
              <div>
                Lower resting heart rate paired with stable or rising HRV usually means recovery is holding.
              </div>
              <div>
                Rising walking heart rate, falling HRV, or a jump in respiratory rate usually means you are carrying more load than the calendar admits.
              </div>
              <div>
                Composition and temperature metrics move slower, but they make the fast signals easier to trust because you can see the surrounding body context.
              </div>
            </div>
            <div className="mt-2 rounded-[22px] border border-white/8 bg-white/[0.035] p-4 text-sm text-white/70">
              {vitals.summary.latestMetricCount} metrics updated on the latest tracked day.
            </div>
          </div>
        </Card>
      </section>

      <MetricDetailSections groups={metricsByCategory} />

      {psycheMetrics ? <PsycheMetricsVitalsSection metrics={psycheMetrics} /> : null}
    </div>
  );
}
