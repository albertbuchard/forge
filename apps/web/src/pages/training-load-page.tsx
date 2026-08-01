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
import type {
  TrainingLoadDecision,
  TrainingLoadDecisionTrigger,
  TrainingLoadViewData
} from "@/lib/types";

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
type TrainingEvidenceStatus = {
  label: string;
  detail: string;
  tone: "meta" | "signal" | "default";
  current: boolean;
  latestDateKey: string | null;
};

export function getTrainingEvidenceStatus(
  trainingLoad: TrainingLoadViewData,
  now = new Date()
): TrainingEvidenceStatus {
  const latestDateKey =
    [
      ...trainingLoad.sessionSignals.map((entry) => entry.dateKey),
      ...trainingLoad.dailyLoad.map((entry) => entry.dateKey)
    ]
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  if (!latestDateKey || trainingLoad.summary.sessionCount === 0) {
    return {
      label: "Insufficient evidence",
      detail: "No workout evidence is available for a current load decision.",
      tone: "default",
      current: false,
      latestDateKey
    };
  }
  const latestDay = Date.parse(`${latestDateKey}T12:00:00Z`);
  if (!Number.isFinite(latestDay)) {
    return {
      label: "Invalid evidence date",
      detail: "The latest training evidence date cannot be interpreted.",
      tone: "default",
      current: false,
      latestDateKey
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
      label: "Future-dated evidence",
      detail: `Latest training evidence is dated ${latestDateKey}; check device time and timezone.`,
      tone: "default",
      current: false,
      latestDateKey
    };
  }
  if (ageDays <= 2) {
    return {
      label: "Current evidence",
      detail: `Latest training evidence is ${ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"} old`}.`,
      tone: "signal",
      current: true,
      latestDateKey
    };
  }
  return {
    label: "Stale training evidence",
    detail: `Latest workout evidence is ${ageDays} days old. Keep the analysis as history, not a current prescription.`,
    tone: "default",
    current: false,
    latestDateKey
  };
}

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

function decisionStatusCopy(status: TrainingLoadDecision["status"]) {
  switch (status) {
    case "recover":
      return {
        badge: "Recovery suggested",
        title: "Why Forge recommends recovery",
        tone: "default" as const
      };
    case "build":
      return {
        badge: "Room to build",
        title: "Why Forge recommends building load",
        tone: "signal" as const
      };
    case "maintain":
      return {
        badge: "Hold current load",
        title: "Why Forge recommends maintaining",
        tone: "meta" as const
      };
    default:
      return {
        badge: "Ready to sharpen",
        title: "Why Forge sees room to sharpen",
        tone: "signal" as const
      };
  }
}

function resolveLoadDecision(
  trainingLoad: TrainingLoadViewData
): TrainingLoadDecision {
  if (trainingLoad.trainingIntelligence.loadDecision) {
    return trainingLoad.trainingIntelligence.loadDecision;
  }
  const defaultMode =
    trainingLoad.trainingIntelligence.modes.find(
      (mode) => mode.key === trainingLoad.trainingIntelligence.defaultMode
    ) ?? trainingLoad.trainingIntelligence.modes[0];
  const legacyStatus = defaultMode?.loadBalance.status;
  return {
    status:
      legacyStatus === "recover" ||
      legacyStatus === "build" ||
      legacyStatus === "maintain" ||
      legacyStatus === "sharpen"
        ? legacyStatus
        : "sharpen",
    primaryTrigger: null,
    activeTriggers: [],
    strainFormula: null
  };
}

function comparisonSymbol(
  comparison: TrainingLoadDecisionTrigger["comparison"]
) {
  if (comparison === "lt") {
    return "<";
  }
  if (comparison === "gte") {
    return "≥";
  }
  return ">";
}

function triggerValue(trigger: TrainingLoadDecisionTrigger) {
  const minimumDigits = trigger.unit === "ratio" ? 2 : 1;
  const displayedThreshold = Number(triggerThreshold(trigger));
  for (let digits = minimumDigits; digits <= 12; digits += 1) {
    const formatted = numberLabel(trigger.value, digits);
    const displayedValue = Number(formatted);
    const comparisonRemainsTrue =
      trigger.comparison === "gt"
        ? displayedValue > displayedThreshold
        : trigger.comparison === "gte"
          ? displayedValue >= displayedThreshold
          : displayedValue < displayedThreshold;
    if (comparisonRemainsTrue) {
      return formatted;
    }
  }
  return String(trigger.value);
}

function triggerThreshold(trigger: TrainingLoadDecisionTrigger) {
  if (trigger.unit === "ratio") {
    return numberLabel(trigger.threshold, 2);
  }
  return numberLabel(trigger.threshold, 0);
}

function decisionCause(
  trigger: TrainingLoadDecisionTrigger | null,
  hasDecisionTrace: boolean
) {
  if (!hasDecisionTrace) {
    return "Forge is preserving the existing recommendation while the API finishes exposing its decision trace.";
  }
  switch (trigger?.key) {
    case "strain_high":
      return "Your 7-day strain crossed the recovery-check threshold.";
    case "acute_chronic_ratio_high":
      return "Your 7-day load rose above Forge's recent-load recovery threshold.";
    case "acute_chronic_ratio_low":
      return "Your 7-day load is below the recent four-week base.";
    case "high_intensity_minutes":
      return "You have already reached Forge's weekly high-intensity marker.";
    default:
      return "No recovery, underload, or high-intensity hold threshold is active.";
  }
}

function decisionContext(trainingLoad: TrainingLoadViewData) {
  if (!trainingLoad.trainingIntelligence.loadDecision) {
    return "Forge is showing the existing load-balance result without inventing threshold values that the older API response did not provide.";
  }
  const loadDecision = resolveLoadDecision(trainingLoad);
  const ratio = trainingLoad.summary.acuteChronicRatio;
  if (
    loadDecision.primaryTrigger?.key === "strain_high" &&
    ratio != null &&
    ratio >= 0.8 &&
    ratio <= 1.35
  ) {
    return `Your ACWR is ${numberLabel(ratio, 2)}, inside Forge's 0.80 to 1.35 non-recovery range. Accumulated strain, not an acute-load spike, caused this recommendation.`;
  }
  if (loadDecision.activeTriggers.length > 1) {
    return `${loadDecision.activeTriggers.length} recovery rules are active. Forge keeps the recommendation conservative until none of them remains crossed.`;
  }
  if (loadDecision.status === "build") {
    return "The recent week is light relative to your four-week base, so Forge sees room for a gradual increase.";
  }
  if (loadDecision.status === "maintain") {
    return "Load balance is otherwise acceptable, but another hard stimulus would add to an already meaningful high-intensity week.";
  }
  if (loadDecision.status === "sharpen") {
    return "Recent load, strain, and high-intensity exposure are all within Forge's current planning boundaries.";
  }
  return "The active threshold above is the reason for the current recommendation.";
}

