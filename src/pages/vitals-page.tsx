import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Flame,
  Heart,
  Mountain,
  Scale,
  Sparkles,
  Wind
} from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { getVitalsView } from "@/lib/api";
import type {
  VitalMetricDayRecord,
  VitalsViewData
} from "@/lib/types";
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

function formatDateKey(dateKey: string | null) {
  if (!dateKey) {
    return "No date yet";
  }
  const date = new Date(`${dateKey}T12:00:00`);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function metricPrimaryValue(day: VitalMetricDayRecord, aggregation: VitalsMetric["aggregation"]) {
  if (aggregation === "cumulative") {
    return day.total ?? day.latest ?? day.maximum ?? day.average;
  }
  return day.latest ?? day.average ?? day.maximum ?? day.minimum;
}

function formatMetricValue(metric: VitalsMetric, value: number | null) {
  if (value == null) {
    return "No reading";
  }
  const digits =
    metric.unit === "steps" ||
    metric.unit === "flights" ||
    metric.unit === "kcal" ||
    metric.unit === "min"
      ? 0
      : metric.unit === "%"
        ? 1
        : 1;
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits === 0 ? 0 : value >= 100 ? 0 : 1
  })} ${metric.unit}`;
}

function formatDelta(metric: VitalsMetric) {
  if (metric.deltaValue == null) {
    return "No baseline yet";
  }
  const sign = metric.deltaValue > 0 ? "+" : "";
  return `${sign}${formatMetricValue(metric, metric.deltaValue)}`;
}

function metricTrendDirection(metric: VitalsMetric) {
  if (metric.deltaValue == null || metric.deltaValue === 0) {
    return "steady";
  }
  return metric.deltaValue > 0 ? "up" : "down";
}

function metricTone(category: string) {
  switch (category) {
    case "recovery":
      return {
        ring: "border-[rgba(255,122,167,0.18)]",
        badge: "bg-[rgba(255,122,167,0.16)] text-[rgb(255,179,205)]",
        glow: "from-[rgba(255,122,167,0.2)] via-[rgba(109,76,255,0.06)] to-transparent"
      };
    case "cardio":
      return {
        ring: "border-[rgba(109,173,255,0.22)]",
        badge: "bg-[rgba(109,173,255,0.16)] text-[rgb(186,220,255)]",
        glow: "from-[rgba(109,173,255,0.22)] via-[rgba(64,108,255,0.08)] to-transparent"
      };
    case "breathing":
      return {
        ring: "border-[rgba(111,232,195,0.2)]",
        badge: "bg-[rgba(111,232,195,0.15)] text-[rgb(195,255,237)]",
        glow: "from-[rgba(111,232,195,0.2)] via-[rgba(29,154,123,0.08)] to-transparent"
      };
    case "composition":
      return {
        ring: "border-[rgba(247,211,110,0.18)]",
        badge: "bg-[rgba(247,211,110,0.15)] text-[rgb(255,235,176)]",
        glow: "from-[rgba(247,211,110,0.18)] via-[rgba(184,128,24,0.08)] to-transparent"
      };
    case "temperature":
      return {
        ring: "border-[rgba(255,153,102,0.18)]",
        badge: "bg-[rgba(255,153,102,0.16)] text-[rgb(255,214,190)]",
        glow: "from-[rgba(255,153,102,0.2)] via-[rgba(255,91,46,0.06)] to-transparent"
      };
    default:
      return {
        ring: "border-[rgba(163,174,208,0.16)]",
        badge: "bg-[rgba(163,174,208,0.14)] text-[rgb(220,228,255)]",
        glow: "from-[rgba(163,174,208,0.14)] via-[rgba(112,120,167,0.06)] to-transparent"
      };
  }
}

function metricIcon(metric: string) {
  switch (metric) {
    case "restingHeartRate":
    case "walkingHeartRateAverage":
    case "heartRateRecoveryOneMinute":
      return Heart;
    case "heartRateVariabilitySDNN":
    case "vo2Max":
      return Sparkles;
    case "oxygenSaturation":
    case "respiratoryRate":
      return Wind;
    case "bodyMass":
    case "bodyFatPercentage":
    case "leanBodyMass":
      return Scale;
    case "stepCount":
    case "flightsClimbed":
    case "appleExerciseTime":
      return Mountain;
    case "basalEnergyBurned":
      return Flame;
    default:
      return Activity;
  }
}

function Sparkbar({
  metric,
  className
}: {
  metric: VitalsMetric;
  className?: string;
}) {
  const values = metric.days
    .slice(-14)
    .map((day) => metricPrimaryValue(day, metric.aggregation))
    .filter((value): value is number => value != null);

  if (values.length === 0) {
    return (
      <div
        className={cn(
          "flex h-16 items-center justify-center rounded-[18px] border border-dashed border-white/8 bg-white/[0.025] text-xs text-white/36",
          className
        )}
      >
        Waiting for daily points
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const recent = metric.days.slice(-14);

  return (
    <div
      className={cn(
        "flex h-16 items-end gap-1 rounded-[18px] border border-white/8 bg-white/[0.025] px-3 py-2",
        className
      )}
    >
      {recent.map((day, index) => {
        const value = metricPrimaryValue(day, metric.aggregation);
        const height =
          value == null ? 12 : 18 + Math.round(((value - min) / range) * 34);
        const isLatest = index === recent.length - 1;
        return (
          <div key={`${metric.metric}-${day.dateKey}`} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div
              className={cn(
                "w-full rounded-full bg-gradient-to-t from-white/28 to-white/60 transition",
                isLatest && "from-[var(--primary)] to-[rgba(171,232,255,0.9)]"
              )}
              style={{ height }}
              title={`${day.dateKey}: ${value == null ? "No reading" : formatMetricValue(metric, value)}`}
            />
          </div>
        );
      })}
    </div>
  );
}

function SpotlightCard({
  title,
  description,
  metric
}: {
  title: string;
  description: string;
  metric: VitalsMetric | null;
}) {
  const Icon = metric ? metricIcon(metric.metric) : Activity;
  const tone = metric ? metricTone(metric.category) : metricTone("default");
  const trend = metric ? metricTrendDirection(metric) : "steady";

  return (
    <Card
      className={cn(
        "relative overflow-hidden rounded-[28px] border bg-[rgba(12,18,36,0.82)] p-5 shadow-[0_18px_60px_rgba(4,8,18,0.3)]",
        tone.ring
      )}
    >
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90", tone.glow)} />
      <div className="relative grid gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">
              {title}
            </div>
            <div className="text-sm leading-6 text-white/56">{description}</div>
          </div>
          <div className="rounded-[18px] border border-white/10 bg-white/[0.05] p-3 text-white/80">
            <Icon className="size-5" />
          </div>
        </div>
        <div className="grid gap-2">
          <div className="text-xl font-semibold text-white">
            {metric ? formatMetricValue(metric, metric.latestValue) : "No signal yet"}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/56">
            {metric ? <Badge className={tone.badge}>{metric.label}</Badge> : null}
            {metric ? (
              <Badge
                className={cn(
                  "border-none",
                  trend === "up"
                    ? "bg-[rgba(111,232,195,0.14)] text-[rgb(190,255,231)]"
                    : trend === "down"
                      ? "bg-[rgba(255,122,167,0.14)] text-[rgb(255,193,215)]"
                      : "bg-white/[0.08] text-white/72"
                )}
              >
                {formatDelta(metric)}
              </Badge>
            ) : null}
            {metric ? <Badge tone="meta">{metric.coverageDays} days tracked</Badge> : null}
          </div>
          <div className="text-xs text-white/48">
            {metric
              ? `Latest reading on ${formatDateKey(metric.latestDateKey)}`
              : "Forge will populate this card as soon as HealthKit has recent readings."}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function VitalsPage() {
  const shell = useForgeShell();
  const vitalsQuery = useQuery({
    queryKey: ["forge-vitals-view", ...shell.selectedUserIds],
    queryFn: async () => (await getVitalsView(shell.selectedUserIds)).vitals
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
  const spotlightMetrics = spotlightMetricKeys.map(
    (metricKey) => vitals.metrics.find((metric) => metric.metric === metricKey) ?? null
  );
  const categoryBreakdown = vitals.summary.categoryBreakdown;
  const metricsByCategory = categoryBreakdown.map((category) => ({
    ...category,
    metrics: vitals.metrics.filter((metric) => metric.category === category.category)
  }));

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

      <section className="grid gap-5">
        {metricsByCategory.map((group) => (
          <div key={group.category} className="grid gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">
                  {group.category}
                </div>
                <div className="mt-1 text-2xl font-semibold text-white">
                  {group.metrics.length} signals in this lane
                </div>
              </div>
              <Badge className={metricTone(group.category).badge}>
                {group.coverageDays} days of coverage
              </Badge>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {group.metrics.map((metric) => {
                const Icon = metricIcon(metric.metric);
                const tone = metricTone(metric.category);
                const latestDay = metric.days.at(-1);
                return (
                  <Card
                    key={metric.metric}
                    className={cn(
                      "overflow-hidden rounded-[28px] border bg-[linear-gradient(180deg,rgba(12,18,36,0.94),rgba(8,12,24,0.98))] p-5",
                      tone.ring
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-3 text-white/84">
                          <Icon className="size-5" />
                        </div>
                        <div className="grid gap-1">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                            {metric.category}
                          </div>
                          <div className="text-xl font-semibold text-white">
                            {metric.label}
                          </div>
                          <div className="text-sm text-white/52">
                            {metric.coverageDays} tracked day{metric.coverageDays === 1 ? "" : "s"}
                          </div>
                        </div>
                      </div>
                      <Badge className={tone.badge}>{metric.aggregation}</Badge>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,0.95fr)_minmax(220px,1.05fr)]">
                      <div className="grid gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                            Latest
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-white">
                            {formatMetricValue(metric, metric.latestValue)}
                          </div>
                          <div className="mt-1 text-sm text-white/52">
                            {metric.latestDateKey
                              ? `Latest reading on ${formatDateKey(metric.latestDateKey)}`
                              : "Waiting for the first successful reading"}
                          </div>
                        </div>
                        <div className="grid gap-2 rounded-[22px] border border-white/8 bg-white/[0.03] p-4 text-sm text-white/70">
                          <div className="flex items-center justify-between gap-2">
                            <span>Baseline</span>
                            <span className="font-medium text-white">
                              {formatMetricValue(metric, metric.baselineValue)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span>Delta</span>
                            <span
                              className={cn(
                                "font-medium",
                                metric.deltaValue == null
                                  ? "text-white/58"
                                  : metric.deltaValue > 0
                                    ? "text-[rgb(190,255,231)]"
                                    : metric.deltaValue < 0
                                      ? "text-[rgb(255,198,219)]"
                                      : "text-white"
                              )}
                            >
                              {formatDelta(metric)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span>Latest samples</span>
                            <span className="font-medium text-white">
                              {latestDay?.sampleCount ?? 0}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3">
                        <Sparkbar metric={metric} />
                        <div className="grid grid-cols-3 gap-2 text-xs text-white/48">
                          <div className="rounded-[16px] border border-white/8 bg-white/[0.025] px-3 py-2">
                            <div>Min</div>
                            <div className="mt-1 font-medium text-white/78">
                              {formatMetricValue(metric, latestDay?.minimum ?? null)}
                            </div>
                          </div>
                          <div className="rounded-[16px] border border-white/8 bg-white/[0.025] px-3 py-2">
                            <div>Average</div>
                            <div className="mt-1 font-medium text-white/78">
                              {formatMetricValue(metric, latestDay?.average ?? null)}
                            </div>
                          </div>
                          <div className="rounded-[16px] border border-white/8 bg-white/[0.025] px-3 py-2">
                            <div>Max</div>
                            <div className="mt-1 font-medium text-white/78">
                              {formatMetricValue(metric, latestDay?.maximum ?? null)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
