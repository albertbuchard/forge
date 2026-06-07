import { useMemo, useState, type ComponentType } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity,
  Maximize2,
  X,
  Flame,
  Heart,
  MessageCircleWarning,
  Mountain,
  Percent,
  Scale,
  Sparkles,
  Wind
} from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface DailyMetricDayRecord {
  dateKey: string;
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  latest: number | null;
  total: number | null;
  sampleCount: number;
  latestSampleAt: string | null;
}

export interface DailyMetricRecord {
  metric: string;
  label: string;
  category: string;
  unit: string;
  aggregation: "discrete" | "cumulative";
  latestValue: number | null;
  latestDateKey: string | null;
  baselineValue: number | null;
  deltaValue: number | null;
  coverageDays: number;
  days: DailyMetricDayRecord[];
}

export interface DailyMetricCategoryGroup {
  category: string;
  metricCount: number;
  coverageDays: number;
  metrics: DailyMetricRecord[];
}

export function formatDateKey(dateKey: string | null) {
  if (!dateKey) {
    return "No date yet";
  }
  const date = new Date(`${dateKey}T12:00:00`);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

export function metricPrimaryValue(
  day: DailyMetricDayRecord,
  aggregation: DailyMetricRecord["aggregation"]
) {
  if (aggregation === "cumulative") {
    return day.total ?? day.latest ?? day.maximum ?? day.average;
  }
  return day.latest ?? day.average ?? day.maximum ?? day.minimum;
}

export function formatMetricValue(
  metric: DailyMetricRecord,
  value: number | null
) {
  if (value == null) {
    return "No reading";
  }
  const digits =
    metric.unit === "steps" ||
    metric.unit === "flights" ||
    metric.unit === "kcal" ||
    metric.unit === "min" ||
    metric.unit === "swears" ||
    metric.unit === "conversations" ||
    metric.unit === "messages"
      ? 0
      : metric.unit === "%"
        ? 1
        : 1;
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits === 0 ? 0 : value >= 100 ? 0 : 1
  })} ${metric.unit}`;
}

export function formatDelta(metric: DailyMetricRecord) {
  if (metric.deltaValue == null) {
    return "No baseline yet";
  }
  const sign = metric.deltaValue > 0 ? "+" : "";
  return `${sign}${formatMetricValue(metric, metric.deltaValue)}`;
}

function roundDisplayValue(value: number) {
  return Math.round(value * 10) / 10;
}

const chartTickStyle = {
  fill: "var(--ui-ink-faint)",
  fontSize: 11
};

const chartAxisLineStyle = { stroke: "var(--ui-border-subtle)" };
const chartGridStroke = "var(--ui-border-subtle)";
const chartCursorStyle = {
  stroke: "var(--ui-border-strong)",
  strokeWidth: 1
};

function metricPeriodValue(
  day: DailyMetricDayRecord,
  aggregation: DailyMetricRecord["aggregation"]
) {
  return metricPrimaryValue(day, aggregation);
}

function metricPeriodStats(metric: DailyMetricRecord) {
  const values = metric.days
    .map((day) => metricPeriodValue(day, metric.aggregation))
    .filter((value): value is number => value != null);

  if (values.length === 0) {
    return {
      minimum: null,
      average: null,
      maximum: null,
      count: 0
    };
  }

  return {
    minimum: Math.min(...values),
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    maximum: Math.max(...values),
    count: values.length
  };
}

function formatAxisDate(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function MetricTooltip({
  active,
  payload,
  label,
  metric
}: {
  active?: boolean;
  payload?: Array<{ value?: number | null }>;
  label?: string;
  metric: DailyMetricRecord;
}) {
  if (!active || !payload?.length || typeof label !== "string") {
    return null;
  }
  const value =
    payload.find((entry) => typeof entry.value === "number")?.value ?? null;
  return (
    <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--surface-glass)] px-3 py-2 text-[var(--ui-ink-medium)] shadow-[var(--ui-shadow-floating)] backdrop-blur-xl">
      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
        {formatAxisDate(label)}
      </div>
      <div className="mt-1 text-sm font-semibold text-[var(--ui-ink-strong)]">
        {formatMetricValue(metric, value)}
      </div>
    </div>
  );
}

function MetricTimeSeriesChart({
  metric,
  height = 180,
  detailed = false
}: {
  metric: DailyMetricRecord;
  height?: number;
  detailed?: boolean;
}) {
  const stats = useMemo(() => metricPeriodStats(metric), [metric]);
  const data = useMemo(
    () =>
      metric.days.map((day) => ({
        dateKey: day.dateKey,
        value: metricPeriodValue(day, metric.aggregation),
        sampleCount: day.sampleCount
      })),
    [metric]
  );
  const values = data
    .map((day) => day.value)
    .filter((value): value is number => value != null);
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 1;
  const domainPadding = Math.max(
    (max - min) * 0.12,
    metric.unit === "%" ? 2 : 1
  );
  const tone = metricTone(metric.category);
  const gradientId = `metric-gradient-${metric.metric.replace(/[^a-z0-9]/gi, "-")}`;

  if (values.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-[22px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-center text-sm text-[var(--ui-ink-faint)]"
        style={{ height }}
      >
        Waiting for chart data
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[22px] border bg-[var(--ui-surface-1)] p-3",
        tone.ring
      )}
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{
            top: detailed ? 18 : 8,
            right: detailed ? 18 : 4,
            bottom: detailed ? 12 : 0,
            left: detailed ? 8 : 0
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--primary)"
                stopOpacity={0.55}
              />
              <stop
                offset="56%"
                stopColor="var(--warning)"
                stopOpacity={0.22}
              />
              <stop
                offset="100%"
                stopColor="var(--warning)"
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={chartGridStroke} vertical={detailed} />
          <XAxis
            dataKey="dateKey"
            tickFormatter={formatAxisDate}
            minTickGap={detailed ? 22 : 34}
            tick={chartTickStyle}
            axisLine={chartAxisLineStyle}
            tickLine={false}
          />
          <YAxis
            width={detailed ? 62 : 36}
            domain={[Math.max(0, min - domainPadding), max + domainPadding]}
            tickFormatter={(value) =>
              formatMetricValue(metric, Number(value)).replace(
                ` ${metric.unit}`,
                ""
              )
            }
            tick={chartTickStyle}
            axisLine={false}
            tickLine={false}
          />
          {stats.average != null ? (
            <ReferenceLine
              y={roundDisplayValue(stats.average)}
              stroke="var(--ui-ink-faint)"
              strokeDasharray="5 5"
              ifOverflow="extendDomain"
            />
          ) : null}
          <Tooltip
            cursor={chartCursorStyle}
            content={<MetricTooltip metric={metric} />}
          />
          {metric.aggregation === "cumulative" ? (
            <Bar
              dataKey="value"
              radius={[8, 8, 2, 2]}
              fill={`url(#${gradientId})`}
              maxBarSize={detailed ? 34 : 20}
            />
          ) : (
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--primary)"
              strokeWidth={detailed ? 3 : 2}
              fill={`url(#${gradientId})`}
              dot={detailed ? { r: 3, fill: "var(--warning)" } : false}
              activeDot={{ r: 5, fill: "var(--warning)" }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricFullscreenDialog({
  metric,
  open,
  onOpenChange
}: {
  metric: DailyMetricRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const stats = metricPeriodStats(metric);
  const tone = metricTone(metric.category);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-xl" />
        <Dialog.Content className="fixed inset-3 z-[51] grid min-h-0 overflow-hidden rounded-[32px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-modal)] shadow-[var(--ui-shadow-floating)] sm:inset-5">
          <Dialog.Title className="sr-only">{metric.label} chart</Dialog.Title>
          <Dialog.Description className="sr-only">
            Full-screen time-series chart for the selected daily metric.
          </Dialog.Description>
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--ui-border-subtle)] px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  {metric.category} time series
                </div>
                <div className="mt-1 break-words text-2xl font-semibold text-[var(--ui-ink-strong)] sm:text-3xl">
                  {metric.label}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--ui-ink-soft)]">
                  <Badge className={tone.badge}>{metric.aggregation}</Badge>
                  <Badge tone="meta">{metric.coverageDays} tracked days</Badge>
                  <Badge tone="meta">
                    latest {formatDateKey(metric.latestDateKey)}
                  </Badge>
                </div>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="inline-flex size-11 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                  aria-label="Close metric chart"
                >
                  <X className="size-5" />
                </button>
              </Dialog.Close>
            </div>

            <div className="grid min-h-0 gap-4 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <MetricTimeSeriesChart metric={metric} height={560} detailed />
              <div className="grid content-start gap-3">
                {[
                  ["Latest", metric.latestValue],
                  ["Period min", stats.minimum],
                  ["Period average", stats.average],
                  ["Period max", stats.maximum],
                  ["Baseline", metric.baselineValue],
                  ["Delta", metric.deltaValue]
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3"
                  >
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      {label}
                    </div>
                    <div className="mt-1 break-words text-xl font-semibold text-[var(--ui-ink-strong)]">
                      {formatMetricValue(
                        metric,
                        typeof value === "number" ? value : null
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function metricTrendDirection(metric: DailyMetricRecord) {
  if (metric.deltaValue == null || metric.deltaValue === 0) {
    return "steady";
  }
  return metric.deltaValue > 0 ? "up" : "down";
}

export function metricTone(category: string) {
  switch (category) {
    case "recovery":
      return {
        ring: "border-[var(--danger)]/20",
        badge: "bg-[var(--ui-danger-soft)] text-[var(--danger)]",
        glow: "from-[var(--ui-danger-soft)] via-[var(--ui-surface-2)] to-transparent"
      };
    case "cardio":
      return {
        ring: "border-[var(--info)]/24",
        badge: "bg-[var(--ui-info-soft)] text-[var(--info)]",
        glow: "from-[var(--ui-info-soft)] via-[var(--ui-surface-2)] to-transparent"
      };
    case "breathing":
      return {
        ring: "border-[var(--success)]/22",
        badge: "bg-[var(--ui-success-soft)] text-[var(--success)]",
        glow: "from-[var(--ui-success-soft)] via-[var(--ui-surface-2)] to-transparent"
      };
    case "composition":
      return {
        ring: "border-[var(--warning)]/22",
        badge: "bg-[var(--ui-warning-soft)] text-[var(--warning)]",
        glow: "from-[var(--ui-warning-soft)] via-[var(--ui-surface-2)] to-transparent"
      };
    case "temperature":
      return {
        ring: "border-[var(--warning)]/22",
        badge: "bg-[var(--ui-warning-soft)] text-[var(--warning)]",
        glow: "from-[var(--ui-warning-soft)] via-[var(--ui-surface-2)] to-transparent"
      };
    case "conversationTone":
      return {
        ring: "border-[var(--warning)]/22",
        badge: "bg-[var(--ui-warning-soft)] text-[var(--warning)]",
        glow: "from-[var(--ui-warning-soft)] via-[var(--ui-surface-2)] to-transparent"
      };
    default:
      return {
        ring: "border-[var(--ui-border-subtle)]",
        badge: "bg-[var(--ui-accent-soft)] text-[var(--primary)]",
        glow: "from-[var(--ui-accent-soft)] via-[var(--ui-surface-2)] to-transparent"
      };
  }
}

export function metricIcon(
  metric: string
): ComponentType<{ className?: string }> {
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
    case "swearingMessagePercent":
      return Percent;
    case "devrageSwearCount":
    case "devrageAverageMaxCumulativeRage":
    case "devrageMaxCumulativeRage":
      return MessageCircleWarning;
    default:
      return Activity;
  }
}

export function Sparkbar({
  metric,
  className
}: {
  metric: DailyMetricRecord;
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
          "flex h-16 items-center justify-center rounded-[18px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2 text-center text-xs text-[var(--ui-ink-faint)]",
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
        "flex h-16 items-end gap-1 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2",
        className
      )}
    >
      {recent.map((day, index) => {
        const value = metricPrimaryValue(day, metric.aggregation);
        const height =
          value == null ? 12 : 18 + Math.round(((value - min) / range) * 34);
        const isLatest = index === recent.length - 1;
        return (
          <div
            key={`${metric.metric}-${day.dateKey}`}
            className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
          >
            <div
              className={cn(
                "w-full rounded-full bg-gradient-to-t from-[var(--ui-ink-faint)] to-[var(--ui-ink-soft)] opacity-80 transition",
                isLatest && "from-[var(--primary)] to-[var(--info)] opacity-100"
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

export function SpotlightCard({
  title,
  description,
  metric,
  emptyDescription
}: {
  title: string;
  description: string;
  metric: DailyMetricRecord | null;
  emptyDescription?: string;
}) {
  const Icon = metric ? metricIcon(metric.metric) : Activity;
  const tone = metric ? metricTone(metric.category) : metricTone("default");
  const trend = metric ? metricTrendDirection(metric) : "steady";

  return (
    <Card
      className={cn(
        "relative overflow-hidden rounded-[28px] border bg-[var(--ui-surface-section)] p-5 shadow-[var(--card-shadow)]",
        tone.ring
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90",
          tone.glow
        )}
      />
      <div className="relative grid gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              {title}
            </div>
            <div className="break-words text-sm leading-6 text-[var(--ui-ink-soft)]">
              {description}
            </div>
          </div>
          <div className="shrink-0 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-[var(--ui-ink-medium)]">
            <Icon className="size-5" />
          </div>
        </div>
        <div className="grid gap-2">
          <div className="break-words text-xl font-semibold text-[var(--ui-ink-strong)]">
            {metric
              ? formatMetricValue(metric, metric.latestValue)
              : "No signal yet"}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-[var(--ui-ink-soft)]">
            {metric ? (
              <Badge className={tone.badge}>{metric.label}</Badge>
            ) : null}
            {metric ? (
              <Badge
                className={cn(
                  "border-none",
                  trend === "up"
                    ? "bg-[var(--ui-success-soft)] text-[var(--success)]"
                    : trend === "down"
                      ? "bg-[var(--ui-danger-soft)] text-[var(--danger)]"
                      : "bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                )}
              >
                {formatDelta(metric)}
              </Badge>
            ) : null}
            {metric ? (
              <Badge tone="meta">{metric.coverageDays} days tracked</Badge>
            ) : null}
          </div>
          <div className="break-words text-xs text-[var(--ui-ink-faint)]">
            {metric
              ? `Latest reading on ${formatDateKey(metric.latestDateKey)}`
              : (emptyDescription ??
                "Forge will populate this card as soon as daily readings are available.")}
          </div>
        </div>
      </div>
    </Card>
  );
}

function MetricDetailCard({ metric }: { metric: DailyMetricRecord }) {
  const [chartOpen, setChartOpen] = useState(false);
  const Icon = metricIcon(metric.metric);
  const tone = metricTone(metric.category);
  const latestDay = metric.days.at(-1);
  const stats = metricPeriodStats(metric);

  return (
    <Card
      className={cn(
        "overflow-hidden rounded-[28px] border bg-[var(--ui-surface-section)] p-5",
        tone.ring
      )}
    >
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="shrink-0 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-[var(--ui-ink-medium)]">
            <Icon className="size-5" />
          </div>
          <div className="grid min-w-0 gap-1">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              {metric.category}
            </div>
            <div className="break-words text-xl font-semibold text-[var(--ui-ink-strong)]">
              {metric.label}
            </div>
            <div className="text-sm text-[var(--ui-ink-soft)]">
              {metric.coverageDays} tracked day
              {metric.coverageDays === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          <Badge className={tone.badge}>{metric.aggregation}</Badge>
          <button
            type="button"
            className="inline-flex min-h-9 min-w-0 max-w-full items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
            onClick={() => setChartOpen(true)}
          >
            <Maximize2 className="size-3.5" />
            Full screen
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,0.95fr)_minmax(220px,1.05fr)]">
        <div className="grid gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              Latest
            </div>
            <div className="mt-1 break-words text-3xl font-semibold text-[var(--ui-ink-strong)]">
              {formatMetricValue(metric, metric.latestValue)}
            </div>
            <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
              {metric.latestDateKey
                ? `Latest reading on ${formatDateKey(metric.latestDateKey)}`
                : "Waiting for the first successful reading"}
            </div>
          </div>
          <div className="grid gap-2 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm text-[var(--ui-ink-medium)]">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0">Baseline</span>
              <span className="min-w-0 break-words text-right font-medium text-[var(--ui-ink-strong)]">
                {formatMetricValue(metric, metric.baselineValue)}
              </span>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0">Delta</span>
              <span
                className={cn(
                  "min-w-0 break-words text-right font-medium",
                  metric.deltaValue == null
                    ? "text-[var(--ui-ink-soft)]"
                    : metric.deltaValue > 0
                      ? "text-[var(--success)]"
                      : metric.deltaValue < 0
                        ? "text-[var(--danger)]"
                        : "text-[var(--ui-ink-strong)]"
                )}
              >
                {formatDelta(metric)}
              </span>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0">Latest samples</span>
              <span className="min-w-0 break-words text-right font-medium text-[var(--ui-ink-strong)]">
                {latestDay?.sampleCount ?? 0}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          <MetricTimeSeriesChart metric={metric} />
          <div className="grid gap-2 text-xs text-[var(--ui-ink-faint)] sm:grid-cols-3">
            <div className="min-w-0 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2">
              <div>Period min</div>
              <div className="mt-1 break-words font-medium text-[var(--ui-ink-medium)]">
                {formatMetricValue(metric, stats.minimum)}
              </div>
            </div>
            <div className="min-w-0 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2">
              <div>Period avg</div>
              <div className="mt-1 break-words font-medium text-[var(--ui-ink-medium)]">
                {formatMetricValue(metric, stats.average)}
              </div>
            </div>
            <div className="min-w-0 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2">
              <div>Period max</div>
              <div className="mt-1 break-words font-medium text-[var(--ui-ink-medium)]">
                {formatMetricValue(metric, stats.maximum)}
              </div>
            </div>
          </div>
        </div>
      </div>
      <MetricFullscreenDialog
        metric={metric}
        open={chartOpen}
        onOpenChange={setChartOpen}
      />
    </Card>
  );
}

export function MetricDetailSections({
  groups
}: {
  groups: DailyMetricCategoryGroup[];
}) {
  return (
    <section className="grid gap-5">
      {groups.map((group) => (
        <div key={group.category} className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                {group.category}
              </div>
              <div className="mt-1 break-words text-2xl font-semibold text-[var(--ui-ink-strong)]">
                {group.metrics.length} signals in this lane
              </div>
            </div>
            <Badge className={metricTone(group.category).badge}>
              {group.coverageDays} days of coverage
            </Badge>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {group.metrics.map((metric) => (
              <MetricDetailCard key={metric.metric} metric={metric} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
