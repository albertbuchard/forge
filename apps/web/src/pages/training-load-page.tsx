import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  Activity,
  AlertTriangle,
  Gauge,
  HeartPulse,
  RadioTower,
  Target
} from "lucide-react";
import { ChartBox } from "@/components/training-load/chart-box";
import { ZoneIntelligencePanel } from "@/components/training-load/zone-intelligence-panel";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { ErrorState } from "@/components/ui/page-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { getTrainingLoadView } from "@/lib/api";
import type { TrainingLoadViewData } from "@/lib/types";

const INTENSITY_COLORS: Record<string, string> = {
  low: "var(--success)",
  moderate: "var(--warning)",
  high: "var(--danger)"
};

const ZONE_COLORS: Record<string, string> = {
  below_z1: "var(--ui-ink-muted)",
  zone_1: "var(--info)",
  zone_2: "var(--success)",
  zone_3: "var(--warning)",
  zone_4: "var(--tertiary)",
  zone_5: "var(--danger)"
};

const TRAINING_LOAD_HELP = {
  hero: "Forge estimates cardiovascular training stress from stored workouts, heart-rate samples, adaptive heart-rate-reserve zones, and recent vitals. Use this page to decide whether the next training block should build aerobic base, hold load steady, sharpen intensity, or recover. The numbers support coaching decisions; they are not medical diagnosis.",
  acuteLoad:
    "Acute load is the last seven days of Forge's TRIMP-like internal load. It rises when workouts are longer, harder, or spend more time in high heart-rate zones. Compare it with chronic load before adding hard sessions.",
  chronicBase:
    "Chronic base is the average weekly load over the last 28 days. It is Forge's estimate of the current load you have recently proven you can absorb.",
  acwr: "ACWR is acute load divided by chronic weekly load. Values near 1.0 usually mean the current week resembles the recent base. High values ask for recovery checks; low values suggest underloading. Treat it as a flag, not a verdict.",
  vo2max:
    "VO2max is the latest available wearable estimate in ml/kg/min. Forge shows the recent change when enough points exist, but wearable VO2max can move with device model, terrain, heat, and workout type.",
  weeklyMap:
    "This chart combines weekly internal load, training hours, and the share of time in zones 4 and 5. It helps reveal whether fatigue comes from total volume, hard intensity, or both.",
  adaptationRadar:
    "The radar compresses six signals into one coach view: current load, base capacity, acute/chronic balance, heart-rate data quality, high-intensity pressure, and VO2max movement.",
  intensityTarget:
    "This compares your recent or all-time low, moderate, and high intensity distribution with broad target bands used in endurance and combat-sport conditioning. The target is a planning reference, not a rule.",
  hrZones:
    "These bars show minutes in each adaptive HRR zone. Zone 2 is commonly used for aerobic base, zones 4 and 5 for threshold and VO2max work, and below-zone time often reflects warm-up, recovery, or missing cardiovascular load.",
  dailyTexture:
    "Daily texture shows whether load spikes are coming from easy volume, threshold work, or high-intensity minutes. It is useful for spacing hard days and avoiding accidental clusters.",
  sessionSignals:
    "Recent workout rows expose the session evidence behind the summary: date, activity, training load, high-zone share, heart-rate response, and data confidence.",
  sportContribution:
    "Sport contribution groups load by workout type. In kickboxing and other combat sports, wrist heart rate can undercount short striking spikes, so compare this with how the session actually felt."
};

type TimeWindow = "recent" | "all";

