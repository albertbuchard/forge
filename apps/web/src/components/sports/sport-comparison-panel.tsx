import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Info, Scale } from "lucide-react";
import { Card } from "@/components/ui/card";
import type {
  SportComparisonData,
  SportComparisonEntry,
  SportComparisonPeriod
} from "@/lib/types";
import { cn } from "@/lib/utils";

type ComparisonMetric =
  | "duration"
  | "sessions"
  | "energy"
  | "energy_rate"
  | "load_rate";

const METRICS: Array<{
  key: ComparisonMetric;
  label: string;
  shortLabel: string;
  title: string;
}> = [
  {
    key: "duration",
    label: "Training time",
    shortLabel: "Time",
    title: "Total recorded workout duration"
  },
  {
    key: "sessions",
    label: "Sessions",
    shortLabel: "Sessions",
    title: "Number of workout sessions"
  },
  {
    key: "energy",
    label: "Calories",
    shortLabel: "Calories",
    title: "Reported active or total energy, with data coverage shown below"
  },
  {
    key: "energy_rate",
    label: "Energy rate",
    shortLabel: "Energy / h",
    title:
      "Reported kilocalories per hour across sessions that include energy data"
  },
  {
    key: "load_rate",
    label: "Load density",
    shortLabel: "Load / h",
    title:
      "TRIMP per hour across sessions with heart-rate-backed training load; this is not a performance score"
  }
];

const SPORT_COLORS = [
  "var(--chart-zone-1)",
  "var(--chart-zone-2)",
  "var(--chart-zone-3)",
  "var(--chart-zone-4)",
  "var(--chart-zone-5)",
  "var(--chart-series-alt)",
  "var(--chart-zone-below)"
];

function sportColor(workoutType: string) {
  const hash = [...workoutType].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
    0
  );
  return SPORT_COLORS[hash % SPORT_COLORS.length]!;
}

function metricValue(entry: SportComparisonEntry, metric: ComparisonMetric) {
  if (metric === "duration") {
    return entry.totalDurationSeconds / 3600;
  }
  if (metric === "sessions") {
    return entry.sessionCount;
  }
  if (metric === "energy") {
    return entry.totalEnergyKcal ?? 0;
  }
  if (metric === "energy_rate") {
    return entry.energyKcalPerHour ?? 0;
  }
  return entry.trainingLoadPerHour ?? 0;
}

function hasMetricEvidence(
  entry: SportComparisonEntry,
  metric: ComparisonMetric
) {
  if (metric === "energy") {
    return entry.totalEnergyKcal != null;
  }
  if (metric === "energy_rate") {
    return entry.energyKcalPerHour != null;
  }
  if (metric === "load_rate") {
    return entry.trainingLoadPerHour != null;
  }
  return true;
}

function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits
  }).format(value);
}

function formatDuration(seconds: number) {
  const hours = seconds / 3600;
  if (hours >= 10) {
    return `${formatNumber(hours)}h`;
  }
  if (hours >= 1) {
    return `${formatNumber(hours, 1)}h`;
  }
  return `${formatNumber(seconds / 60)}m`;
}

function formatMetric(value: number, metric: ComparisonMetric) {
  if (metric === "duration") {
    return `${formatNumber(value, value < 10 ? 1 : 0)} h`;
  }
  if (metric === "sessions") {
    return formatNumber(value);
  }
  if (metric === "energy") {
    return `${formatNumber(value)} kcal`;
  }
  if (metric === "energy_rate") {
    return `${formatNumber(value)} kcal/h`;
  }
  return `${formatNumber(value, 1)} TRIMP/h`;
}

function percentage(value: number) {
  return `${formatNumber(value * 100, value > 0 && value < 0.01 ? 1 : 0)}%`;
}

function ComparisonChartViewport({
  height,
  children
}: {
  height: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const update = () => {
      const node = ref.current;
      setReady(Boolean(node && node.clientWidth > 0 && node.clientHeight > 0));
    };
    const frame = window.requestAnimationFrame(update);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (ref.current && observer) {
      observer.observe(ref.current);
    }
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div ref={ref} style={{ height }} className="min-w-0">
      {ready ? children : null}
    </div>
  );
}

