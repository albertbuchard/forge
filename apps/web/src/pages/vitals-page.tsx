import { useQuery } from "@tanstack/react-query";
import { PageHero } from "@/components/shell/page-hero";
import { ProvenanceSummary } from "@/components/provenance-summary";
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
type VitalsEvidenceStatus = {
  label: string;
  detail: string;
  tone: "meta" | "signal" | "default";
};

const spotlightMetricKeys = [
  "restingHeartRate",
  "heartRateVariabilitySDNN",
  "vo2Max",
  "oxygenSaturation",
  "bodyMass",
  "stepCount"
] as const;

function groupDailyMetrics(
  metrics: DailyMetricRecord[],
  categoryBreakdown: VitalsViewData["summary"]["categoryBreakdown"]
): DailyMetricCategoryGroup[] {
  return categoryBreakdown.map((category) => ({
    ...category,
    metrics: metrics.filter((metric) => metric.category === category.category)
  }));
}

function asDailyMetric(metric: VitalsMetric): DailyMetricRecord {
  return metric;
}

export function getVitalsEvidenceStatus(
  vitals: VitalsViewData,
  now = new Date()
): VitalsEvidenceStatus {
  const latestDateKey = vitals.summary.latestDateKey;
  if (!latestDateKey || vitals.summary.metricCount === 0) {
    return {
      label: "No evidence",
      detail: "No daily HealthKit aggregates are available yet.",
      tone: "default"
    };
  }
  const latestDay = Date.parse(`${latestDateKey}T12:00:00Z`);
  if (!Number.isFinite(latestDay)) {
    return {
      label: "Invalid evidence date",
      detail: "The latest aggregate date cannot be interpreted.",
      tone: "default"
    };
  }
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12
  );
  const ageDays = Math.floor((today - latestDay) / 86_400_000);
  if (ageDays < 0) {
    return {
      label: "Future-dated",
      detail: `Latest aggregate is dated ${latestDateKey}; check device time and timezone before interpreting trends.`,
      tone: "default"
    };
  }
  if (ageDays <= 1) {
    return {
      label: "Current evidence",
      detail: `Latest aggregate is ${ageDays === 0 ? "today" : "one day old"}.`,
      tone: "signal"
    };
  }
  return {
    label: "Stale evidence",
    detail: `Latest aggregate is ${ageDays} days old. Treat trends as historical until the companion sync catches up.`,
    tone: "default"
  };
}

function PsycheMetricsVitalsSection({
  metrics
}: {
  metrics: PsycheMetricsViewData;
}) {
  if (!metrics.summary.hasData || metrics.metrics.length === 0) {
    return null;
  }

  const groups = groupDailyMetrics(
    metrics.metrics,
    metrics.summary.categoryBreakdown
  );
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
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Psyche metrics
          </div>
          <div className="mt-1 text-2xl font-semibold text-[var(--ui-ink-strong)]">
            Conversation tone alongside body signals
          </div>
        </div>
        <Badge className="bg-[var(--ui-warning-soft)] text-[var(--warning)]">
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
    queryFn: async () => (await getVitalsView(shell.selectedUserIds)).vitals,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000
  });
  const psycheMetricsQuery = useQuery({
    queryKey: ["forge-psyche-metrics-vitals-view", ...shell.selectedUserIds],
    queryFn: async () =>
      (
        await getPsycheMetricsView({
          userIds: shell.selectedUserIds,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        })
      ).metrics
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
    (metricKey) =>
      dailyMetrics.find((metric) => metric.metric === metricKey) ?? null
  );
  const categoryBreakdown = vitals.summary.categoryBreakdown;
  const metricsByCategory = groupDailyMetrics(dailyMetrics, categoryBreakdown);
  const evidenceStatus = getVitalsEvidenceStatus(vitals);
  const psycheMetrics =
    !psycheMetricsQuery.isError && psycheMetricsQuery.data?.summary.hasData
      ? psycheMetricsQuery.data
      : null;

  return (
    <div className="mx-auto grid w-full max-w-[1380px] gap-5">
      <PageHero
        title="Vitals"
        description="Forge now keeps a daily body-signals layer across recovery, cardio fitness, breathing, composition, temperature, and activity. Use this surface to spot drift early, not just admire numbers late."
        badge={`${vitals.summary.metricCount} tracked metrics`}
      />

      {vitals.provenance ? (
        <ProvenanceSummary provenance={vitals.provenance} />
      ) : (
        <Card className="grid gap-3 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 sm:grid-cols-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
            Freshness
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={evidenceStatus.tone}>{evidenceStatus.label}</Badge>
            <span className="text-sm text-[var(--ui-ink-soft)]">
              {evidenceStatus.detail}
            </span>
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
            Latest-day coverage
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
            {vitals.summary.latestMetricCount} of {vitals.summary.metricCount}{" "}
            tracked metrics have a value on{" "}
            {formatDateKey(vitals.summary.latestDateKey)}.
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
            Source quality
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
            This view exposes daily aggregates, units, sample counts, and sample
            times. Raw provider identity and duplicate-source decisions are not
            available here.
          </div>
        </div>
        </Card>
      )}

      {vitals.summary.metricCount === 0 ? (
        <Card className="border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-6">
          <div className="text-lg font-semibold text-[var(--ui-ink-strong)]">
            No body signals synced
          </div>
          <div className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ui-ink-soft)]">
            Forge has no daily vital aggregates to interpret. Recovery, cardio,
            breathing, composition, and activity conclusions stay unavailable
            until HealthKit evidence arrives.
          </div>
        </Card>
      ) : (
        <>
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
            <Card className="overflow-hidden rounded-[30px] border-[var(--ui-border-subtle)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--ui-info-soft)_34%,var(--ui-surface-section)_66%),var(--ui-surface-section))] p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="grid gap-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                    Coverage
                  </div>
                  <div className="text-2xl font-semibold text-[var(--ui-ink-strong)]">
                    {vitals.summary.trackedDays} tracked days across{" "}
                    {vitals.summary.metricCount} metrics
                  </div>
                  <div className="max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
                    The companion is compressing HealthKit into daily signal
                    bands, so what you see here is designed for decisions: how
                    your recovery is trending, where your physiology is
                    changing, and which body systems are actually being observed
                    consistently.
                  </div>
                </div>
                <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
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
                  Daily interpretation
                </div>
                <div className="text-lg font-semibold text-[var(--ui-ink-strong)]">
                  Body signals should feel operational, not medical-chart dead.
                </div>
                <div className="grid gap-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                  <div>
                    Lower resting heart rate paired with stable or rising HRV
                    usually means recovery is holding.
                  </div>
                  <div>
                    Rising walking heart rate, falling HRV, or a jump in
                    respiratory rate usually means you are carrying more load
                    than the calendar admits.
                  </div>
                  <div>
                    Composition and temperature metrics move slower, but they
                    make the fast signals easier to trust because you can see
                    the surrounding body context.
                  </div>
                </div>
                <div className="mt-2 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm text-[var(--ui-ink-medium)]">
                  {vitals.summary.latestMetricCount} metrics updated on the
                  latest tracked day.
                </div>
              </div>
            </Card>
          </section>

          <MetricDetailSections groups={metricsByCategory} />

          {psycheMetrics ? (
            <PsycheMetricsVitalsSection metrics={psycheMetrics} />
          ) : null}
        </>
      )}
    </div>
  );
}
