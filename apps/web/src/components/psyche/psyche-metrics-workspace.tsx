import { useMemo, useState, type ComponentType } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Brain,
  CalendarDays,
  CircleAlert,
  Database,
  Gauge,
  MessageSquareText,
  Minus,
  RotateCcw,
  ShieldCheck
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  PsycheMetricDayRecord,
  PsycheMetricFamily,
  PsycheMetricsViewData
} from "@/lib/psyche-types";
import { cn } from "@/lib/utils";

type PsycheMetric = PsycheMetricsViewData["metrics"][number];
type MetricFamily = "all" | PsycheMetricFamily;
type ReviewRange = "7" | "30" | "90" | "all";

interface MetricDefinition {
  family: Exclude<MetricFamily, "all">;
  shortLabel: string;
  description: string;
  method: string;
  interpretation: string;
  sampleUnit: string;
  icon: ComponentType<{ className?: string }>;
}

interface ReviewedMetric {
  metric: PsycheMetric;
  days: PsycheMetricDayRecord[];
  latestDay: PsycheMetricDayRecord | null;
  latestValue: number | null;
  trackedDays: number;
  missingDays: number;
  calendarDays: number;
}

const FAMILY_OPTIONS: Array<{
  value: MetricFamily;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "mood", label: "Mood" },
  { value: "urges", label: "Urges" },
  { value: "selfRegulation", label: "Self-regulation" },
  { value: "conversation", label: "Conversation" }
];

const RANGE_OPTIONS: Array<{ value: ReviewRange; label: string }> = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All" }
];

const FAMILY_DETAILS: Array<{
  family: Exclude<MetricFamily, "all" | "other">;
  label: string;
  source: string;
  unavailableDescription: string;
  href?: string;
  hrefLabel?: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  {
    family: "mood",
    label: "Mood",
    source: "Trigger-report emotions",
    unavailableDescription:
      "No active trigger report in this scope has both an occurred-at date and an explicit emotion intensity.",
    href: "/psyche/reports",
    hrefLabel: "Review trigger reports",
    icon: Brain
  },
  {
    family: "urges",
    label: "Urges",
    source: "Behavior definitions",
    unavailableDescription:
      "No dated canonical urge-intensity field exists. Behavior urge stories and report behaviors are text, so no numeric series is derived.",
    href: "/psyche/behaviors",
    hrefLabel: "Review behavior definitions",
    icon: CircleAlert
  },
  {
    family: "selfRegulation",
    label: "Self-regulation",
    source: "Reports and observations",
    unavailableDescription:
      "No dated completed self-regulation outcome exists. Planned next moves are not scored as completed regulation.",
    href: "/psyche/self-observation",
    hrefLabel: "Review observations",
    icon: ShieldCheck
  },
  {
    family: "conversation",
    label: "Conversation signals",
    source: "Local conversation scanner",
    unavailableDescription:
      "The conversation metric contract is ready, but no stored scanner rows are available in the selected data set.",
    icon: MessageSquareText
  }
];

const sectionHeadingClass =
  "text-lg font-semibold text-[var(--ui-ink-strong)] sm:text-xl";
const sectionEyebrowClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const compactCardClass =
  "rounded-[8px] border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] shadow-none";

function metricDefinition(metric: PsycheMetric): MetricDefinition {
  const icon =
    metric.metric === "swearingMessagePercent"
      ? Gauge
      : metric.metric === "devrageAverageMaxCumulativeRage"
        ? Activity
        : metric.metric === "devrageMaxCumulativeRage"
          ? CircleAlert
          : metric.family === "mood"
            ? Brain
            : metric.family === "conversation"
              ? MessageSquareText
              : Activity;

  return {
    family: metric.family,
    shortLabel: metric.label,
    description: metric.definition.description,
    method: metric.definition.calculation,
    interpretation: metric.definition.interpretation,
    sampleUnit: metric.sampleUnit,
    icon
  };
}