function SummaryValue({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 border-l border-[var(--ui-border-subtle)] pl-3 first:border-l-0 first:pl-0 sm:pl-4">
      <div className="text-xs text-[var(--ui-ink-soft)]">{label}</div>
      <div className="mt-1 truncate text-lg text-[var(--ui-ink-strong)]">
        {value}
      </div>
      {detail ? (
        <div className="mt-1 truncate text-[11px] text-[var(--ui-ink-faint)]">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function SportBreakdownRow({ entry }: { entry: SportComparisonEntry }) {
  return (
    <div className="grid min-w-0 gap-3 border-t border-[var(--ui-border-subtle)] py-3 first:border-t-0 lg:grid-cols-[minmax(140px,1.35fr)_minmax(90px,0.8fr)_minmax(80px,0.65fr)_minmax(100px,0.8fr)_minmax(100px,0.8fr)_minmax(100px,0.8fr)] lg:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: sportColor(entry.workoutType) }}
          />
          <span className="break-words text-sm font-medium leading-5 text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
            {entry.workoutTypeLabel}
          </span>
        </div>
        <div className="mt-1 break-words pl-[18px] text-xs leading-5 text-[var(--ui-ink-faint)] [overflow-wrap:anywhere]">
          {entry.activityFamilyLabel} · {entry.activeDayCount} active days
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5 lg:contents">
        <div>
          <div className="text-[10px] uppercase text-[var(--ui-ink-faint)] lg:hidden">
            Time
          </div>
          <div className="mt-1 text-sm text-[var(--ui-ink)] lg:mt-0">
            {formatDuration(entry.totalDurationSeconds)} ·{" "}
            {percentage(entry.durationShare)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-[var(--ui-ink-faint)] lg:hidden">
            Sessions
          </div>
          <div className="mt-1 text-sm text-[var(--ui-ink)] lg:mt-0">
            {formatNumber(entry.sessionCount)} ·{" "}
            {percentage(entry.sessionShare)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-[var(--ui-ink-faint)] lg:hidden">
            Calories
          </div>
          <div className="mt-1 text-sm text-[var(--ui-ink)] lg:mt-0">
            {entry.totalEnergyKcal == null
              ? "n/a"
              : `${formatNumber(entry.totalEnergyKcal)} kcal`}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--ui-ink-faint)]">
            {percentage(entry.energyShare)} share ·{" "}
            {percentage(entry.energyCoverage)} coverage
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-[var(--ui-ink-faint)] lg:hidden">
            Energy / h
          </div>
          <div className="mt-1 text-sm text-[var(--ui-ink)] lg:mt-0">
            {entry.energyKcalPerHour == null
              ? "n/a"
              : `${formatNumber(entry.energyKcalPerHour)} kcal/h`}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-[var(--ui-ink-faint)] lg:hidden">
            Load / h
          </div>
          <div className="mt-1 text-sm text-[var(--ui-ink)] lg:mt-0">
            {entry.trainingLoadPerHour == null
              ? "n/a"
              : `${formatNumber(entry.trainingLoadPerHour, 1)} TRIMP/h`}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--ui-ink-faint)]">
            {percentage(entry.trainingLoadCoverage)} coverage
          </div>
        </div>
      </div>
    </div>
  );
}

function periodWithFallback(
  comparison: SportComparisonData,
  key: SportComparisonPeriod["key"]
) {
  return (
    comparison.periods.find((period) => period.key === key) ??
    comparison.periods[0]
  );
}

export function SportComparisonPanel({
  comparison
}: {
  comparison: SportComparisonData;
}) {
  const [periodKey, setPeriodKey] =
    useState<SportComparisonPeriod["key"]>("all");
  const [metric, setMetric] = useState<ComparisonMetric>("duration");
  const [showAll, setShowAll] = useState(false);
  const period = periodWithFallback(comparison, periodKey);
  const metricDefinition = METRICS.find((entry) => entry.key === metric)!;
  const chartData = useMemo(
    () =>
      [...(period?.sports ?? [])]
        .filter((entry) => hasMetricEvidence(entry, metric))
        .sort(
          (left, right) =>
            metricValue(right, metric) - metricValue(left, metric) ||
            right.totalDurationSeconds - left.totalDurationSeconds
        )
        .slice(0, 8)
        .map((entry) => ({
          id: entry.workoutType,
          name: entry.workoutTypeLabel,
          value: metricValue(entry, metric),
          color: sportColor(entry.workoutType)
        })),
    [metric, period]
  );
  const visibleSports = showAll
    ? (period?.sports ?? [])
    : (period?.sports ?? []).slice(0, 8);

  if (!period) {
    return null;
  }

  return (
    <Card className="grid gap-5" data-testid="sport-comparison-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            <Scale className="size-3.5" />
            Sport comparison
          </div>
          <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
            Time, sessions, energy, and training load by sport
          </div>
        </div>
        <div
          className="inline-grid grid-cols-3 overflow-hidden rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
          aria-label="Comparison period"
        >
          {comparison.periods.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={cn(
                "min-h-9 border-l border-[var(--ui-border-subtle)] px-3 text-xs transition first:border-l-0",
                entry.key === period.key
                  ? "bg-[var(--ui-surface-3)] text-[var(--ui-ink-strong)]"
                  : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
              )}
              aria-pressed={entry.key === period.key}
              onClick={() => setPeriodKey(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-y-3 sm:grid-cols-4">
        <SummaryValue
          label="Training time"
          value={formatDuration(period.totals.totalDurationSeconds)}
          detail={`${period.totals.activeDayCount} active days`}
        />
        <SummaryValue
          label="Sessions"
          value={formatNumber(period.totals.sessionCount)}
          detail={`${period.totals.sportCount} sport types`}
        />
        <SummaryValue
          label="Reported energy"
          value={
            period.totals.totalEnergyKcal == null
              ? "n/a"
              : `${formatNumber(period.totals.totalEnergyKcal)} kcal`
          }
          detail={`${percentage(period.totals.energyCoverage)} coverage`}
        />
        <SummaryValue
          label="Training load"
          value={
            period.totals.totalTrainingLoad == null
              ? "n/a"
              : formatNumber(period.totals.totalTrainingLoad, 1)
          }
          detail={`${percentage(period.totals.trainingLoadCoverage)} coverage`}
        />
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <div className="min-w-0 border-t border-[var(--ui-border-subtle)] pt-4 2xl:border-r 2xl:border-t-0 2xl:pr-4 2xl:pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
              {metricDefinition.label}
            </div>
            <span
              className="inline-flex items-center gap-1 text-[11px] text-[var(--ui-ink-faint)]"
              title={metricDefinition.title}
            >
              <Info className="size-3.5" />
              Metric definition
            </span>
          </div>
          <div
            className="mt-3 grid grid-cols-3 gap-1 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-1"
            aria-label="Comparison metric"
          >
            {METRICS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={cn(
                  "min-h-8 min-w-0 rounded-[6px] px-2 text-[11px] leading-4 transition",
                  entry.key === metric
                    ? "bg-[var(--ui-surface-3)] text-[var(--ui-ink-strong)]"
                    : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
                )}
                title={entry.title}
                aria-pressed={entry.key === metric}
                onClick={() => setMetric(entry.key)}
              >
                {entry.shortLabel}
              </button>
            ))}
          </div>
          {chartData.length > 0 ? (
            <ComparisonChartViewport
              height={Math.max(240, chartData.length * 42)}
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={1}
                minHeight={1}
                initialDimension={{ width: 1, height: 1 }}
              >
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 12, right: 12, bottom: 8, left: 2 }}
                >
                  <CartesianGrid
                    stroke="var(--ui-border-subtle)"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={{ fill: "var(--ui-ink-faint)", fontSize: 10 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={112}
                    tick={{ fill: "var(--ui-ink-soft)", fontSize: 10 }}
                  />
                  <Tooltip
                    formatter={(value) => [
                      formatMetric(Number(value), metric),
                      metricDefinition.label
                    ]}
                    contentStyle={{
                      background: "var(--ui-surface-popover)",
                      border: "1px solid var(--ui-border-strong)",
                      borderRadius: 8,
                      color: "var(--ui-ink-strong)"
                    }}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry) => (
                      <Cell key={entry.id} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ComparisonChartViewport>
          ) : (
            <div className="flex min-h-60 items-center justify-center text-sm text-[var(--ui-ink-faint)]">
              {period.sports.length === 0
                ? "No workouts fall inside this period."
                : `No ${metricDefinition.label.toLowerCase()} data is available for this period.`}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="hidden grid-cols-[minmax(140px,1.35fr)_minmax(90px,0.8fr)_minmax(80px,0.65fr)_minmax(100px,0.8fr)_minmax(100px,0.8fr)_minmax(100px,0.8fr)] gap-3 pb-2 text-[10px] uppercase text-[var(--ui-ink-faint)] lg:grid">
            <span>Sport</span>
            <span>Time · share</span>
            <span>Sessions · share</span>
            <span>Calories</span>
            <span>Energy / h</span>
            <span>Load / h</span>
          </div>
          <div data-testid="sport-comparison-breakdown">
            {visibleSports.map((entry) => (
              <SportBreakdownRow key={entry.workoutType} entry={entry} />
            ))}
          </div>
          {period.sports.length > 8 ? (
            <button
              type="button"
              className="mt-3 text-sm text-[var(--primary)] transition hover:text-[var(--ui-ink-strong)]"
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll
                ? "Show leading sports"
                : `Show all ${period.sports.length} sports`}
            </button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