function TrainingLoadDecisionCard({
  trainingLoad,
  evidenceStatus
}: {
  trainingLoad: TrainingLoadViewData;
  evidenceStatus: TrainingEvidenceStatus;
}) {
  const { summary, trainingIntelligence } = trainingLoad;
  const loadDecision = resolveLoadDecision(trainingLoad);
  const hasDecisionTrace = Boolean(trainingIntelligence.loadDecision);
  const status = decisionStatusCopy(loadDecision.status);
  const defaultMode =
    trainingIntelligence.modes.find(
      (mode) => mode.key === trainingIntelligence.defaultMode
    ) ?? trainingIntelligence.modes[0];
  const nextWorkout = defaultMode?.nextWorkout;
  const primaryTrigger = loadDecision.primaryTrigger;

  return (
    <section
      aria-labelledby="training-load-decision-title"
      data-testid="training-load-decision-card"
    >
      <Card className="overflow-hidden border-[color-mix(in_srgb,var(--warning)_42%,var(--ui-border-subtle)_58%)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--warning)_10%,var(--ui-surface-1)_90%),var(--ui-surface-1)_58%)] p-4 sm:p-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] xl:gap-7">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={evidenceStatus.current ? status.tone : "meta"}>
                {evidenceStatus.current ? status.badge : "Historical analysis"}
              </Badge>
              <span className="text-[11px] text-[var(--ui-ink-muted)]">
                {evidenceStatus.detail}
              </span>
            </div>
            <h2
              id="training-load-decision-title"
              className="mt-3 font-display text-2xl leading-tight text-[var(--ui-ink-strong)] sm:text-3xl"
            >
              {status.title}
            </h2>
            <p className="mt-2 max-w-[62rem] text-sm leading-6 text-[var(--ui-ink-medium)]">
              {decisionCause(primaryTrigger, hasDecisionTrace)}
            </p>

            {loadDecision.activeTriggers.length > 0 ? (
              <div
                className="mt-4 grid gap-2 sm:grid-cols-2"
                aria-label="Active training-load decision rules"
              >
                {loadDecision.activeTriggers.map((trigger) => (
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] border border-[var(--ui-border-subtle)] bg-[color-mix(in_srgb,var(--ui-surface-2)_88%,transparent)] px-3 py-3"
                    key={trigger.key}
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                        {trigger.metricLabel}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ui-ink-medium)]">
                        Current value {triggerValue(trigger)}
                      </div>
                    </div>
                    <div className="whitespace-nowrap rounded-full border border-[color-mix(in_srgb,var(--warning)_48%,var(--ui-border-subtle)_52%)] bg-[color-mix(in_srgb,var(--warning)_12%,var(--ui-surface-1)_88%)] px-3 py-1.5 font-mono text-sm font-semibold text-[var(--ui-ink-strong)]">
                      {triggerValue(trigger)}{" "}
                      {comparisonSymbol(trigger.comparison)}{" "}
                      {triggerThreshold(trigger)}
                    </div>
                  </div>
                ))}
              </div>
            ) : hasDecisionTrace ? (
              <div className="mt-4 rounded-[12px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-3 text-sm text-[var(--ui-ink-medium)]">
                No planning threshold is currently crossed.
              </div>
            ) : (
              <div className="mt-4 rounded-[12px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-3 text-sm text-[var(--ui-ink-medium)]">
                Detailed decision values will appear when the Forge API finishes
                updating. The existing recommendation remains available below.
              </div>
            )}

            {loadDecision.strainFormula === "acute_load_x_monotony" ? (
              <div className="mt-3 text-xs leading-5 text-[var(--ui-ink-muted)]">
                <span className="font-semibold text-[var(--ui-ink-medium)]">
                  How strain is calculated:
                </span>{" "}
                7-day strain = acute load × load monotony. Supporting values:
                acute load {numberLabel(summary.acuteLoad7d, 1)} and monotony{" "}
                {numberLabel(summary.monotony7d, 2)}. Forge calculates strain
                from unrounded daily values.
              </div>
            ) : null}
          </div>

          <div className="grid content-start gap-3 border-t border-[var(--ui-border-subtle)] pt-4 xl:border-l xl:border-t-0 xl:pl-7 xl:pt-0">
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                What this means
              </div>
              <p className="mt-1.5 text-sm leading-6 text-[var(--ui-ink-medium)]">
                {decisionContext(trainingLoad)}
              </p>
            </div>

            <div className="rounded-[12px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                <Target className="size-3.5" /> Next step
              </div>
              {evidenceStatus.current && nextWorkout ? (
                <p className="mt-2 text-sm font-medium leading-6 text-[var(--ui-ink-strong)]">
                  Next workout: {nextWorkout.durationMinutesRange[0]} to{" "}
                  {nextWorkout.durationMinutesRange[1]} minutes, ceiling{" "}
                  {nextWorkout.intensityCeiling}.
                </p>
              ) : (
                <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-medium)]">
                  Sync fresh workout evidence before using this analysis to plan
                  your next session.
                </p>
              )}
              <p className="mt-1 text-xs leading-5 text-[var(--ui-ink-muted)]">
                Forge recalculates after synced workouts. The recommendation can
                change when the active rule is no longer crossed and no other
                higher-priority rule applies.
              </p>
            </div>

            <div className="flex items-start gap-2 text-xs leading-5 text-[var(--ui-ink-muted)]">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]" />
              <span>
                Evidence quality: {pct(summary.averageHeartRateCoverage)}{" "}
                average heart-rate coverage. This is a monitoring flag, not a
                diagnosis.
              </span>
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
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
  const evidenceStatus = getTrainingEvidenceStatus(trainingLoad);
  const decisionStatus = decisionStatusCopy(
    resolveLoadDecision(trainingLoad).status
  );

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
        actions={
          <Badge
            tone={
              evidenceStatus.current ? decisionStatus.tone : evidenceStatus.tone
            }
          >
            {evidenceStatus.current
              ? decisionStatus.badge
              : evidenceStatus.label}
          </Badge>
        }
      />

      <Card className="grid gap-3 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 sm:grid-cols-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
            Freshness
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={evidenceStatus.tone}>{evidenceStatus.label}</Badge>
            <span className="text-sm text-[var(--ui-ink-medium)]">
              {evidenceStatus.detail}
            </span>
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
            Heart-rate coverage
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-medium)]">
            {pct(summary.averageHeartRateCoverage)} average coverage;{" "}
            {summary.reliableSessionCount} of {summary.sessionCount} sessions
            are high-resolution.
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
            Decision boundary
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-medium)]">
            {evidenceStatus.current
              ? "Targets are current estimates, not medical or coaching instructions."
              : "Targets below remain visible for analysis but should not drive the next workout until fresh evidence arrives."}
          </div>
        </div>
      </Card>

      <TrainingLoadDecisionCard
        trainingLoad={trainingLoad}
        evidenceStatus={evidenceStatus}
      />

      <section
        className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
        data-testid="training-load-summary-grid"
      >
        {metricTile({
          label: "Acute load",
          value: numberLabel(summary.acuteLoad7d, 0),
          detail:
            "Last 7 days of internal load. The decision trace above shows which metric controls the recommendation.",
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

      <ZoneIntelligencePanel
        trainingLoad={trainingLoad}
        evidenceCurrent={evidenceStatus.current}
      />

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
