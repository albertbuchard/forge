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

export function formatMetricValue(metric: DailyMetricRecord, value: number | null) {
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
  const value = payload.find((entry) => typeof entry.value === "number")?.value ?? null;
  return (
    <div className="rounded-[18px] border border-white/10 bg-[rgba(9,13,24,0.94)] px-3 py-2 shadow-[0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur-xl">
      <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
        {formatAxisDate(label)}
      </div>
      <div className="mt-1 text-sm font-semibold text-white">
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
  const domainPadding = Math.max((max - min) * 0.12, metric.unit === "%" ? 2 : 1);
  const tone = metricTone(metric.category);
  const gradientId = `metric-gradient-${metric.metric.replace(/[^a-z0-9]/gi, "-")}`;

  if (values.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-[22px] border border-dashed border-white/8 bg-white/[0.025] text-sm text-white/40"
        style={{ height }}
      >
        Waiting for chart data
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[22px] border bg-[radial-gradient(circle_at_top_left,rgba(171,232,255,0.08),transparent_34%),rgba(255,255,255,0.025)] p-3",
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
              <stop offset="0%" stopColor="rgba(171,232,255,0.55)" />
              <stop offset="56%" stopColor="rgba(251,191,36,0.22)" />
              <stop offset="100%" stopColor="rgba(251,191,36,0.02)" />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="rgba(255,255,255,0.07)"
            vertical={detailed}
          />
          <XAxis
            dataKey="dateKey"
            tickFormatter={formatAxisDate}
            minTickGap={detailed ? 22 : 34}
            tick={{ fill: "rgba(255,255,255,0.46)", fontSize: 11 }}
            axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
            tickLine={false}
          />
          <YAxis
            width={detailed ? 62 : 36}
            domain={[Math.max(0, min - domainPadding), max + domainPadding]}
            tickFormatter={(value) =>
              formatMetricValue(metric, Number(value)).replace(` ${metric.unit}`, "")
            }
            tick={{ fill: "rgba(255,255,255,0.46)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          {stats.average != null ? (
            <ReferenceLine
              y={roundDisplayValue(stats.average)}
              stroke="rgba(255,255,255,0.34)"
              strokeDasharray="5 5"
              ifOverflow="extendDomain"
            />
          ) : null}
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.22)", strokeWidth: 1 }}
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
              stroke="rgba(171,232,255,0.92)"
              strokeWidth={detailed ? 3 : 2}
              fill={`url(#${gradientId})`}
              dot={detailed ? { r: 3, fill: "rgba(251,191,36,0.9)" } : false}
              activeDot={{ r: 5, fill: "rgba(251,191,36,0.95)" }}
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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.82)] backdrop-blur-xl" />
        <Dialog.Content className="fixed inset-3 z-[51] grid min-h-0 overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(171,232,255,0.12),transparent_34%),linear-gradient(180deg,rgba(12,18,32,0.98),rgba(7,10,20,0.99))] shadow-[0_34px_110px_rgba(0,0,0,0.58)] sm:inset-5">
          <Dialog.Title className="sr-only">{metric.label} chart</Dialog.Title>
          <Dialog.Description className="sr-only">
            Full-screen time-series chart for the selected daily metric.
          </Dialog.Description>
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/8 px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                  {metric.category} time series
                </div>
                <div className="mt-1 text-2xl font-semibold text-white sm:text-3xl">
                  {metric.label}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/54">
                  <Badge className={tone.badge}>{metric.aggregation}</Badge>
                  <Badge tone="meta">{metric.coverageDays} tracked days</Badge>
                  <Badge tone="meta">latest {formatDateKey(metric.latestDateKey)}</Badge>
                </div>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="inline-flex size-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/72 transition hover:bg-white/[0.1] hover:text-white"
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
                    className="rounded-[22px] border border-white/8 bg-white/[0.035] px-4 py-3"
                  >
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                      {label}
                    </div>
                    <div className="mt-1 text-xl font-semibold text-white">
                      {formatMetricValue(metric, typeof value === "number" ? value : null)}
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
    case "conversationTone":
      return {
        ring: "border-[rgba(251,191,36,0.2)]",
        badge: "bg-[rgba(251,191,36,0.16)] text-[rgb(255,232,166)]",
        glow: "from-[rgba(251,191,36,0.18)] via-[rgba(244,114,182,0.08)] to-transparent"
      };
    default:
      return {
        ring: "border-[rgba(163,174,208,0.16)]",
        badge: "bg-[rgba(163,174,208,0.14)] text-[rgb(220,228,255)]",
        glow: "from-[rgba(163,174,208,0.14)] via-[rgba(112,120,167,0.06)] to-transparent"
      };
  }
}

export function metricIcon(metric: string): ComponentType<{ className?: string }> {
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
              : emptyDescription ?? "Forge will populate this card as soon as daily readings are available."}
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
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Badge className={tone.badge}>{metric.aggregation}</Badge>
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 py-1.5 text-xs font-medium text-white/72 transition hover:bg-white/[0.09] hover:text-white"
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
          <MetricTimeSeriesChart metric={metric} />
          <div className="grid grid-cols-3 gap-2 text-xs text-white/48">
            <div className="rounded-[16px] border border-white/8 bg-white/[0.025] px-3 py-2">
              <div>Period min</div>
              <div className="mt-1 font-medium text-white/78">
                {formatMetricValue(metric, stats.minimum)}
              </div>
            </div>
            <div className="rounded-[16px] border border-white/8 bg-white/[0.025] px-3 py-2">
              <div>Period avg</div>
              <div className="mt-1 font-medium text-white/78">
                {formatMetricValue(metric, stats.average)}
              </div>
            </div>
            <div className="rounded-[16px] border border-white/8 bg-white/[0.025] px-3 py-2">
              <div>Period max</div>
              <div className="mt-1 font-medium text-white/78">
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

export function MetricDetailSections({ groups }: { groups: DailyMetricCategoryGroup[] }) {
  return (
    <section className="grid gap-5">
      {groups.map((group) => (
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
            {group.metrics.map((metric) => (
              <MetricDetailCard key={metric.metric} metric={metric} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
