import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
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
  ResponsiveContainer,
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
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { ErrorState } from "@/components/ui/page-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getTrainingLoadView } from "@/lib/api";
import type { TrainingLoadViewData } from "@/lib/types";

const INTENSITY_COLORS: Record<string, string> = {
  low: "#22c55e",
  moderate: "#f59e0b",
  high: "#ef4444"
};

const ZONE_COLORS: Record<string, string> = {
  below_z1: "#94a3b8",
  zone_1: "#38bdf8",
  zone_2: "#22c55e",
  zone_3: "#eab308",
  zone_4: "#f97316",
  zone_5: "#ef4444"
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

function readinessCopy(readiness: TrainingLoadViewData["summary"]["readiness"]) {
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
  icon: Icon
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Gauge;
}) {
  return (
    <Card className="relative min-h-[136px] overflow-hidden">
      <div className="absolute right-3 top-3 rounded-[8px] border border-white/8 bg-white/[0.045] p-2 text-white/58">
        <Icon className="size-4" />
      </div>
      <div className="max-w-[80%] font-label text-[10px] uppercase tracking-[0.18em] text-white/45">
        {label}
      </div>
      <div className="mt-4 font-display text-4xl leading-none text-white">
        {value}
      </div>
      <div className="mt-3 max-w-[24rem] text-[12px] leading-5 text-white/56">
        {detail}
      </div>
    </Card>
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
    fill: INTENSITY_COLORS[entry.key] ?? "#f8fafc"
  }));
}

function zoneChartData(trainingLoad: TrainingLoadViewData, timeWindow: TimeWindow) {
  const zones =
    timeWindow === "recent" ? trainingLoad.recentZoneTotals : trainingLoad.zoneTotals;
  return zones.map((zone) => ({
    ...zone,
    minutes: Math.round(zone.seconds / 60),
    percent: Math.round(zone.percentage * 100),
    fill: ZONE_COLORS[zone.key] ?? "#f8fafc"
  }));
}