function pct(value: number | null | undefined, digits = 0) {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

function numberLabel(value: number | null | undefined, digits = 0) {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return value.toFixed(digits);
}

function readinessCopy(
  readiness: TrainingLoadViewData["summary"]["readiness"]
) {
  switch (readiness) {
    case "productive":
      return {
        label: "Productive",
        tone: "signal" as const,
        text: "Acute load is close to the current chronic base."
      };
    case "underloaded":
      return {
        label: "Underloaded",
        tone: "meta" as const,
        text: "The recent week is below the four-week baseline."
      };
    case "overload_watch":
      return {
        label: "Watch load",
        tone: "default" as const,
        text: "Acute load or strain is elevated enough to deserve recovery checks."
      };
    default:
      return {
        label: "Building signal",
        tone: "meta" as const,
        text: "Forge needs more recent training evidence for a cleaner read."
      };
  }
}

function metricTile({
  label,
  value,
  detail,
  help,
  icon: Icon
}: {
  label: string;
  value: string;
  detail: string;
  help: string;
  icon: typeof Gauge;
}) {
  return (
    <Card className="relative min-h-[168px] overflow-hidden p-3 sm:min-h-[136px] sm:p-4">
      <div className="absolute right-3 top-3 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-1.5 text-[var(--ui-ink-muted)] sm:p-2">
        <Icon className="size-4" />
      </div>
      <div className="flex max-w-[calc(100%-2.25rem)] items-center gap-1.5">
        <div className="font-label text-[9px] uppercase tracking-[0.14em] text-[var(--ui-ink-muted)] sm:text-[10px] sm:tracking-[0.18em]">
          {label}
        </div>
        <InfoTooltip label={`Explain ${label}`} title={label} content={help} />
      </div>
      <div className="mt-3 font-display text-3xl leading-none text-[var(--ui-ink-strong)] sm:mt-4 sm:text-4xl">
        {value}
      </div>
      <div className="mt-2 max-w-[24rem] text-[11px] leading-4 text-[var(--ui-ink-muted)] sm:mt-3 sm:text-[12px] sm:leading-5">
        {detail}
      </div>
    </Card>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  help,
  action
}: {
  eyebrow: string;
  title: string;
  description?: string;
  help: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="font-label text-[10px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
            {eyebrow}
          </div>
          <InfoTooltip
            label={`Explain ${eyebrow}`}
            title={title}
            content={help}
          />
        </div>
        <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">{title}</div>
        {description ? (
          <div className="mt-1 max-w-2xl text-[12px] leading-5 text-[var(--ui-ink-muted)]">
            {description}
          </div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function buildWeeklyChartData(trainingLoad: TrainingLoadViewData) {
  return trainingLoad.weeklyLoad.map((week) => ({
    week: week.weekKey.replace(/^20/, "'"),
    load: week.trainingLoad,
    hours: week.durationHours,
    loadPerHour: week.loadPerHour,
    high: Math.round(week.highPercentage * 100),
    moderate: Math.round(week.moderatePercentage * 100),
    low: Math.round(week.lowPercentage * 100)
  }));
}

function buildDailyChartData(trainingLoad: TrainingLoadViewData) {
  return trainingLoad.dailyLoad.map((day) => ({
    date: day.dateKey.slice(5),
    load: day.trainingLoad,
    high: day.highIntensityMinutes,
    moderate: day.moderateIntensityMinutes,
    low: day.lowIntensityMinutes
  }));
}

function distributionChartData(
  trainingLoad: TrainingLoadViewData,
  timeWindow: TimeWindow
) {
  const distribution =
    timeWindow === "recent"
      ? trainingLoad.recentIntensityDistribution
      : trainingLoad.intensityDistribution;
  return distribution.map((entry) => ({
    ...entry,
    percent: Math.round(entry.percentage * 100),
    targetLow: Math.round(entry.targetRange[0] * 100),
    targetHigh: Math.round(entry.targetRange[1] * 100),
    fill: INTENSITY_COLORS[entry.key] ?? "var(--ui-ink-medium)"
  }));
}

function zoneChartData(
  trainingLoad: TrainingLoadViewData,
  timeWindow: TimeWindow
) {
  const zones =
    timeWindow === "recent"
      ? trainingLoad.recentZoneTotals
      : trainingLoad.zoneTotals;
  return zones.map((zone) => ({
    ...zone,
    minutes: Math.round(zone.seconds / 60),
    percent: Math.round(zone.percentage * 100),
    fill: ZONE_COLORS[zone.key] ?? "var(--ui-ink-medium)"
  }));
}

function buildRadarData(trainingLoad: TrainingLoadViewData) {
  const summary = trainingLoad.summary;
  const acwrScore =
    summary.acuteChronicRatio == null
      ? 45
      : Math.max(
          0,
          Math.min(100, 100 - Math.abs(summary.acuteChronicRatio - 1) * 80)
        );
  return [
    { axis: "Load", value: Math.min(100, summary.acuteLoad7d / 3) },
    { axis: "Base", value: Math.min(100, summary.chronicWeeklyLoad28d / 3) },
    { axis: "Balance", value: acwrScore },
    {
      axis: "Quality",
      value: Math.min(100, summary.averageHeartRateCoverage * 100)
    },
    {
      axis: "High",
      value: Math.min(100, summary.highIntensityMinutes7d * 1.8)
    },
    {
      axis: "VO2",
      value:
        summary.vo2MaxDelta == null
          ? 50
          : Math.max(0, Math.min(100, 50 + summary.vo2MaxDelta * 10))
    }
  ];
}

function SessionSignalTable({
  sessions
}: {
  sessions: TrainingLoadViewData["sessionSignals"];
}) {
  return (
    <>
      <div className="grid gap-3 md:hidden">
        {sessions.slice(0, 20).map((session) => (
          <div
            key={session.id}
            className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[var(--ui-ink-medium)]">
                  {session.workoutTypeLabel}
                </div>
                <div className="mt-1 text-[11px] text-[var(--ui-ink-muted)]">
                  {session.dateKey.slice(5)} ·{" "}
                  {numberLabel(session.durationMinutes, 0)}m ·{" "}
                  {session.confidence}
                </div>
              </div>
              <Badge tone="meta">
                {numberLabel(session.trainingLoad, 0)} load
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] text-[var(--ui-ink-medium)]">
              <div className="rounded-[8px] bg-[var(--ui-surface-2)] px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                  Z4+Z5
                </div>
                <div className="mt-0.5 text-[var(--ui-ink-strong)]">
                  {pct(session.highIntensityPercentage)}
                </div>
              </div>
              <div className="rounded-[8px] bg-[var(--ui-surface-2)] px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                  HR
                </div>
                <div className="mt-0.5 text-[var(--ui-ink-strong)]">
                  {session.averageHr ? Math.round(session.averageHr) : "n/a"}
                  {session.maxHr ? `/${Math.round(session.maxHr)}` : ""}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-[8px] border border-[var(--ui-border-subtle)] md:block">
        <div className="grid grid-cols-[88px_minmax(118px,1fr)_64px_72px_72px] bg-[var(--ui-surface-2)] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
          <div>Date</div>
          <div>Session</div>
          <div>Load</div>
          <div>Z4+Z5</div>
          <div>HR</div>
        </div>
        <div className="max-h-[370px] overflow-auto">
          {sessions.slice(0, 20).map((session) => (
            <div
              key={session.id}
              className="grid grid-cols-[88px_minmax(118px,1fr)_64px_72px_72px] border-t border-[var(--ui-border-subtle)] px-3 py-2 text-[12px] text-[var(--ui-ink-medium)]"
            >
              <div className="text-[var(--ui-ink-strong)]/52">
                {session.dateKey.slice(5)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[var(--ui-ink-medium)]">
                  {session.workoutTypeLabel}
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--ui-ink-muted)]">
                  {numberLabel(session.durationMinutes, 0)}m ·{" "}
                  {session.confidence}
                </div>
              </div>
              <div className="text-[var(--ui-ink-strong)]">
                {numberLabel(session.trainingLoad, 0)}
              </div>
              <div>{pct(session.highIntensityPercentage)}</div>
              <div>
                {session.averageHr ? Math.round(session.averageHr) : "n/a"}
                {session.maxHr ? `/${Math.round(session.maxHr)}` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function TrainingLoadPage() {
  const shell = useForgeShell();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("recent");

  const trainingLoadQuery = useQuery({
    queryKey: ["forge-training-load", ...selectedUserIds],
    queryFn: async () =>
      (await getTrainingLoadView(selectedUserIds)).trainingLoad
  });

  const trainingLoad = trainingLoadQuery.data;
  const readiness = readinessCopy(
    trainingLoad?.summary.readiness ?? "insufficient_data"
  );
  const weeklyChartData = useMemo(
    () => (trainingLoad ? buildWeeklyChartData(trainingLoad) : []),
    [trainingLoad]
  );
  const dailyChartData = useMemo(
    () => (trainingLoad ? buildDailyChartData(trainingLoad) : []),
    [trainingLoad]
  );
  const intensityData = useMemo(
    () => (trainingLoad ? distributionChartData(trainingLoad, timeWindow) : []),
    [timeWindow, trainingLoad]
  );
  const zoneData = useMemo(
    () => (trainingLoad ? zoneChartData(trainingLoad, timeWindow) : []),
    [timeWindow, trainingLoad]
  );
  const radarData = useMemo(
    () => (trainingLoad ? buildRadarData(trainingLoad) : []),
    [trainingLoad]
  );

  if (trainingLoadQuery.isLoading) {
    return (
      <SurfaceSkeleton
        eyebrow="Training Load"
        title="Loading cardiovascular model"
        description="Computing acute load, zone distribution, and target bands from workout evidence."
        columns={3}
        blocks={8}
      />
    );
  }

  if (trainingLoadQuery.isError || !trainingLoad) {
    return (
      <ErrorState
        eyebrow="Training Load"
        error={
          trainingLoadQuery.error ?? new Error("Training load data unavailable")
        }
        onRetry={() => void trainingLoadQuery.refetch()}
      />
    );
  }

  const { summary } = trainingLoad;

  return (
    <div className="grid gap-5">
      <PageHero
        eyebrow="Health"
        entityKind="habit"
        title="Training Load"
        titleText="Training Load"
        description="Forge estimates cardiovascular training stress from workout duration, heart-rate response, adaptive HRR zones, and recent vitals so you can plan the next training block with clearer load and recovery context."
        helpContent={TRAINING_LOAD_HELP.hero}
        badge={`${summary.sessionCount} sessions · ${summary.reliableSessionCount} high-resolution`}
        actions={<Badge tone={readiness.tone}>{readiness.label}</Badge>}
      />

      <section
        className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
        data-testid="training-load-summary-grid"
      >
        {metricTile({
          label: "Acute load",
          value: numberLabel(summary.acuteLoad7d, 0),
          detail: `Last 7 days of internal load. ${readiness.text}`,
          help: TRAINING_LOAD_HELP.acuteLoad,
          icon: Gauge
        })}
        {metricTile({
          label: "Chronic base",
          value: numberLabel(summary.chronicWeeklyLoad28d, 0),
          detail: "Average weekly load across the last 28 days.",
          help: TRAINING_LOAD_HELP.chronicBase,
          icon: RadioTower
        })}
        {metricTile({
          label: "ACWR",
          value: numberLabel(summary.acuteChronicRatio, 2),
          detail:
            "Acute load divided by chronic weekly load. Useful as a flag, not a verdict.",
          help: TRAINING_LOAD_HELP.acwr,
          icon: Activity
        })}
        {metricTile({
          label: "VO2 max",
          value: summary.vo2MaxLatest
            ? numberLabel(summary.vo2MaxLatest, 1)
            : "n/a",
          detail:
            summary.vo2MaxDelta == null
              ? "No delta available yet."
              : `${summary.vo2MaxDelta >= 0 ? "+" : ""}${summary.vo2MaxDelta} since the first recent point.`,
          help: TRAINING_LOAD_HELP.vo2max,
          icon: HeartPulse
        })}
      </section>

      <ZoneIntelligencePanel trainingLoad={trainingLoad} />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card className="overflow-hidden">
          <SectionHeading
            eyebrow="Weekly load map"
            title="Load, hours, and high-intensity share over the last 26 weeks."
            description="Load estimates internal stress; hours show volume; the red line shows how much of each week landed in zones 4 and 5."
            help={TRAINING_LOAD_HELP.weeklyMap}
            action={<Badge tone="meta">TRIMP · HRR zones</Badge>}
          />
          <div className="mt-5">
            <ChartBox height={340}>
              {({ width, height }) => (
                <ComposedChart
                  data={weeklyChartData}
                  width={width}
                  height={height}
                >
                  <defs>
                    <linearGradient
                      id="trainingLoadFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--info)"
                        stopOpacity={0.38}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--info)"
                        stopOpacity={0.04}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="var(--ui-border-subtle)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="week"
                    tick={{ fill: "var(--ui-ink-muted)", fontSize: 10 }}
                  />
                  <YAxis
                    yAxisId="load"
                    tick={{ fill: "var(--ui-ink-muted)", fontSize: 10 }}
                    width={42}
                  />
                  <YAxis
                    yAxisId="pct"
                    orientation="right"
                    domain={[0, 100]}
                    tick={{ fill: "var(--ui-ink-muted)", fontSize: 10 }}
                    width={38}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--ui-surface-modal)",
                      border: "1px solid var(--ui-border-subtle)",
                      borderRadius: 8,
                      color: "var(--ui-ink-strong)"
                    }}
                  />
                  <Area
                    yAxisId="load"
                    type="monotone"
                    dataKey="load"
                    name="Training load"
                    stroke="var(--info)"
                    fill="url(#trainingLoadFill)"
                    strokeWidth={2}
                  />
                  <Bar
                    yAxisId="load"
                    dataKey="hours"
                    name="Hours"
                    fill="var(--primary)"
                    radius={[3, 3, 0, 0]}
                  />
                  <Line
                    yAxisId="pct"
                    type="monotone"
                    dataKey="high"
                    name="Z4+Z5 %"
                    stroke="var(--danger)"
                    strokeWidth={2.4}
                    dot={{ r: 2 }}
                  />
                </ComposedChart>
              )}
            </ChartBox>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <SectionHeading
            eyebrow="Adaptation radar"
            title="Current signal balance"
            description="A compact coach view of load, base, balance, data quality, high-intensity pressure, and VO2max movement."
            help={TRAINING_LOAD_HELP.adaptationRadar}
          />
          <div className="mt-4">
            <ChartBox height={300}>
              {({ width, height }) => (
                <RadarChart data={radarData} width={width} height={height}>
                  <PolarGrid stroke="var(--ui-border-subtle)" />
                  <PolarAngleAxis
                    dataKey="axis"
                    tick={{ fill: "var(--ui-ink-muted)", fontSize: 10 }}
                  />
                  <Radar
                    dataKey="value"
                    stroke="var(--success)"
                    fill="var(--success)"
                    fillOpacity={0.24}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--ui-surface-modal)",
                      border: "1px solid var(--ui-border-subtle)",
                      borderRadius: 8,
                      color: "var(--ui-ink-strong)"
                    }}
                  />
                </RadarChart>
              )}
            </ChartBox>
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <SectionHeading
            eyebrow="Intensity target"
            title="Distribution vs target bands"
            description="Compare the selected time window with broad low, moderate, and high intensity bands."
            help={TRAINING_LOAD_HELP.intensityTarget}
            action={
              <div className="grid grid-cols-2 gap-1 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-1">
                {[
                  ["recent", "28d"],
                  ["all", "All"]
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-[6px] px-3 py-1.5 text-[12px] ${
                      timeWindow === value
                        ? "bg-[var(--ui-surface-2)] text-[var(--ui-ink-strong)]"
                        : "text-[var(--ui-ink-muted)]"
                    }`}
                    onClick={() => setTimeWindow(value as TimeWindow)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          />
          <div className="mt-4 grid gap-3">
            {intensityData.map((entry) => (
              <div key={entry.key} className="grid gap-2">
                <div className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="text-[var(--ui-ink-medium)]">
                    {entry.label}
                  </span>
                  <span className="text-[var(--ui-ink-strong)]">
                    {entry.percent}% · target {entry.targetLow}-
                    {entry.targetHigh}%
                  </span>
                </div>
                <div className="relative h-3 overflow-hidden rounded-full bg-[var(--ui-surface-2)]">
                  <div
                    className="absolute inset-y-0 rounded-full bg-[var(--ui-surface-2)]"
                    style={{
                      left: `${entry.targetLow}%`,
                      width: `${Math.max(2, entry.targetHigh - entry.targetLow)}%`
                    }}
                  />
                  <div
                    className="relative h-full rounded-full"
                    style={{
                      width: `${Math.max(1, entry.percent)}%`,
                      background: entry.fill
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-2 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3 text-[12px] leading-5 text-[var(--ui-ink-muted)]">
            {trainingLoad.targetModel.monitoringNotes.map((note) => (
              <div key={note} className="flex gap-2">
                <Target className="mt-0.5 size-3.5 shrink-0 text-[var(--primary)]" />
                <span>{note}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionHeading
            eyebrow="HR zones"
            title={`Detailed zone distribution for ${
              timeWindow === "recent"
                ? "the last 28 days"
                : "all available sessions"
            }.`}
            help={TRAINING_LOAD_HELP.hrZones}
          />
          <div className="mt-4">
            <ChartBox height={290}>
              {({ width, height }) => (
                <BarChart data={zoneData} width={width} height={height}>
                  <CartesianGrid
                    stroke="var(--ui-border-subtle)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    interval={0}
                    tick={{ fill: "var(--ui-ink-muted)", fontSize: 10 }}
                  />
                  <YAxis
                    tick={{ fill: "var(--ui-ink-muted)", fontSize: 10 }}
                    width={38}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      name === "minutes" ? `${value} min` : `${value}%`,
                      name
                    ]}
                    contentStyle={{
                      background: "var(--ui-surface-modal)",
                      border: "1px solid var(--ui-border-subtle)",
                      borderRadius: 8,
                      color: "var(--ui-ink-strong)"
                    }}
                  />
                  <Bar dataKey="minutes" name="minutes" radius={[4, 4, 0, 0]}>
                    {zoneData.map((entry) => (
                      <Cell key={entry.key} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ChartBox>
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <SectionHeading
            eyebrow="Daily load texture"
            title="Easy, threshold, and high-intensity minutes against daily load."
            help={TRAINING_LOAD_HELP.dailyTexture}
          />
          <div className="mt-4">
            <ChartBox height={310}>
              {({ width, height }) => (
                <ComposedChart
                  data={dailyChartData}
                  width={width}
                  height={height}
                >
                  <CartesianGrid
                    stroke="var(--ui-border-subtle)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "var(--ui-ink-muted)", fontSize: 10 }}
                  />
                  <YAxis
                    yAxisId="minutes"
                    tick={{ fill: "var(--ui-ink-muted)", fontSize: 10 }}
                    width={38}
                  />
                  <YAxis
                    yAxisId="load"
                    orientation="right"
                    tick={{ fill: "var(--ui-ink-muted)", fontSize: 10 }}
                    width={38}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--ui-surface-modal)",
                      border: "1px solid var(--ui-border-subtle)",
                      borderRadius: 8,
                      color: "var(--ui-ink-strong)"
                    }}
                  />
                  <Bar
                    yAxisId="minutes"
                    dataKey="low"
                    stackId="zones"
                    fill="var(--success)"
                    name="low min"
                  />
                  <Bar
                    yAxisId="minutes"
                    dataKey="moderate"
                    stackId="zones"
                    fill="var(--warning)"
                    name="threshold min"
                  />
                  <Bar
                    yAxisId="minutes"
                    dataKey="high"
                    stackId="zones"
                    fill="var(--danger)"
                    name="high min"
                  />
                  <Line
                    yAxisId="load"
                    type="monotone"
                    dataKey="load"
                    stroke="var(--info)"
                    strokeWidth={2.2}
                    dot={false}
                  />
                </ComposedChart>
              )}
            </ChartBox>
          </div>
        </Card>

        <Card>
          <SectionHeading
            eyebrow="Session signals"
            title="Recent workouts"
            help={TRAINING_LOAD_HELP.sessionSignals}
            action={
              <Badge tone="meta">{summary.hardDayCount7d} hard days / 7d</Badge>
            }
          />
          <div className="mt-4">
            <SessionSignalTable sessions={trainingLoad.sessionSignals} />
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <SectionHeading
            eyebrow="Sport contribution"
            title="Load by workout type"
            help={TRAINING_LOAD_HELP.sportContribution}
          />
          <div className="mt-3 grid gap-3">
            {trainingLoad.activityBreakdown.slice(0, 8).map((activity) => (
              <div
                key={activity.workoutType}
                className="grid gap-2 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3 sm:grid-cols-[minmax(0,1fr)_76px_76px_76px]"
              >
                <div>
                  <div className="truncate text-sm text-[var(--ui-ink-strong)]">
                    {activity.workoutTypeLabel}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--ui-ink-muted)]">
                    {activity.sessionCount} sessions ·{" "}
                    {activity.activityFamilyLabel}
                  </div>
                </div>
                <div className="text-[12px] text-[var(--ui-ink-medium)]">
                  <span className="block text-[var(--ui-ink-strong)]">
                    {activity.durationHours}h
                  </span>
                  volume
                </div>
                <div className="text-[12px] text-[var(--ui-ink-medium)]">
                  <span className="block text-[var(--ui-ink-strong)]">
                    {activity.trainingLoad}
                  </span>
                  load
                </div>
                <div className="text-[12px] text-[var(--ui-ink-medium)]">
                  <span className="block text-[var(--ui-ink-strong)]">
                    {pct(activity.highPercentage)}
                  </span>
                  high
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]" />
            <div className="font-label text-[10px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
              Interpretation guardrails
            </div>
          </div>
          <div className="mt-4 grid gap-3 text-[12px] leading-5 text-[var(--ui-ink-muted)]">
            <p>
              Forge is estimating training stress from heart-rate reserve zones
              and a TRIMP-like load. This is good for trend decisions, but it is
              not a substitute for lactate testing, gas exchange thresholds, or
              coach-led periodization.
            </p>
            <p>
              Combat sports add sensor noise: wrist HR can miss short spikes
              during punching and clinch work. Treat high-intensity minutes as
              minimum evidence when the session had a lot of arm motion.
            </p>
            <p>
              The practical target is not maximum Z5. Keep hard combat sessions
              meaningful, then add easy aerobic base when the high-intensity
              share is already high.
            </p>
          </div>
        </Card>
      </section>
    </div>
  );
}
