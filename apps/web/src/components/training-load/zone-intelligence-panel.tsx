import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, Brain, Target, Zap } from "lucide-react";
import { ChartBox } from "@/components/training-load/chart-box";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import type {
  TrainingIntelligenceMode,
  TrainingLoadViewData,
  TrainingLoadZoneKey,
  ZoneTimeBucket
} from "@/lib/types";

const ZONE_ORDER: TrainingLoadZoneKey[] = [
  "below_z1",
  "zone_1",
  "zone_2",
  "zone_3",
  "zone_4",
  "zone_5"
];

const ZONE_LABELS: Record<TrainingLoadZoneKey, string> = {
  below_z1: "Below Z1",
  zone_1: "Z1",
  zone_2: "Z2",
  zone_3: "Z3",
  zone_4: "Z4",
  zone_5: "Z5"
};

const ZONE_COLORS: Record<TrainingLoadZoneKey, string> = {
  below_z1: "var(--ui-ink-muted)",
  zone_1: "var(--info)",
  zone_2: "var(--success)",
  zone_3: "var(--warning)",
  zone_4: "var(--tertiary)",
  zone_5: "var(--danger)"
};

const ZONE_INTELLIGENCE_HELP = {
  timeInZone:
    "Each block totals the minutes Forge can place into adaptive HRR zones from stored heart-rate samples. Weekly is the default planning view because it matches common training microcycles; monthly and daily views help detect longer trends or recent spikes.",
  smartMode:
    "Smart modes do not change the underlying data. They change the coaching lens: combat readiness prioritizes hard-day spacing and controlled high intensity, aerobic base prioritizes low-zone development, and endurance pro compares the distribution with pyramidal or polarized endurance planning patterns.",
  interpretation:
    "This paragraph explains what the selected mode concludes from the latest load balance, zone distribution, hard-day count, and data confidence. It is a planning summary, not a medical clearance.",
  drivers:
    "Drivers are the signals helping the selected mode: examples include enough easy/base work, controlled high-zone share, stable acute/chronic load, or improving data quality.",
  limiters:
    "Limiters are the signals that should constrain the next block. If Forge lists a limiter, the next target should usually solve that before adding more hard work.",
  targets:
    "Next targets translate the selected mode into a practical week and next workout. The range is intentionally bounded so training can progress without turning every good week into a maximal week."
};

type ZoneInterval = "weekly" | "monthly" | "daily";

function modeButtonLabel(mode: TrainingIntelligenceMode) {
  if (mode.key === "combat_readiness") {
    return "Combat";
  }
  if (mode.key === "aerobic_base") {
    return "Base";
  }
  return "Endurance";
}

function scoreTone(score: number) {
  if (score >= 82) {
    return "signal" as const;
  }
  if (score >= 65) {
    return "default" as const;
  }
  return "meta" as const;
}

function workoutLabel(type: string) {
  switch (type) {
    case "vo2max_4x4":
      return "4x4 VO2max";
    case "zone_2_base":
      return "Zone 2 / base";
    case "technical_kickboxing":
      return "Technical kickboxing";
    case "easy_aerobic":
      return "Easy aerobic";
    case "recovery":
      return "Recovery";
    default:
      return type.replaceAll("_", " ");
  }
}

function bucketLabel(bucket: ZoneTimeBucket, interval: ZoneInterval) {
  if (interval === "daily") {
    return bucket.bucketKey.slice(5);
  }
  if (interval === "monthly") {
    return bucket.bucketKey.slice(2);
  }
  return bucket.bucketKey.replace(/^20/, "'");
}

function chartRows(buckets: ZoneTimeBucket[], interval: ZoneInterval) {
  const limit = interval === "daily" ? 30 : 12;
  return buckets.slice(-limit).map((bucket) => ({
    bucket: bucketLabel(bucket, interval),
    total: Math.round(bucket.durationMinutes),
    load: bucket.trainingLoad,
    confidence: bucket.confidence,
    ...Object.fromEntries(
      ZONE_ORDER.map((zone) => [zone, bucket.zoneMinutes[zone] ?? 0])
    )
  }));
}

function latestBuckets(
  trainingLoad: TrainingLoadViewData,
  interval: ZoneInterval
) {
  return trainingLoad.zoneTimeSeries[interval];
}

