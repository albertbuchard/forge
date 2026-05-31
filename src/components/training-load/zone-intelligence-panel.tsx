import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Activity, Brain, Target, Zap } from "lucide-react";
import { ChartBox } from "@/components/training-load/chart-box";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  below_z1: "#94a3b8",
  zone_1: "#38bdf8",
  zone_2: "#22c55e",
  zone_3: "#eab308",
  zone_4: "#f97316",
  zone_5: "#ef4444"
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
      <div className="rounded-[8px] border border-white/8 bg-white/[0.035] p-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-white/44">
          <Activity className="size-3.5" />
          Drivers
        </div>
        <div className="mt-3 grid gap-2 text-[12px] leading-5 text-white/62">
          {(mode.drivers.length > 0 ? mode.drivers : ["No positive driver is strong enough yet."]).map(
            (driver) => (
              <div key={driver}>{driver}</div>
            )
          )}
        </div>
      </div>
      <div className="rounded-[8px] border border-white/8 bg-white/[0.035] p-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-white/44">
          <Zap className="size-3.5" />
          Limiters
        </div>
        <div className="mt-3 grid gap-2 text-[12px] leading-5 text-white/62">
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
  trainingLoad
}: {
  trainingLoad: TrainingLoadViewData;
}) {
  const [modeKey, setModeKey] = useState(
    trainingLoad.trainingIntelligence.defaultMode
  );
  const [interval, setInterval] = useState<ZoneInterval>("weekly");
  const selectedMode =
    trainingLoad.trainingIntelligence.modes.find((mode) => mode.key === modeKey) ??
    trainingLoad.trainingIntelligence.modes[0];
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
            <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/45">
              Zone intelligence
            </div>
            <div className="mt-2 text-lg text-white">
              Time in zone by training block
            </div>
            <div className="mt-1 max-w-2xl text-[12px] leading-5 text-white/50">
              Weekly by default, with the same HRR zones Forge already uses.
              Low/moderate/high domains keep the coach view readable while the
              full five-zone split stays inspectable.
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-[8px] border border-white/8 bg-white/[0.035] p-1">
            {[
              ["weekly", "Week"],
              ["monthly", "Month"],
              ["daily", "90d"]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`rounded-[6px] px-3 py-1.5 text-[12px] ${
                  interval === value ? "bg-white/[0.12] text-white" : "text-white/54"
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
                <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tick={{ fill: "rgba(255,255,255,0.54)", fontSize: 10 }}
                />
                <YAxis
                  tick={{ fill: "rgba(255,255,255,0.54)", fontSize: 10 }}
                  width={42}
                />
                <Tooltip
                  formatter={(value, name) => [
                    `${Number(value).toFixed(0)} min`,
                    ZONE_LABELS[name as TrainingLoadZoneKey] ?? String(name)
                  ]}
                  contentStyle={{
                    background: "rgba(6,10,18,0.96)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    color: "white"
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

        <div className="mt-4 overflow-x-auto rounded-[8px] border border-white/8">
          <div className="grid min-w-[760px] grid-cols-[96px_72px_72px_repeat(6,64px)_72px_80px] bg-white/[0.045] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-white/42">
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
              className="grid min-w-[760px] grid-cols-[96px_72px_72px_repeat(6,64px)_72px_80px] border-t border-white/8 px-3 py-2 text-[12px] text-white/62"
            >
              <div className="text-white">{bucket.bucketKey}</div>
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
            <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/45">
              Smart training mode
            </div>
            <div className="mt-2 text-lg text-white">{selectedMode.label}</div>
          </div>
          <Badge tone={scoreTone(selectedMode.score)}>
            {selectedMode.score}/100
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-[8px] border border-white/8 bg-white/[0.035] p-1">
          {trainingLoad.trainingIntelligence.modes.map((mode) => (
            <button
              key={mode.key}
              type="button"
              className={`rounded-[6px] px-2 py-2 text-[12px] ${
                mode.key === selectedMode.key
                  ? "bg-white/[0.12] text-white"
                  : "text-white/54"
              }`}
              onClick={() => setModeKey(mode.key)}
            >
              {modeButtonLabel(mode)}
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-[8px] border border-white/8 bg-white/[0.035] p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-white/44">
            <Brain className="size-3.5" />
            Interpretation
          </div>
          <div className="mt-3 text-[13px] leading-5 text-white/72">
            {selectedMode.summary}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-white/50">
            <div>Balance: {selectedMode.loadBalance.status}</div>
            <div>Confidence: {selectedMode.confidence}</div>
            <div>ACWR: {selectedMode.loadBalance.acuteChronicRatio ?? "n/a"}</div>
            <div>
              Baseline:{" "}
              {selectedMode.loadBalance.latestWeekBaselineLoadRatio ?? "n/a"}x
            </div>
          </div>
        </div>

        <div className="mt-4">
          <ModeNarrative mode={selectedMode} />
        </div>

        <div className="mt-4 grid gap-3 rounded-[8px] border border-white/8 bg-white/[0.035] p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-white/44">
            <Target className="size-3.5" />
            Next targets
          </div>
          <div className="grid gap-2 text-[12px] leading-5 text-white/62">
            <div>
              Next week: {selectedMode.nextWeekTargets.totalMinutesRange[0]}-
              {selectedMode.nextWeekTargets.totalMinutesRange[1]} min · max{" "}
              {selectedMode.nextWeekTargets.maxHardSessions} hard sessions · at
              least {selectedMode.nextWeekTargets.minimumEasyMinutes} easy/base
              min.
            </div>
            <div>
              Next workout:{" "}
              <span className="text-white">
                {workoutLabel(selectedMode.nextWorkout.recommendedType)}
              </span>{" "}
              for {selectedMode.nextWorkout.durationMinutesRange[0]}-
              {selectedMode.nextWorkout.durationMinutesRange[1]} min, ceiling{" "}
              {selectedMode.nextWorkout.intensityCeiling}.
            </div>
            <div className="text-white/50">{selectedMode.nextWorkout.reason}</div>
            {selectedMode.nextWeekTargets.warning ? (
              <div className="rounded-[6px] bg-amber-300/10 px-2 py-1 text-amber-100/82">
                {selectedMode.nextWeekTargets.warning}
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </section>
  );
}