function buildRadarData(trainingLoad: TrainingLoadViewData) {
  const summary = trainingLoad.summary;
  const acwrScore =
    summary.acuteChronicRatio == null
      ? 45
      : Math.max(0, Math.min(100, 100 - Math.abs(summary.acuteChronicRatio - 1) * 80));
  return [
    { axis: "Load", value: Math.min(100, summary.acuteLoad7d / 3) },
    { axis: "Base", value: Math.min(100, summary.chronicWeeklyLoad28d / 3) },
    { axis: "Balance", value: acwrScore },
    { axis: "Quality", value: Math.min(100, summary.averageHeartRateCoverage * 100) },
    { axis: "High", value: Math.min(100, summary.highIntensityMinutes7d * 1.8) },
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
    <div className="overflow-hidden rounded-[8px] border border-white/8">
      <div className="grid grid-cols-[88px_minmax(118px,1fr)_64px_72px_72px] bg-white/[0.045] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-white/42">
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
            className="grid grid-cols-[88px_minmax(118px,1fr)_64px_72px_72px] border-t border-white/6 px-3 py-2 text-[12px] text-white/66"
          >
            <div className="text-white/52">{session.dateKey.slice(5)}</div>
            <div className="min-w-0">
              <div className="truncate text-white/86">{session.workoutTypeLabel}</div>
              <div className="mt-0.5 text-[10px] text-white/42">
                {numberLabel(session.durationMinutes, 0)}m · {session.confidence}
              </div>
            </div>
            <div className="text-white">{numberLabel(session.trainingLoad, 0)}</div>
            <div>{pct(session.highIntensityPercentage)}</div>
            <div>
              {session.averageHr ? Math.round(session.averageHr) : "n/a"}
              {session.maxHr ? `/${Math.round(session.maxHr)}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
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
    queryFn: async () => (await getTrainingLoadView(selectedUserIds)).trainingLoad
  });

  const trainingLoad = trainingLoadQuery.data;
  const readiness = readinessCopy(trainingLoad?.summary.readiness ?? "insufficient_data");
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
          trainingLoadQuery.error ??
          new Error("Training load data unavailable")
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
        description="Cardiovascular stress, HR zone distribution, and elite-style targets from your stored workout evidence."
        badge={`${summary.sessionCount} sessions · ${summary.reliableSessionCount} high-resolution`}
        actions={<Badge tone={readiness.tone}>{readiness.label}</Badge>}
      />

      <section className="grid gap-4 lg:grid-cols-4">
        {metricTile({
          label: "Acute load",
          value: numberLabel(summary.acuteLoad7d, 0),
          detail: `7-day Forge TRIMP. ${readiness.text}`,
          icon: Gauge
        })}
        {metricTile({
          label: "Chronic base",
          value: numberLabel(summary.chronicWeeklyLoad28d, 0),
          detail: "28-day average weekly load, used as the current base signal.",
          icon: RadioTower
        })}
        {metricTile({
          label: "ACWR",
          value: numberLabel(summary.acuteChronicRatio, 2),
          detail: "Acute load divided by chronic weekly load. Useful as a flag, not a verdict.",
          icon: Activity
        })}
        {metricTile({
          label: "VO2 max",
          value: summary.vo2MaxLatest ? numberLabel(summary.vo2MaxLatest, 1) : "n/a",
          detail:
            summary.vo2MaxDelta == null
              ? "No delta available yet."
              : `${summary.vo2MaxDelta >= 0 ? "+" : ""}${summary.vo2MaxDelta} since the first recent point.`,
          icon: HeartPulse
        })}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/45">
                Weekly load map
              </div>
              <div className="mt-2 text-lg text-white">
                Load, hours, and high-intensity share over the last 26 weeks.
              </div>
              <div className="mt-1 text-[12px] leading-5 text-white/50">
                Load is internal stress. Hours are volume. The red line shows how much of each week landed in Z4/Z5.
              </div>
            </div>
            <Badge tone="meta">TRIMP · HRR zones</Badge>
          </div>
          <div className="mt-5 h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={weeklyChartData}>
                <defs>
                  <linearGradient id="trainingLoadFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.38} />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis dataKey="week" tick={{ fill: "rgba(255,255,255,0.54)", fontSize: 10 }} />
                <YAxis yAxisId="load" tick={{ fill: "rgba(255,255,255,0.54)", fontSize: 10 }} width={42} />
                <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.54)", fontSize: 10 }} width={38} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(6,10,18,0.96)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    color: "white"
                  }}
                />
                <Area yAxisId="load" type="monotone" dataKey="load" name="Training load" stroke="#38bdf8" fill="url(#trainingLoadFill)" strokeWidth={2} />
                <Bar yAxisId="load" dataKey="hours" name="Hours" fill="#a78bfa" radius={[3, 3, 0, 0]} />
                <Line yAxisId="pct" type="monotone" dataKey="high" name="Z4+Z5 %" stroke="#ef4444" strokeWidth={2.4} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/45">
            Adaptation radar
          </div>
          <div className="mt-2 text-lg text-white">Current signal balance</div>
          <div className="mt-1 text-[12px] leading-5 text-white/50">
            A compact coach view: load, base, balance, data quality, high-intensity pressure, and VO2 movement.
          </div>
          <div className="mt-4 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(255,255,255,0.12)" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: "rgba(255,255,255,0.64)", fontSize: 10 }} />
                <Radar dataKey="value" stroke="#22c55e" fill="#22c55e" fillOpacity={0.24} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(6,10,18,0.96)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    color: "white"
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/45">
                Intensity target
              </div>
              <div className="mt-2 text-lg text-white">Distribution vs target bands</div>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-[8px] border border-white/8 bg-white/[0.035] p-1">
              {[
                ["recent", "28d"],
                ["all", "All"]
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-[6px] px-3 py-1.5 text-[12px] ${
                    timeWindow === value
                      ? "bg-white/[0.12] text-white"
                      : "text-white/54"
                  }`}
                  onClick={() => setTimeWindow(value as TimeWindow)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {intensityData.map((entry) => (
              <div key={entry.key} className="grid gap-2">
                <div className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="text-white/74">{entry.label}</span>
                  <span className="text-white">
                    {entry.percent}% · target {entry.targetLow}-{entry.targetHigh}%
                  </span>
                </div>
                <div className="relative h-3 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="absolute inset-y-0 rounded-full bg-white/[0.12]"
                    style={{
                      left: `${entry.targetLow}%`,
                      width: `${Math.max(2, entry.targetHigh - entry.targetLow)}%`
                    }}
                  />
                  <div
                    className="relative h-full rounded-full"
                    style={{ width: `${Math.max(1, entry.percent)}%`, background: entry.fill }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-2 rounded-[8px] border border-white/8 bg-white/[0.035] p-3 text-[12px] leading-5 text-white/54">
            {trainingLoad.targetModel.monitoringNotes.map((note) => (
              <div key={note} className="flex gap-2">
                <Target className="mt-0.5 size-3.5 shrink-0 text-[var(--primary)]" />
                <span>{note}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/45">
            HR zones
          </div>
          <div className="mt-2 text-lg text-white">
            Detailed zone distribution for {timeWindow === "recent" ? "the last 28 days" : "all available sessions"}.
          </div>
          <div className="mt-4 h-[290px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={zoneData}>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis dataKey="label" interval={0} tick={{ fill: "rgba(255,255,255,0.56)", fontSize: 10 }} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.56)", fontSize: 10 }} width={38} />
                <Tooltip
                  formatter={(value, name) => [
                    name === "minutes" ? `${value} min` : `${value}%`,
                    name
                  ]}
                  contentStyle={{
                    background: "rgba(6,10,18,0.96)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    color: "white"
                  }}
                />
                <Bar dataKey="minutes" name="minutes" radius={[4, 4, 0, 0]}>
                  {zoneData.map((entry) => (
                    <Cell key={entry.key} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/45">
            Daily load texture
          </div>
          <div className="mt-2 text-lg text-white">
            Easy, threshold, and high-intensity minutes against daily load.
          </div>
          <div className="mt-4 h-[310px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyChartData}>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.54)", fontSize: 10 }} />
                <YAxis yAxisId="minutes" tick={{ fill: "rgba(255,255,255,0.54)", fontSize: 10 }} width={38} />
                <YAxis yAxisId="load" orientation="right" tick={{ fill: "rgba(255,255,255,0.54)", fontSize: 10 }} width={38} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(6,10,18,0.96)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    color: "white"
                  }}
                />
                <Bar yAxisId="minutes" dataKey="low" stackId="zones" fill="#22c55e" name="low min" />
                <Bar yAxisId="minutes" dataKey="moderate" stackId="zones" fill="#f59e0b" name="threshold min" />
                <Bar yAxisId="minutes" dataKey="high" stackId="zones" fill="#ef4444" name="high min" />
                <Line yAxisId="load" type="monotone" dataKey="load" stroke="#38bdf8" strokeWidth={2.2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/45">
                Session signals
              </div>
              <div className="mt-2 text-lg text-white">Recent workouts</div>
            </div>
            <Badge tone="meta">{summary.hardDayCount7d} hard days / 7d</Badge>
          </div>
          <div className="mt-4">
            <SessionSignalTable sessions={trainingLoad.sessionSignals} />
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/45">
            Sport contribution
          </div>
          <div className="mt-3 grid gap-3">
            {trainingLoad.activityBreakdown.slice(0, 8).map((activity) => (
              <div
                key={activity.workoutType}
                className="grid gap-2 rounded-[8px] border border-white/8 bg-white/[0.035] p-3 sm:grid-cols-[minmax(0,1fr)_76px_76px_76px]"
              >
                <div>
                  <div className="truncate text-sm text-white">
                    {activity.workoutTypeLabel}
                  </div>
                  <div className="mt-1 text-[11px] text-white/46">
                    {activity.sessionCount} sessions · {activity.activityFamilyLabel}
                  </div>
                </div>
                <div className="text-[12px] text-white/62">
                  <span className="block text-white">{activity.durationHours}h</span>
                  volume
                </div>
                <div className="text-[12px] text-white/62">
                  <span className="block text-white">{activity.trainingLoad}</span>
                  load
                </div>
                <div className="text-[12px] text-white/62">
                  <span className="block text-white">{pct(activity.highPercentage)}</span>
                  high
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-300" />
            <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/45">
              Interpretation guardrails
            </div>
          </div>
          <div className="mt-4 grid gap-3 text-[12px] leading-5 text-white/56">
            <p>
              Forge is estimating training stress from heart-rate reserve zones and
              a TRIMP-like load. This is good for trend decisions, but it is not a
              substitute for lactate testing, gas exchange thresholds, or coach-led
              periodization.
            </p>
            <p>
              Combat sports add sensor noise: wrist HR can miss short spikes during
              punching and clinch work. Treat high-intensity minutes as minimum
              evidence when the session had a lot of arm motion.
            </p>
            <p>
              The practical target is not maximum Z5. Keep hard combat sessions
              meaningful, then add easy aerobic base when the high-intensity share is
              already high.
            </p>
          </div>
        </Card>
      </section>
    </div>
  );
}