function ModeNarrative({ mode }: { mode: TrainingIntelligenceMode }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
          <Activity className="size-3.5" />
          Drivers
          <InfoTooltip
            label="Explain training drivers"
            title="Drivers"
            content={ZONE_INTELLIGENCE_HELP.drivers}
          />
        </div>
        <div className="mt-3 grid gap-2 text-[12px] leading-5 text-[var(--ui-ink-medium)]">
          {(mode.drivers.length > 0
            ? mode.drivers
            : ["No positive driver is strong enough yet."]
          ).map((driver) => (
            <div key={driver}>{driver}</div>
          ))}
        </div>
      </div>
      <div className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
          <Zap className="size-3.5" />
          Limiters
          <InfoTooltip
            label="Explain training limiters"
            title="Limiters"
            content={ZONE_INTELLIGENCE_HELP.limiters}
          />
        </div>
        <div className="mt-3 grid gap-2 text-[12px] leading-5 text-[var(--ui-ink-medium)]">
          {(mode.limitingFactors.length > 0
            ? mode.limitingFactors
            : ["No major limiter in this mode right now."]
          ).map((factor) => (
            <div key={factor}>{factor}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ZoneIntelligencePanel({
  trainingLoad,
  evidenceCurrent = true
}: {
  trainingLoad: TrainingLoadViewData;
  evidenceCurrent?: boolean;
}) {
  const [modeKey, setModeKey] = useState(
    trainingLoad.trainingIntelligence.defaultMode
  );
  const [interval, setInterval] = useState<ZoneInterval>("weekly");
  const selectedMode =
    trainingLoad.trainingIntelligence.modes.find(
      (mode) => mode.key === modeKey
    ) ?? trainingLoad.trainingIntelligence.modes[0];
  const buckets = latestBuckets(trainingLoad, interval);
  const rows = useMemo(() => chartRows(buckets, interval), [buckets, interval]);
  const tableBuckets = buckets.slice(-8).reverse();

  if (!selectedMode) {
    return null;
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <div className="font-label text-[10px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Zone intelligence
              </div>
              <InfoTooltip
                label="Explain zone intelligence"
                title="Time in zone"
                content={ZONE_INTELLIGENCE_HELP.timeInZone}
              />
            </div>
            <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
              Time in zone by training block
            </div>
            <div className="mt-1 max-w-2xl text-[12px] leading-5 text-[var(--ui-ink-muted)]">
              Weekly by default because most training plans are adjusted week by
              week. The stacked bars preserve the full zone split, while the
              table adds load rate, hard days, and data confidence.
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-1">
            {[
              ["weekly", "Week"],
              ["monthly", "Month"],
              ["daily", "90d"]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`rounded-[6px] px-3 py-1.5 text-[12px] ${
                  interval === value
                    ? "bg-[var(--ui-surface-2)] text-[var(--ui-ink-strong)]"
                    : "text-[var(--ui-ink-muted)]"
                }`}
                onClick={() => setInterval(value as ZoneInterval)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <ChartBox height={320}>
            {({ width, height }) => (
              <BarChart data={rows} width={width} height={height}>
                <CartesianGrid
                  stroke="var(--ui-border-subtle)"
                  vertical={false}
                />
                <XAxis
                  dataKey="bucket"
                  tick={{ fill: "var(--ui-ink-muted)", fontSize: 10 }}
                />
                <YAxis
                  tick={{ fill: "var(--ui-ink-muted)", fontSize: 10 }}
                  width={42}
                />
                <Tooltip
                  formatter={(value, name) => [
                    `${Number(value).toFixed(0)} min`,
                    ZONE_LABELS[name as TrainingLoadZoneKey] ?? String(name)
                  ]}
                  contentStyle={{
                    background: "var(--ui-surface-modal)",
                    border: "1px solid var(--ui-border-subtle)",
                    borderRadius: 8,
                    color: "var(--ui-ink-strong)"
                  }}
                />
                {ZONE_ORDER.map((zone) => (
                  <Bar
                    key={zone}
                    dataKey={zone}
                    stackId="zones"
                    fill={ZONE_COLORS[zone]}
                    name={zone}
                  />
                ))}
              </BarChart>
            )}
          </ChartBox>
        </div>

        <div className="mt-4 grid gap-3 md:hidden">
          {tableBuckets.map((bucket) => (
            <div
              key={bucket.bucketKey}
              className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
                    {bucket.bucketKey}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-muted)]">
                    Load {bucket.trainingLoad} · {bucket.loadPerMinute}{" "}
                    TRIMP/min
                  </div>
                </div>
                <Badge tone="meta">{bucket.confidence}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] min-[360px]:grid-cols-3">
                {ZONE_ORDER.map((zone) => (
                  <div
                    key={zone}
                    className="rounded-[8px] bg-[var(--ui-surface-2)] px-2 py-1.5"
                  >
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--ui-ink-muted)]">
                      {ZONE_LABELS[zone]}
                    </div>
                    <div className="mt-0.5 text-[var(--ui-ink-medium)]">
                      {bucket.zoneMinutes[zone]} min
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs leading-5 text-[var(--ui-ink-muted)]">
                {bucket.hardDayCount} hard day
                {bucket.hardDayCount === 1 ? "" : "s"} in this block.
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 hidden overflow-x-auto rounded-[8px] border border-[var(--ui-border-subtle)] md:block">
          <div className="grid min-w-[760px] grid-cols-[96px_72px_72px_repeat(6,64px)_72px_80px] bg-[var(--ui-surface-2)] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
            <div>Block</div>
            <div>Load</div>
            <div>TRIMP/min</div>
            {ZONE_ORDER.map((zone) => (
              <div key={zone}>{ZONE_LABELS[zone]}</div>
            ))}
            <div>Hard</div>
            <div>Quality</div>
          </div>
          {tableBuckets.map((bucket) => (
            <div
              key={bucket.bucketKey}
              className="grid min-w-[760px] grid-cols-[96px_72px_72px_repeat(6,64px)_72px_80px] border-t border-[var(--ui-border-subtle)] px-3 py-2 text-[12px] text-[var(--ui-ink-medium)]"
            >
              <div className="text-[var(--ui-ink-strong)]">
                {bucket.bucketKey}
              </div>
              <div>{bucket.trainingLoad}</div>
              <div>{bucket.loadPerMinute}</div>
              {ZONE_ORDER.map((zone) => (
                <div key={zone}>{bucket.zoneMinutes[zone]}</div>
              ))}
              <div>{bucket.hardDayCount}</div>
              <div>{bucket.confidence}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <div className="font-label text-[10px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Smart training mode
              </div>
              <InfoTooltip
                label="Explain smart training modes"
                title="Training mode"
                content={ZONE_INTELLIGENCE_HELP.smartMode}
              />
            </div>
            <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
              {selectedMode.label}
            </div>
          </div>
          <Badge tone={scoreTone(selectedMode.score)}>
            {selectedMode.score}/100
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-1">
          {trainingLoad.trainingIntelligence.modes.map((mode) => (
            <button
              key={mode.key}
              type="button"
              className={`rounded-[6px] px-2 py-2 text-[12px] ${
                mode.key === selectedMode.key
                  ? "bg-[var(--ui-surface-2)] text-[var(--ui-ink-strong)]"
                  : "text-[var(--ui-ink-muted)]"
              }`}
              onClick={() => setModeKey(mode.key)}
            >
              {modeButtonLabel(mode)}
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
            <Brain className="size-3.5" />
            Interpretation
            <InfoTooltip
              label="Explain this interpretation"
              title="Interpretation"
              content={ZONE_INTELLIGENCE_HELP.interpretation}
            />
          </div>
          <div className="mt-3 text-[13px] leading-5 text-[var(--ui-ink-medium)]">
            {selectedMode.summary}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--ui-ink-muted)]">
            <div>Balance: {selectedMode.loadBalance.status}</div>
            <div>Confidence: {selectedMode.confidence}</div>
            <div>
              ACWR: {selectedMode.loadBalance.acuteChronicRatio ?? "n/a"}
            </div>
            <div>
              Baseline:{" "}
              {selectedMode.loadBalance.latestWeekBaselineLoadRatio ?? "n/a"}x
            </div>
          </div>
        </div>

        <div className="mt-4">
          <ModeNarrative mode={selectedMode} />
        </div>

        <div className="mt-4 grid gap-3 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
            <Target className="size-3.5" />
            {evidenceCurrent ? "Next targets" : "Historical target estimate"}
            <InfoTooltip
              label="Explain next training targets"
              title="Next targets"
              content={ZONE_INTELLIGENCE_HELP.targets}
            />
          </div>
          <div className="grid gap-2 text-[12px] leading-5 text-[var(--ui-ink-medium)]">
            {!evidenceCurrent ? (
              <div className="rounded-[6px] bg-[var(--ui-warning-soft)] px-2 py-1 text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]">
                Evidence is stale or incomplete. These targets describe the
                stored model state and are not a current workout recommendation.
              </div>
            ) : null}
            <div>
              Next week: {selectedMode.nextWeekTargets.totalMinutesRange[0]}-
              {selectedMode.nextWeekTargets.totalMinutesRange[1]} min · max{" "}
              {selectedMode.nextWeekTargets.maxHardSessions} hard sessions · at
              least {selectedMode.nextWeekTargets.minimumEasyMinutes} easy/base
              min.
            </div>
            <div>
              Next workout:{" "}
              <span className="text-[var(--ui-ink-strong)]">
                {workoutLabel(selectedMode.nextWorkout.recommendedType)}
              </span>{" "}
              for {selectedMode.nextWorkout.durationMinutesRange[0]}-
              {selectedMode.nextWorkout.durationMinutesRange[1]} min, ceiling{" "}
              {selectedMode.nextWorkout.intensityCeiling}.
            </div>
            <div className="text-[var(--ui-ink-muted)]">
              {selectedMode.nextWorkout.reason}
            </div>
            {selectedMode.nextWeekTargets.warning ? (
              <div className="rounded-[6px] bg-[var(--ui-warning-soft)] px-2 py-1 text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]">
                {selectedMode.nextWeekTargets.warning}
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </section>
  );
}