function metricFamilyLabel(family: MetricDefinition["family"]) {
  if (family === "selfRegulation") {
    return "Self-regulation signal";
  }
  if (family === "conversation") {
    return "Conversation signal";
  }
  if (family === "other") {
    return "Unclassified signal";
  }
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} signal`;
}

function metricValue(
  metric: PsycheMetric,
  day: PsycheMetricDayRecord | null | undefined
) {
  if (!day || day.sampleCount <= 0) {
    return null;
  }
  if (metric.aggregation === "cumulative") {
    return day.total ?? day.latest ?? day.maximum ?? day.average;
  }
  return day.latest ?? day.average ?? day.maximum ?? day.minimum;
}

function formatMetricValue(metric: PsycheMetric, value: number | null) {
  if (value == null) {
    return "No reading";
  }
  const integerUnit = ["swears", "conversations", "messages", "count"].includes(
    metric.unit
  );
  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: integerUnit ? 0 : 1,
    minimumFractionDigits: integerUnit ? 0 : 1
  });
  return `${formatted} ${metric.unit}`;
}

function scopeMetricToOwner(
  metric: PsycheMetric,
  ownerUserId: string
): PsycheMetric | null {
  if (metric.source.ownerAttribution === "unattributed") {
    return null;
  }
  const days = metric.days.flatMap((day) => {
    const sourceRecords = day.sourceRecords.filter(
      (record) =>
        record.ownerUserId === ownerUserId &&
        record.value != null &&
        record.sampleCount > 0
    );
    const sampleCount = sourceRecords.reduce(
      (sum, record) => sum + record.sampleCount,
      0
    );
    if (sampleCount === 0) {
      return [];
    }
    const average =
      sourceRecords.reduce(
        (sum, record) => sum + (record.value ?? 0) * record.sampleCount,
        0
      ) / sampleCount;
    const values = sourceRecords.map((record) => record.value ?? 0);
    return [
      {
        ...day,
        average,
        minimum: Math.min(...values),
        maximum: Math.max(...values),
        latest: average,
        total: metric.aggregation === "cumulative" ? average : null,
        sampleCount,
        latestSampleAt:
          sourceRecords
            .map((record) => record.recordedAt)
            .sort()
            .at(-1) ?? null,
        sourceRecords
      }
    ];
  });
  if (days.length === 0) {
    return null;
  }
  const values = days
    .map((day) => metricValue(metric, day))
    .filter((value): value is number => value != null);
  const latestValue = values.at(-1) ?? null;
  const baselineValues = values.slice(
    Math.max(0, values.length - 8),
    values.length - 1
  );
  const baselineValue =
    baselineValues.length > 0
      ? baselineValues.reduce((sum, value) => sum + value, 0) /
        baselineValues.length
      : (values.at(-2) ?? null);

  return {
    ...metric,
    latestValue,
    latestDateKey: days.at(-1)?.dateKey ?? null,
    baselineValue,
    deltaValue:
      latestValue != null && baselineValue != null
        ? latestValue - baselineValue
        : null,
    coverageDays: days.length,
    days
  };
}

function formatDate(dateKey: string | null, includeYear = false) {
  if (!dateKey) {
    return "No date";
  }
  const date = new Date(`${dateKey}T12:00:00`);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: includeYear ? "numeric" : undefined
  });
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not recorded";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function dateKeyOffset(dateKey: string, offset: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function calendarDaySpan(start: string, end: string) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.max(0, Math.round((endMs - startMs) / 86_400_000) + 1);
}

function allDateKeys(metrics: PsycheMetric[]) {
  return metrics
    .flatMap((metric) => metric.days.map((day) => day.dateKey))
    .filter(Boolean)
    .sort();
}

function getWindow(
  metrics: PsycheMetric[],
  range: ReviewRange,
  summaryLatestDateKey: string | null
) {
  const dates = allDateKeys(metrics);
  const end = summaryLatestDateKey ?? dates.at(-1) ?? null;
  if (!end) {
    return { start: null, end: null, calendarDays: 0 };
  }
  const earliest = dates[0] ?? end;
  const requestedDays = range === "all" ? null : Number(range);
  const start = requestedDays
    ? dateKeyOffset(end, -(requestedDays - 1))
    : earliest;
  return {
    start,
    end,
    calendarDays: requestedDays ?? calendarDaySpan(start, end)
  };
}

function reviewMetric(
  metric: PsycheMetric,
  window: { start: string | null; end: string | null; calendarDays: number }
): ReviewedMetric {
  const days = metric.days
    .filter(
      (day) =>
        (!window.start || day.dateKey >= window.start) &&
        (!window.end || day.dateKey <= window.end)
    )
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
  const trackedDays = days.filter(
    (day) => day.sampleCount > 0 && metricValue(metric, day) != null
  ).length;
  const latestDay =
    [...days].reverse().find((day) => metricValue(metric, day) != null) ?? null;

  return {
    metric,
    days,
    latestDay,
    latestValue: metricValue(metric, latestDay),
    trackedDays,
    missingDays: Math.max(0, window.calendarDays - trackedDays),
    calendarDays: window.calendarDays
  };
}

function buildChartData(
  reviewed: ReviewedMetric,
  start: string | null,
  end: string | null
) {
  if (!start || !end) {
    return [];
  }
  const byDate = new Map(reviewed.days.map((day) => [day.dateKey, day]));
  const span = calendarDaySpan(start, end);

  if (span <= 366) {
    return Array.from({ length: span }, (_, index) => {
      const dateKey = dateKeyOffset(start, index);
      const day = byDate.get(dateKey);
      return {
        dateKey,
        value: metricValue(reviewed.metric, day),
        sampleCount: day?.sampleCount ?? 0
      };
    });
  }

  const points: Array<{
    dateKey: string;
    value: number | null;
    sampleCount: number;
  }> = [];
  let previousDate: string | null = null;
  for (const day of reviewed.days) {
    if (previousDate && calendarDaySpan(previousDate, day.dateKey) > 2) {
      points.push({
        dateKey: dateKeyOffset(previousDate, 1),
        value: null,
        sampleCount: 0
      });
    }
    points.push({
      dateKey: day.dateKey,
      value: metricValue(reviewed.metric, day),
      sampleCount: day.sampleCount
    });
    previousDate = day.dateKey;
  }
  return points;
}

function DeltaValue({ metric }: { metric: PsycheMetric }) {
  const value = metric.deltaValue;
  const Icon =
    value == null ? Minus : value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[var(--ui-ink-strong)]">
      <Icon className="size-4 shrink-0" />
      <span className="break-words">
        {value == null
          ? "No baseline"
          : `${value > 0 ? "+" : ""}${formatMetricValue(metric, value)}`}
      </span>
    </span>
  );
}

function FilterGroup<T extends string>({
  legend,
  value,
  options,
  onChange
}: {
  legend: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={sectionEyebrowClass}>{legend}</legend>
      <div className="mt-2 flex min-w-0 flex-wrap gap-1.5" role="group">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            className={cn(
              "min-h-10 rounded-[6px] border px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]",
              option.value === value
                ? "border-[color-mix(in_srgb,var(--primary)_42%,var(--ui-border-subtle)_58%)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]"
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function FamilyCoverage({
  view,
  metrics,
  selectedFamily,
  ownerSelected
}: {
  view: PsycheMetricsViewData;
  metrics: PsycheMetric[];
  selectedFamily: MetricFamily;
  ownerSelected: boolean;
}) {
  return (
    <section
      aria-labelledby="psyche-family-coverage-title"
      className="grid gap-3"
    >
      <div>
        <div className={sectionEyebrowClass}>Signal coverage</div>
        <h2 id="psyche-family-coverage-title" className={sectionHeadingClass}>
          What this metric view can substantiate
        </h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {FAMILY_DETAILS.map((detail) => {
          const familyMetrics = metrics.filter(
            (metric) => metricDefinition(metric).family === detail.family
          );
          const available = familyMetrics.length > 0;
          const availability = view.summary.familyAvailability.find(
            (entry) => entry.family === detail.family
          );
          const Icon = detail.icon;
          return (
            <Card
              key={detail.family}
              className={cn(
                compactCardClass,
                "grid content-start gap-3 p-4",
                selectedFamily === detail.family &&
                  "border-[color-mix(in_srgb,var(--primary)_44%,var(--ui-border-subtle)_56%)]"
              )}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="break-words font-semibold text-[var(--ui-ink-strong)]">
                    {detail.label}
                  </div>
                  <div className="mt-0.5 break-words text-xs text-[var(--ui-ink-faint)]">
                    {detail.source}
                  </div>
                </div>
                <Icon className="size-5 shrink-0 text-[var(--primary)]" />
              </div>
              <Badge
                size="sm"
                wrap
                className={cn(
                  "w-fit rounded-[5px]",
                  available
                    ? "border-[color-mix(in_srgb,var(--success)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-success-soft)] text-[var(--success)]"
                    : "bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]"
                )}
              >
                {available
                  ? `${familyMetrics.length} metric${familyMetrics.length === 1 ? "" : "s"} available`
                  : "Not measured here"}
              </Badge>
              <p className="text-sm leading-6 text-[var(--ui-ink-soft)]">
                {available
                  ? (availability?.reason ??
                    "Stored readings are available with coverage and method detail.")
                  : ownerSelected && availability?.status === "available"
                    ? "No attributable readings for this owner are present in the selected source records."
                    : (availability?.reason ?? detail.unavailableDescription)}
              </p>
              {!available && detail.href && detail.hrefLabel ? (
                <Link
                  to={detail.href}
                  className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[6px] text-sm font-medium text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]"
                >
                  {detail.hrefLabel}
                  <ArrowRight className="size-4" />
                </Link>
              ) : null}
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function MetricChart({
  reviewed,
  start,
  end
}: {
  reviewed: ReviewedMetric;
  start: string | null;
  end: string | null;
}) {
  const chartData = useMemo(
    () => buildChartData(reviewed, start, end),
    [reviewed, start, end]
  );
  const definition = metricDefinition(reviewed.metric);
  const hasValues = chartData.some((point) => point.value != null);

  if (!hasValues) {
    return (
      <div
        role="status"
        className="flex h-64 items-center justify-center rounded-[8px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-5 text-center text-sm text-[var(--ui-ink-soft)]"
      >
        No readings in this review window. Missing days are not treated as zero.
      </div>
    );
  }

  return (
    <figure
      className="grid min-w-0 gap-2"
      aria-labelledby="psyche-metric-chart-title"
    >
      <div
        className="h-64 min-w-0 overflow-hidden rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-2 sm:h-72"
        data-testid="psyche-metric-chart"
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 640, height: 288 }}
        >
          <ComposedChart
            accessibilityLayer
            data={chartData}
            margin={{ top: 12, right: 12, bottom: 4, left: 0 }}
          >
            <CartesianGrid
              stroke="var(--ui-border-subtle)"
              strokeDasharray="3 5"
              vertical={false}
            />
            <XAxis
              dataKey="dateKey"
              tickFormatter={(value) => formatDate(String(value))}
              tick={{ fill: "var(--ui-ink-faint)", fontSize: 11 }}
              axisLine={{ stroke: "var(--ui-border-subtle)" }}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              width={48}
              domain={[0, "auto"]}
              tick={{ fill: "var(--ui-ink-faint)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={reviewed.metric.unit !== "swears"}
            />
            <Tooltip
              cursor={{ stroke: "var(--ui-border-strong)" }}
              labelFormatter={(value) => formatDate(String(value), true)}
              formatter={(value) => [
                formatMetricValue(reviewed.metric, Number(value)),
                definition.shortLabel
              ]}
              contentStyle={{
                border: "1px solid var(--ui-border-subtle)",
                borderRadius: "8px",
                background: "var(--ui-surface-modal)",
                color: "var(--ui-ink-strong)"
              }}
            />
            {reviewed.metric.baselineValue != null ? (
              <ReferenceLine
                y={reviewed.metric.baselineValue}
                stroke="var(--ui-ink-faint)"
                strokeDasharray="5 5"
              />
            ) : null}
            {reviewed.metric.aggregation === "cumulative" ? (
              <Bar
                dataKey="value"
                fill="var(--warning)"
                fillOpacity={0.78}
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
              />
            ) : (
              <Line
                type="linear"
                dataKey="value"
                stroke="var(--info)"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, fill: "var(--warning)" }}
                connectNulls={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption
        id="psyche-metric-chart-title"
        className="text-xs leading-5 text-[var(--ui-ink-faint)]"
      >
        {definition.shortLabel} from {formatDate(start, true)} through{" "}
        {formatDate(end, true)}. The dashed line is the current scope baseline.
        Gaps remain missing rather than becoming zero.
      </figcaption>
    </figure>
  );
}

function MetricReadingTable({ reviewed }: { reviewed: ReviewedMetric }) {
  const definition = metricDefinition(reviewed.metric);
  return (
    <details className="border-t border-[var(--ui-border-subtle)] pt-4">
      <summary className="min-h-10 cursor-pointer text-sm font-medium text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]">
        Reading table ({reviewed.days.length})
      </summary>
      <div className="mt-3 max-h-80 overflow-auto rounded-[8px] border border-[var(--ui-border-subtle)]">
        <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Daily readings for {reviewed.metric.label}
          </caption>
          <thead className="sticky top-0 bg-[var(--ui-surface-2)] text-[var(--ui-ink-faint)]">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Date
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Reading
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Sample scope
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Computed
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Source records
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ui-border-subtle)]">
            {[...reviewed.days].reverse().map((day) => (
              <tr key={day.dateKey} className="text-[var(--ui-ink-medium)]">
                <td className="whitespace-nowrap px-3 py-2">
                  {formatDate(day.dateKey, true)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-medium text-[var(--ui-ink-strong)]">
                  {formatMetricValue(
                    reviewed.metric,
                    metricValue(reviewed.metric, day)
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {day.sampleCount > 0
                    ? `${day.sampleCount.toLocaleString()} ${definition.sampleUnit}`
                    : "No source samples"}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {formatDateTime(day.latestSampleAt)}
                </td>
                <td className="min-w-56 px-3 py-2">
                  {day.sourceRecords.length > 0 ? (
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {day.sourceRecords.map((record) =>
                        record.href ? (
                          <Link
                            key={`${record.sourceType}:${record.sourceId}`}
                            to={record.href}
                            className="font-medium text-[var(--primary)] underline-offset-4 hover:underline"
                          >
                            {record.label}
                          </Link>
                        ) : (
                          <span key={`${record.sourceType}:${record.sourceId}`}>
                            {record.label}
                          </span>
                        )
                      )}
                    </div>
                  ) : (
                    <span className="text-[var(--ui-ink-faint)]">
                      Aggregate only; item links unavailable
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function MetricDetail({
  reviewed,
  start,
  end
}: {
  reviewed: ReviewedMetric;
  start: string | null;
  end: string | null;
}) {
  const definition = metricDefinition(reviewed.metric);
  const Icon = definition.icon;
  const latestIsCanonical =
    reviewed.latestDay?.dateKey === reviewed.metric.latestDateKey;

  return (
    <article
      id="psyche-metric-detail"
      aria-labelledby="psyche-metric-detail-title"
      className="min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-4 sm:p-5"
    >
      <div className="flex min-w-0 flex-col gap-4 border-b border-[var(--ui-border-subtle)] pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[6px] bg-[var(--ui-accent-soft)] text-[var(--primary)]">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className={sectionEyebrowClass}>
              {metricFamilyLabel(definition.family)}
            </div>
            <h3
              id="psyche-metric-detail-title"
              className="break-words text-xl font-semibold text-[var(--ui-ink-strong)]"
            >
              {definition.shortLabel}
            </h3>
            <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
              {definition.description}
            </p>
          </div>
        </div>
        <Badge size="sm" className="w-fit rounded-[5px]" wrap>
          {reviewed.metric.aggregation}
        </Badge>
      </div>

      <dl className="grid gap-px overflow-hidden rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-border-subtle)] sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0 bg-[var(--ui-surface-1)] p-3">
          <dt className={sectionEyebrowClass}>Latest in window</dt>
          <dd className="mt-1 break-words text-lg font-semibold text-[var(--ui-ink-strong)]">
            {formatMetricValue(reviewed.metric, reviewed.latestValue)}
          </dd>
          <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
            {reviewed.latestDay
              ? formatDate(reviewed.latestDay.dateKey, true)
              : "No stored date"}
          </div>
        </div>
        <div className="min-w-0 bg-[var(--ui-surface-1)] p-3">
          <dt className={sectionEyebrowClass}>Backend baseline</dt>
          <dd className="mt-1 break-words text-lg font-semibold text-[var(--ui-ink-strong)]">
            {latestIsCanonical
              ? formatMetricValue(
                  reviewed.metric,
                  reviewed.metric.baselineValue
                )
              : "Not comparable"}
          </dd>
          <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
            Previous up to 7 stored readings
          </div>
        </div>
        <div className="min-w-0 bg-[var(--ui-surface-1)] p-3">
          <dt className={sectionEyebrowClass}>Descriptive change</dt>
          <dd className="mt-1 text-lg font-semibold">
            {latestIsCanonical ? (
              <DeltaValue metric={reviewed.metric} />
            ) : (
              <span className="text-[var(--ui-ink-soft)]">Not comparable</span>
            )}
          </dd>
          <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
            No good or bad direction assigned
          </div>
        </div>
        <div className="min-w-0 bg-[var(--ui-surface-1)] p-3">
          <dt className={sectionEyebrowClass}>
            {reviewed.metric.cadence === "event_based"
              ? "Observation gaps"
              : "Missingness"}
          </dt>
          <dd className="mt-1 text-lg font-semibold text-[var(--ui-ink-strong)]">
            {reviewed.missingDays.toLocaleString()}{" "}
            {reviewed.metric.cadence === "event_based"
              ? "without a report"
              : "missing"}
          </dd>
          <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
            {reviewed.trackedDays} of {reviewed.calendarDays} calendar days
            observed
          </div>
        </div>
      </dl>

      <div className="mt-4">
        <MetricChart reviewed={reviewed} start={start} end={end} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3">
          <div className={sectionEyebrowClass}>Calculation</div>
          <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
            {definition.method}
          </p>
        </div>
        <div className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3">
          <div className={sectionEyebrowClass}>Interpretation limit</div>
          <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
            {definition.interpretation}
          </p>
        </div>
        <div className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3">
          <div className={sectionEyebrowClass}>Confidence</div>
          <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
            {reviewed.metric.confidence.rationale}
          </p>
        </div>
        <div className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3">
          <div className={sectionEyebrowClass}>Missingness rule</div>
          <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
            {reviewed.metric.definition.missingness}
          </p>
        </div>
      </div>

      <MetricReadingTable reviewed={reviewed} />
    </article>
  );
}

function MissingFamilyState({
  family,
  view,
  ownerSelected
}: {
  family: MetricFamily;
  view: PsycheMetricsViewData;
  ownerSelected: boolean;
}) {
  const detail = FAMILY_DETAILS.find((entry) => entry.family === family);
  const availability = view.summary.familyAvailability.find(
    (entry) => entry.family === family
  );
  const isAll = family === "all";
  return (
    <Card
      role="status"
      aria-live="polite"
      className={cn(compactCardClass, "grid gap-3 p-5")}
    >
      <div className={sectionEyebrowClass}>
        {isAll ? "No stored metrics" : `${detail?.label ?? "Selected"} metrics`}
      </div>
      <h2 className={sectionHeadingClass}>
        {isAll
          ? ownerSelected
            ? "No attributable metrics are available for this owner"
            : "No Psyche metric rows are available"
          : availability?.status === "unsupported"
            ? family === "conversation" &&
              view.context.ownerScope.mode === "scoped"
              ? "Conversation signals are unavailable in owner scope"
              : `${detail?.label ?? "This family"} cannot be derived from canonical records`
            : `${detail?.label ?? "This family"} has no readings in this scope`}
      </h2>
      <p className="max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
        {isAll
          ? ownerSelected
            ? "The selected owner has no attributed source records in this response. Unattributed conversation signals are excluded from owner-specific views."
            : "Forge reads canonical trigger reports and stored scanner aggregates on this page. It does not scan conversations while rendering."
          : (availability?.reason ?? detail?.unavailableDescription)}
      </p>
      {detail?.href && detail.hrefLabel ? (
        <Link
          to={detail.href}
          className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[6px] text-sm font-medium text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]"
        >
          {detail.hrefLabel}
          <ArrowRight className="size-4" />
        </Link>
      ) : null}
    </Card>
  );
}

function freshnessLabel(
  status: PsycheMetricsViewData["context"]["freshness"]["status"]
) {
  if (status === "not_synced") {
    return "Not synced";
  }
  if (status === "not_applicable") {
    return "Not applicable";
  }
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

function ProvenanceSection({
  metrics,
  selectedOwnerLabel
}: {
  metrics: PsycheMetricsViewData;
  selectedOwnerLabel: string | null;
}) {
  return (
    <section aria-labelledby="psyche-provenance-title" className="grid gap-3">
      <div>
        <div className={sectionEyebrowClass}>Provenance</div>
        <h2 id="psyche-provenance-title" className={sectionHeadingClass}>
          Source, freshness, and traceability
        </h2>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className={cn(compactCardClass, "grid gap-4 p-4 sm:p-5")}>
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" />
            <div>
              <div className="font-semibold text-[var(--ui-ink-strong)]">
                Read-model freshness
              </div>
              <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Trigger-report metrics are read from canonical records when this
                response is generated.{" "}
                {metrics.context.ownerScope.mode === "scoped"
                  ? "Conversation metrics are excluded because scanner rows have no canonical owner attribution."
                  : "Conversation metrics use the last successful authoritative scanner sync."}
              </p>
            </div>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className={sectionEyebrowClass}>Scanner freshness</dt>
              <dd className="mt-1 text-[var(--ui-ink-medium)]">
                {freshnessLabel(metrics.context.freshness.status)}
              </dd>
            </div>
            <div>
              <dt className={sectionEyebrowClass}>Last successful sync</dt>
              <dd className="mt-1 text-[var(--ui-ink-medium)]">
                {formatDateTime(metrics.context.freshness.lastSuccessfulAt)}
              </dd>
            </div>
            <div>
              <dt className={sectionEyebrowClass}>Generated</dt>
              <dd className="mt-1 text-[var(--ui-ink-medium)]">
                {formatDateTime(metrics.context.generatedAt)}
              </dd>
            </div>
            <div>
              <dt className={sectionEyebrowClass}>Confidence</dt>
              <dd className="mt-1 text-[var(--ui-ink-medium)]">
                Uncertainty not estimated
              </dd>
            </div>
            <div>
              <dt className={sectionEyebrowClass}>Owner scope</dt>
              <dd className="mt-1 text-[var(--ui-ink-medium)]">
                {selectedOwnerLabel ??
                  (metrics.context.ownerScope.mode === "scoped"
                    ? "All permitted attributed owners"
                    : "All attributed and unattributed sources")}
              </dd>
            </div>
            <div>
              <dt className={sectionEyebrowClass}>Scope enforcement</dt>
              <dd className="mt-1 text-[var(--ui-ink-medium)]">
                {metrics.context.ownerScope.serverEnforced
                  ? "Server-enforced"
                  : "Unscoped all-data response"}
              </dd>
            </div>
          </dl>
          {metrics.context.freshness.status === "partial" ||
          metrics.context.freshness.status === "stale" ||
          metrics.context.freshness.status === "not_synced" ? (
            <div
              role="alert"
              className="rounded-[8px] border border-[color-mix(in_srgb,var(--warning)_35%,var(--ui-border-subtle)_65%)] bg-[var(--ui-warning-soft)] p-3 text-sm leading-6 text-[var(--ui-ink-medium)]"
            >
              <div className="font-semibold text-[var(--ui-ink-strong)]">
                Conversation freshness:{" "}
                {freshnessLabel(metrics.context.freshness.status)}
              </div>
              {metrics.context.freshness.warnings.length > 0 ? (
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {metrics.context.freshness.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1">
                  No current successful scanner reading is available. Canonical
                  trigger-report metrics remain independent of scanner
                  freshness.
                </p>
              )}
            </div>
          ) : null}
        </Card>

        <Card className={cn(compactCardClass, "grid gap-4 p-4 sm:p-5")}>
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[var(--success)]" />
            <div>
              <div className="font-semibold text-[var(--ui-ink-strong)]">
                Sources and traceability
              </div>
              <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Linked trigger reports can be opened.{" "}
                {metrics.context.ownerScope.mode === "scoped"
                  ? "Conversation scanner rows are omitted because this contract cannot attribute them to an owner."
                  : "Scanner source families are named, but individual conversation links are not authorized by this read contract."}
              </p>
            </div>
          </div>
          {metrics.context.ownerScope.mode === "scoped" ? (
            <p className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
              Conversation records are unavailable in this owner scope because
              scanner ownership is not recorded.
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className={sectionEyebrowClass}>Conversations</dt>
                <dd className="mt-1 font-semibold text-[var(--ui-ink-strong)]">
                  {metrics.context.conversationsScanned.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className={sectionEyebrowClass}>Messages</dt>
                <dd className="mt-1 font-semibold text-[var(--ui-ink-strong)]">
                  {metrics.context.messagesScanned.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className={sectionEyebrowClass}>Flagged</dt>
                <dd className="mt-1 font-semibold text-[var(--ui-ink-strong)]">
                  {metrics.context.messagesWithSwears.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className={sectionEyebrowClass}>Source families</dt>
                <dd className="mt-1 font-semibold text-[var(--ui-ink-strong)]">
                  {metrics.context.sourceCount.toLocaleString()}
                </dd>
              </div>
            </dl>
          )}
          <div className="grid gap-2 border-t border-[var(--ui-border-subtle)] pt-3 text-sm">
            {metrics.context.sources.map((source) => (
              <div
                key={source.sourceId}
                className="flex min-w-0 items-center justify-between gap-3"
              >
                {source.href ? (
                  <Link
                    to={source.href}
                    className="min-w-0 break-words font-medium text-[var(--primary)] underline-offset-4 hover:underline"
                  >
                    {source.label}
                  </Link>
                ) : (
                  <span className="min-w-0 break-words text-[var(--ui-ink-medium)]">
                    {source.label}
                  </span>
                )}
                <span className="shrink-0 text-[var(--ui-ink-faint)]">
                  {source.recordCount.toLocaleString()} records
                </span>
              </div>
            ))}
          </div>
          {metrics.context.dataQualityWarnings.length > 0 ? (
            <div className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
              {metrics.context.dataQualityWarnings.join(" ")}
            </div>
          ) : null}
        </Card>
      </div>
      <p className="text-xs leading-5 text-[var(--ui-ink-faint)]">
        Psyche metrics are reflection aids. Conversation-derived signals are not
        clinical assessments and do not establish cause.
      </p>
      <p className="text-xs leading-5 text-[var(--ui-ink-faint)]">
        {metrics.context.ownerScope.limitation}
      </p>
    </section>
  );
}

export function PsycheMetricsWorkspace({
  metrics
}: {
  metrics: PsycheMetricsViewData;
}) {
  const [family, setFamily] = useState<MetricFamily>("all");
  const [range, setRange] = useState<ReviewRange>("30");
  const [ownerUserId, setOwnerUserId] = useState("all");
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null);
  const selectedOwner = metrics.context.ownerScope.availableOwners.find(
    (owner) => owner.userId === ownerUserId
  );
  const scopedMetrics = useMemo(
    () =>
      ownerUserId === "all"
        ? metrics.metrics
        : metrics.metrics.flatMap((metric) => {
            const scopedMetric = scopeMetricToOwner(metric, ownerUserId);
            return scopedMetric ? [scopedMetric] : [];
          }),
    [metrics.metrics, ownerUserId]
  );

  const window = useMemo(
    () =>
      getWindow(
        scopedMetrics,
        range,
        ownerUserId === "all" ? metrics.summary.latestDateKey : null
      ),
    [metrics.summary.latestDateKey, ownerUserId, range, scopedMetrics]
  );
  const reviewedMetrics = useMemo(
    () =>
      scopedMetrics
        .filter(
          (metric) =>
            family === "all" || metricDefinition(metric).family === family
        )
        .map((metric) => reviewMetric(metric, window)),
    [family, scopedMetrics, window]
  );
  const selectedMetric =
    reviewedMetrics.find(
      (reviewed) => reviewed.metric.metric === selectedMetricId
    ) ??
    reviewedMetrics[0] ??
    null;
  const trackedDateKeys = new Set(
    reviewedMetrics.flatMap((reviewed) =>
      reviewed.days
        .filter(
          (day) =>
            day.sampleCount > 0 && metricValue(reviewed.metric, day) != null
        )
        .map((day) => day.dateKey)
    )
  );
  const resetFilters = () => {
    setFamily("all");
    setRange("30");
    setOwnerUserId("all");
    setSelectedMetricId(null);
  };

  return (
    <div className="grid gap-6">
      <section
        aria-labelledby="psyche-metric-filters-title"
        className="flex min-w-0 flex-col gap-4 border-y border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] px-3 py-4 sm:px-4 xl:flex-row xl:items-end xl:justify-between"
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] xl:flex-1">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-[var(--primary)]" />
              <h2
                id="psyche-metric-filters-title"
                className={sectionEyebrowClass}
              >
                Review scope
              </h2>
            </div>
            <div className="mt-3 grid gap-4 lg:grid-cols-3">
              <FilterGroup
                legend="Signal family"
                value={family}
                options={FAMILY_OPTIONS}
                onChange={(nextFamily) => {
                  setFamily(nextFamily);
                  setSelectedMetricId(null);
                }}
              />
              <FilterGroup
                legend="Date window"
                value={range}
                options={RANGE_OPTIONS}
                onChange={setRange}
              />
              <label className="min-w-0">
                <span className={sectionEyebrowClass}>Owner scope</span>
                <select
                  aria-label="Owner scope"
                  value={ownerUserId}
                  onChange={(event) => {
                    setOwnerUserId(event.target.value);
                    setSelectedMetricId(null);
                  }}
                  className="mt-2 min-h-10 w-full rounded-[6px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2 text-sm font-medium text-[var(--ui-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]"
                >
                  <option value="all">
                    {metrics.context.ownerScope.mode === "scoped"
                      ? "All permitted owners"
                      : "All sources"}
                  </option>
                  {metrics.context.ownerScope.availableOwners.map((owner) => (
                    <option key={owner.userId} value={owner.userId}>
                      {owner.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
        {family !== "all" || range !== "30" || ownerUserId !== "all" ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={resetFilters}
            aria-label="Reset Psyche metric filters"
            className="w-fit rounded-[6px]"
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
        ) : null}
      </section>

      <dl
        className="grid gap-px overflow-hidden rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-border-subtle)] sm:grid-cols-2 xl:grid-cols-4"
        aria-live="polite"
      >
        <div className="bg-[var(--ui-surface-1)] p-3">
          <dt className={sectionEyebrowClass}>Available metrics</dt>
          <dd className="mt-1 text-xl font-semibold text-[var(--ui-ink-strong)]">
            {reviewedMetrics.length}
          </dd>
        </div>
        <div className="bg-[var(--ui-surface-1)] p-3">
          <dt className={sectionEyebrowClass}>Days with readings</dt>
          <dd className="mt-1 text-xl font-semibold text-[var(--ui-ink-strong)]">
            {trackedDateKeys.size} of {window.calendarDays}
          </dd>
        </div>
        <div className="bg-[var(--ui-surface-1)] p-3">
          <dt className={sectionEyebrowClass}>Review window</dt>
          <dd className="mt-1 text-sm font-semibold text-[var(--ui-ink-strong)]">
            {window.start && window.end
              ? `${formatDate(window.start, true)} - ${formatDate(window.end, true)}`
              : "No stored dates"}
          </dd>
        </div>
        <div className="bg-[var(--ui-surface-1)] p-3">
          <dt className={sectionEyebrowClass}>Confidence status</dt>
          <dd className="mt-1 text-sm font-semibold text-[var(--ui-ink-strong)]">
            Uncertainty not estimated
          </dd>
        </div>
      </dl>

      <FamilyCoverage
        view={metrics}
        metrics={scopedMetrics}
        selectedFamily={family}
        ownerSelected={ownerUserId !== "all"}
      />

      {reviewedMetrics.length === 0 ? (
        <MissingFamilyState
          family={family}
          view={metrics}
          ownerSelected={ownerUserId !== "all"}
        />
      ) : (
        <section
          aria-labelledby="psyche-metric-review-title"
          className="grid gap-3"
        >
          <div>
            <div className={sectionEyebrowClass}>Metric review</div>
            <h2 id="psyche-metric-review-title" className={sectionHeadingClass}>
              Readings, method, and missingness
            </h2>
          </div>
          <div className="grid min-w-0 gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
            <div
              className="grid content-start gap-2 lg:sticky lg:top-4 lg:self-start"
              role="group"
              aria-label="Available Psyche metrics"
            >
              {reviewedMetrics.map((reviewed) => {
                const definition = metricDefinition(reviewed.metric);
                const Icon = definition.icon;
                const selected =
                  reviewed.metric.metric === selectedMetric?.metric.metric;
                return (
                  <button
                    key={reviewed.metric.metric}
                    type="button"
                    aria-pressed={selected}
                    aria-controls="psyche-metric-detail"
                    className={cn(
                      "grid min-h-[5.25rem] min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-[8px] border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]",
                      selected
                        ? "border-[color-mix(in_srgb,var(--primary)_45%,var(--ui-border-subtle)_55%)] bg-[var(--ui-accent-soft)]"
                        : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] hover:bg-[var(--ui-surface-hover)]"
                    )}
                    onClick={() => setSelectedMetricId(reviewed.metric.metric)}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-[var(--primary)]" />
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold text-[var(--ui-ink-strong)]">
                        {definition.shortLabel}
                      </span>
                      <span className="mt-1 block break-words text-xs text-[var(--ui-ink-soft)]">
                        {formatMetricValue(
                          reviewed.metric,
                          reviewed.latestValue
                        )}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--ui-ink-faint)]">
                        {reviewed.trackedDays} observed, {reviewed.missingDays}{" "}
                        {reviewed.metric.cadence === "event_based"
                          ? "without a report"
                          : "missing"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedMetric ? (
              <MetricDetail
                reviewed={selectedMetric}
                start={window.start}
                end={window.end}
              />
            ) : null}
          </div>
        </section>
      )}

      <ProvenanceSection
        metrics={metrics}
        selectedOwnerLabel={selectedOwner?.displayName ?? null}
      />
    </div>
  );
}
