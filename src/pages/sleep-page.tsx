import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, MoonStar, Save } from "lucide-react";
import { EntityLinkMultiSelect } from "@/components/psyche/entity-link-multiselect";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForgeShell } from "@/components/shell/app-shell";
import {
  SleepBrowserBox,
  SleepPatternsBox,
  SleepSummaryBox
} from "@/components/workbench-boxes/health/health-boxes";
import {
  getSleepSessionRawDetail,
  getSleepView,
  listBehaviors,
  listBehaviorPatterns,
  listBeliefs,
  listPsycheValues,
  listTriggerReports,
  patchSleepSession
} from "@/lib/api";
import {
  buildHealthEntityLinkOptions,
  parseHealthLinkValues
} from "@/lib/health-link-options";
import type {
  SleepCalendarDay,
  SleepPhaseTimeline,
  SleepPhaseTimelineBlock,
  SleepRawLogRecord,
  SleepSegmentRecord,
  SleepSessionDetailPayload,
  SleepSessionRecord,
  SleepSourceRecord,
  SleepSurfaceNight
} from "@/lib/types";
import { cn } from "@/lib/utils";

type SleepDraft = {
  qualitySummary: string;
  notes: string;
  tagsText: string;
  linkValues: string[];
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STAGE_META: Record<
  string,
  { label: string; strong: string; soft: string; text: string }
> = {
  awake: {
    label: "Awake",
    strong: "rgba(251, 191, 36, 0.95)",
    soft: "rgba(251, 191, 36, 0.16)",
    text: "text-amber-200"
  },
  core: {
    label: "Core",
    strong: "rgba(165, 180, 252, 0.96)",
    soft: "rgba(165, 180, 252, 0.18)",
    text: "text-indigo-100"
  },
  deep: {
    label: "Deep",
    strong: "rgba(45, 212, 191, 0.96)",
    soft: "rgba(45, 212, 191, 0.18)",
    text: "text-teal-100"
  },
  rem: {
    label: "REM",
    strong: "rgba(96, 165, 250, 0.96)",
    soft: "rgba(96, 165, 250, 0.18)",
    text: "text-sky-100"
  },
  in_bed: {
    label: "In bed",
    strong: "rgba(255, 255, 255, 0.4)",
    soft: "rgba(255, 255, 255, 0.1)",
    text: "text-white/72"
  },
  asleep_unspecified: {
    label: "Asleep",
    strong: "rgba(196, 181, 253, 0.96)",
    soft: "rgba(196, 181, 253, 0.16)",
    text: "text-violet-100"
  }
};

function stageMeta(stage: string) {
  return STAGE_META[stage] ?? STAGE_META.asleep_unspecified;
}

function formatDurationCompact(seconds: number) {
  if (seconds <= 0) {
    return "0m";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function formatSignedMinutesFromSeconds(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) {
    return "on baseline";
  }
  return `${minutes > 0 ? "+" : "-"}${Math.abs(minutes)}m`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatClockInZone(value: string | null, timeZone: string) {
  if (!value) {
    return "n/a";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone
  }).format(new Date(value));
}

function formatDateLabel(value: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone
  }).format(new Date(value));
}

function formatSleepWindow(startedAt: string, endedAt: string, timeZone: string) {
  return `${formatClockInZone(startedAt, timeZone)} - ${formatClockInZone(endedAt, timeZone)}`;
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric"
  }).format(new Date(year, (month ?? 1) - 1, 1));
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = (date.getDay() + 6) % 7;
  next.setDate(date.getDate() - day);
  return next;
}

function endOfWeek(date: Date) {
  const next = startOfWeek(date);
  next.setDate(next.getDate() + 6);
  return next;
}

function dateKeyForDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildSleepDraft(session: SleepSessionRecord): SleepDraft {
  return {
    qualitySummary:
      typeof session.annotations.qualitySummary === "string"
        ? session.annotations.qualitySummary
        : "",
    notes:
      typeof session.annotations.notes === "string"
        ? session.annotations.notes
        : "",
    tagsText: Array.isArray(session.annotations.tags)
      ? session.annotations.tags.join(", ")
      : "",
    linkValues: Array.isArray(session.links)
      ? session.links.map((link) => `${link.entityType}:${link.entityId}`)
      : []
  };
}

function buildMonthGrid(monthKey: string, days: SleepCalendarDay[]) {
  if (!monthKey) {
    return [];
  }
  const [year, month] = monthKey.split("-").map(Number);
  const monthStart = new Date(year, (month ?? 1) - 1, 1);
  const monthEnd = new Date(year, month ?? 1, 0);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);
  const byDateKey = new Map(days.map((day) => [day.dateKey, day]));
  const cells: Array<{
    dateKey: string;
    dayNumber: number;
    outsideMonth: boolean;
    sleep: SleepCalendarDay | null;
  }> = [];
  for (
    const cursor = new Date(gridStart);
    cursor <= gridEnd;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const dateKey = dateKeyForDate(cursor);
    cells.push({
      dateKey,
      dayNumber: cursor.getDate(),
      outsideMonth: cursor.getMonth() !== monthStart.getMonth(),
      sleep: byDateKey.get(dateKey) ?? null
    });
  }
  return cells;
}

function percentChangeTone(value: number) {
  if (value > 0) {
    return "text-emerald-200";
  }
  if (value < 0) {
    return "text-rose-200";
  }
  return "text-white/70";
}

function summaryBadgeTone(state: string | null) {
  if (state === "recharged" || state === "recovered") {
    return "bg-emerald-400/16 text-emerald-100";
  }
  if (state === "steady" || state === "stable") {
    return "bg-sky-400/16 text-sky-100";
  }
  if (state === "fragile" || state === "strained") {
    return "bg-amber-400/16 text-amber-100";
  }
  if (state === "depleted") {
    return "bg-rose-400/16 text-rose-100";
  }
  return "bg-white/10 text-white/76";
}

function rawStatusTone(status: SleepSessionDetailPayload["rawDataStatus"]) {
  if (status === "provider_raw") {
    return "bg-emerald-400/16 text-emerald-100";
  }
  if (status === "historical_raw") {
    return "bg-amber-400/16 text-amber-100";
  }
  return "bg-white/10 text-white/70";
}

function rawStatusLabel(status: SleepSessionDetailPayload["rawDataStatus"]) {
  if (status === "provider_raw") {
    return "Provider raw data";
  }
  if (status === "historical_raw") {
    return "Historical raw data";
  }
  return "Raw data unavailable";
}

function sourceRecordTone(record: SleepSourceRecord) {
  return record.qualityKind === "provider_native"
    ? "bg-emerald-400/16 text-emerald-100"
    : "bg-amber-400/16 text-amber-100";
}

type LegacySleepSessionDetailPayload = SleepSessionDetailPayload & {
  rawSegments?: SleepSegmentRecord[];
  rawLogs?: SleepRawLogRecord[];
};

function inferHistoricalRawStage(
  payload: Record<string, unknown>,
  logType: string
) {
  const stage = payload.stage;
  if (typeof stage === "string" && stage.trim().length > 0) {
    return stage;
  }
  const sourceType = payload.sourceType;
  if (typeof sourceType === "string" && sourceType.trim().length > 0) {
    return sourceType;
  }
  const stageBreakdown = payload.stageBreakdown;
  if (Array.isArray(stageBreakdown) && stageBreakdown.length > 0) {
    const firstStage = stageBreakdown[0];
    if (
      firstStage &&
      typeof firstStage === "object" &&
      typeof (firstStage as { stage?: unknown }).stage === "string"
    ) {
      return ((firstStage as { stage: string }).stage || "asleep_unspecified").trim();
    }
  }
  return logType.includes("awake") ? "awake" : "asleep_unspecified";
}

function normalizeRawDetail(detail: SleepSessionDetailPayload | null) {
  const legacyDetail = detail as LegacySleepSessionDetailPayload | null;
  const segments = legacyDetail?.segments ?? legacyDetail?.rawSegments ?? [];
  const auditLogs = legacyDetail?.auditLogs ?? legacyDetail?.rawLogs ?? [];
  const sourceRecords =
    legacyDetail?.sourceRecords && legacyDetail.sourceRecords.length > 0
      ? legacyDetail.sourceRecords
      : auditLogs
          .filter(
            (entry): entry is SleepRawLogRecord & { startedAt: string; endedAt: string } =>
              typeof entry.startedAt === "string" && typeof entry.endedAt === "string"
          )
          .map(
            (entry): SleepSourceRecord => ({
              id: entry.id,
              importRunId: entry.importRunId,
              pairingSessionId: entry.pairingSessionId,
              sleepSessionId: entry.sleepSessionId,
              userId: entry.userId,
              provider: entry.source,
              providerRecordType: entry.logType,
              providerRecordUid: entry.externalUid ?? entry.id,
              sourceDevice: "",
              sourceTimezone: entry.sourceTimezone,
              localDateKey: entry.localDateKey,
              startedAt: entry.startedAt,
              endedAt: entry.endedAt,
              rawStage: inferHistoricalRawStage(entry.payload, entry.logType),
              rawValue: null,
              qualityKind: "historical_import",
              payload: entry.payload,
              metadata: entry.metadata,
              ingestedAt: entry.createdAt
            })
          );
  const rawDataStatus =
    legacyDetail?.rawDataStatus ??
    (sourceRecords.length > 0 ? "historical_raw" : "raw_unavailable");
  return {
    sourceRecords,
    segments,
    auditLogs,
    rawDataStatus
  };
}

function StageDistributionBar({
  stages
}: {
  stages: SleepSurfaceNight["stageBreakdown"] | SleepSessionRecord["stageBreakdown"];
}) {
  const totalSeconds = stages.reduce((sum, stage) => sum + stage.seconds, 0);
  if (stages.length === 0 || totalSeconds === 0) {
    return (
      <div className="rounded-[18px] border border-dashed border-white/10 bg-black/10 px-4 py-4 text-sm text-white/52">
        No stage composition was stored for this night yet.
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.08]">
        {stages.map((stage) => {
          const meta = stageMeta(stage.stage);
          return (
            <div
              key={stage.stage}
              className="h-full"
              style={{
                width: `${Math.max(4, (stage.seconds / totalSeconds) * 100)}%`,
                background: meta.strong
              }}
              title={`${meta.label} · ${formatDurationCompact(stage.seconds)}`}
            />
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {stages.map((stage) => {
          const meta = stageMeta(stage.stage);
          const ratio =
            "percentage" in stage && typeof stage.percentage === "number"
              ? stage.percentage
              : totalSeconds > 0
                ? stage.seconds / totalSeconds
                : 0;
          return (
            <div
              key={stage.stage}
              className="rounded-[16px] border border-white/8 px-3 py-3"
              style={{ background: meta.soft }}
            >
              <div className={cn("text-sm font-medium", meta.text)}>{meta.label}</div>
              <div className="mt-1 text-lg text-white">
                {formatDurationCompact(stage.seconds)}
              </div>
              <div className="text-xs text-white/54">{formatPercent(ratio)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineRail({
  blocks,
  selectedBlockId,
  onSelect
}: {
  blocks: SleepPhaseTimelineBlock[];
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
}) {
  return (
    <div className="relative h-12 overflow-hidden rounded-[18px] border border-white/8 bg-black/20">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[length:25%_100%]" />
      {blocks.map((block) => {
        const meta = stageMeta(block.stage);
        const isSelected = selectedBlockId === block.id;
        return (
          <button
            key={block.id}
            type="button"
            onClick={() => onSelect(block.id)}
            className={cn(
              "absolute inset-y-[5px] rounded-[12px] border transition",
              isSelected ? "border-white/60 shadow-[0_0_0_1px_rgba(255,255,255,0.18)]" : "border-white/10"
            )}
            style={{
              left: `${block.offsetRatio * 100}%`,
              width: `${Math.max(block.widthRatio * 100, 1.8)}%`,
              background: meta.strong
            }}
            title={`${block.label} · ${formatDurationCompact(block.durationSeconds)} · ${block.startedAt} - ${block.endedAt}`}
          >
            {block.widthRatio > 0.13 ? (
              <span className="truncate px-2 text-[10px] font-medium text-slate-950/85">
                {block.label}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function SleepPhaseTimeline({
  timeline,
  timeZone
}: {
  timeline: SleepPhaseTimeline;
  timeZone: string;
}) {
  const inBedBlocks = timeline.blocks.filter((block) => block.lane === "in_bed");
  const sleepBlocks = timeline.blocks.filter((block) => block.lane === "sleep");
  const firstSelectableBlockId = sleepBlocks[0]?.id ?? inBedBlocks[0]?.id ?? null;
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(
    firstSelectableBlockId
  );

  useEffect(() => {
    setSelectedBlockId(firstSelectableBlockId);
  }, [
    firstSelectableBlockId,
    timeline.startedAt,
    timeline.endedAt,
    timeline.totalSeconds
  ]);

  const selectedBlock =
    timeline.blocks.find((block) => block.id === selectedBlockId) ?? null;

  if (!timeline.hasRawSegments) {
    return (
      <div className="rounded-[18px] border border-dashed border-white/10 bg-black/10 px-4 py-5 text-sm text-white/56">
        Phase timing is unavailable for this night. Forge still keeps the canonical overnight summary, but the companion did not store segment-level timing.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        {inBedBlocks.length > 0 ? (
          <div className="grid gap-2">
            <div className="text-xs uppercase tracking-[0.18em] text-white/40">
              In bed window
            </div>
            <TimelineRail
              blocks={inBedBlocks}
              selectedBlockId={selectedBlockId}
              onSelect={setSelectedBlockId}
            />
          </div>
        ) : null}
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-[0.18em] text-white/40">
            {timeline.hasSleepStageData ? "Sleep phases" : "Recorded sleep coverage"}
          </div>
          <TimelineRail
            blocks={sleepBlocks.length > 0 ? sleepBlocks : inBedBlocks}
            selectedBlockId={selectedBlockId}
            onSelect={setSelectedBlockId}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-white/48">
        <span>{formatClockInZone(timeline.startedAt, timeZone)}</span>
        <span>{formatDurationCompact(timeline.totalSeconds)}</span>
        <span>{formatClockInZone(timeline.endedAt, timeZone)}</span>
      </div>

      {selectedBlock ? (
        <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className={cn("text-sm font-medium", stageMeta(selectedBlock.stage).text)}>
                {selectedBlock.label}
              </div>
              <div className="mt-1 text-sm text-white/58">
                {formatClockInZone(selectedBlock.startedAt, timeZone)} -{" "}
                {formatClockInZone(selectedBlock.endedAt, timeZone)}
              </div>
            </div>
            <Badge tone="meta">{formatDurationCompact(selectedBlock.durationSeconds)}</Badge>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LastNightHero({
  latestNight
}: {
  latestNight: SleepSurfaceNight | null;
}) {
  if (!latestNight) {
    return (
      <Card className="overflow-hidden p-6">
        <div className="text-sm uppercase tracking-[0.18em] text-white/42">Sleep</div>
        <div className="mt-4 text-2xl text-white">No overnight sleep yet</div>
        <div className="mt-3 max-w-2xl text-sm leading-6 text-white/58">
          The sleep page will switch to a night-first summary once the companion syncs a canonical overnight session.
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-white/8 bg-[linear-gradient(135deg,rgba(7,17,40,0.96),rgba(16,24,54,0.94))] p-0">
      <div className="relative overflow-hidden px-6 py-6 sm:px-7 sm:py-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(96,165,250,0.22),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(45,212,191,0.14),transparent_34%)]" />
        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="grid gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge className={cn("border-white/0", summaryBadgeTone(latestNight.recoveryState))}>
                {latestNight.qualitativeState}
              </Badge>
              <Badge tone="meta">{latestNight.sourceTimezone}</Badge>
              {latestNight.hasReflection ? (
                <Badge tone="meta">Has reflection</Badge>
              ) : null}
              {latestNight.hasRawSegments ? (
                <Badge tone="meta">{latestNight.rawSegmentCount} raw segments</Badge>
              ) : null}
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/42">
                Last night
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                <div className="text-[clamp(2.5rem,6vw,5rem)] font-medium leading-none text-white">
                  {formatDurationCompact(latestNight.asleepSeconds)}
                </div>
                <div className="pb-2 text-sm text-white/58">
                  asleep across {formatSleepWindow(latestNight.startedAt, latestNight.endedAt, latestNight.sourceTimezone)}
                </div>
              </div>
              <div className="mt-3 text-sm text-white/64">
                {formatDateLabel(latestNight.endedAt, latestNight.sourceTimezone)}
              </div>
              {latestNight.qualitySummary ? (
                <div className="mt-4 max-w-2xl text-sm leading-6 text-white/72">
                  {latestNight.qualitySummary}
                </div>
              ) : (
                <div className="mt-4 max-w-2xl text-sm leading-6 text-white/56">
                  Canonical overnight summary computed from synced sleep segments, with raw evidence still available underneath.
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/40">In bed</div>
                <div className="mt-2 text-xl text-white">
                  {formatDurationCompact(latestNight.timeInBedSeconds)}
                </div>
              </div>
              <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/40">Score</div>
                <div className="mt-2 text-xl text-white">{latestNight.score ?? "n/a"}</div>
              </div>
              <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/40">Regularity</div>
                <div className="mt-2 text-xl text-white">{latestNight.regularity ?? "n/a"}</div>
              </div>
              <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/40">Efficiency</div>
                <div className="mt-2 text-xl text-white">{formatPercent(latestNight.efficiency)}</div>
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[22px] border border-white/8 bg-black/20 px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-white/40">
                    Baseline
                  </div>
                  <div className="mt-2 text-lg text-white">Compared with recent nights</div>
                </div>
                <MoonStar className="size-5 text-[var(--primary)]" />
              </div>
              <div className="mt-4 grid gap-3">
                <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.04] px-4 py-3">
                  <span className="text-sm text-white/60">7-night average</span>
                  <span className="text-sm text-white">
                    {formatDurationCompact(latestNight.weeklyAverageSleepSeconds)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.04] px-4 py-3">
                  <span className="text-sm text-white/60">Versus baseline</span>
                  <span className={cn("text-sm", percentChangeTone(latestNight.deltaFromWeeklyAverageSeconds))}>
                    {formatSignedMinutesFromSeconds(latestNight.deltaFromWeeklyAverageSeconds)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.04] px-4 py-3">
                  <span className="text-sm text-white/60">Bedtime drift</span>
                  <span className="text-sm text-white">
                    {latestNight.bedtimeDriftMinutes ?? 0}m
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.04] px-4 py-3">
                  <span className="text-sm text-white/60">Wake drift</span>
                  <span className="text-sm text-white">
                    {latestNight.wakeDriftMinutes ?? 0}m
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.04] px-4 py-3">
                  <span className="text-sm text-white/60">Restorative share</span>
                  <span className="text-sm text-white">
                    {formatPercent(latestNight.restorativeShare)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-[22px] border border-white/8 bg-black/20 px-5 py-5">
              <div className="text-xs uppercase tracking-[0.18em] text-white/40">
                Stage composition
              </div>
              <div className="mt-4">
                <StageDistributionBar stages={latestNight.stageBreakdown} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function WeekBaselineCard({
  title,
  value,
  description
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card className="h-full border-white/8 bg-white/[0.03]">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">{title}</div>
      <div className="mt-3 text-3xl text-white">{value}</div>
      <div className="mt-3 text-sm leading-6 text-white/56">{description}</div>
    </Card>
  );
}

function SleepCalendar({
  days,
  selectedSleepId,
  onSelect
}: {
  days: SleepCalendarDay[];
  selectedSleepId: string | null;
  onSelect: (sleepId: string, monthKey: string) => void;
}) {
  const monthKeys = useMemo(
    () =>
      Array.from(new Set(days.map((day) => day.dateKey.slice(0, 7)))).sort(
        (left, right) => left.localeCompare(right)
      ),
    [days]
  );
  const [monthKey, setMonthKey] = useState<string>(monthKeys[monthKeys.length - 1] ?? "");

  useEffect(() => {
    if (monthKeys.length === 0) {
      setMonthKey("");
      return;
    }
    if (!monthKeys.includes(monthKey)) {
      setMonthKey(monthKeys[monthKeys.length - 1] ?? "");
    }
  }, [monthKey, monthKeys]);

  const monthIndex = monthKeys.indexOf(monthKey);
  const cells = useMemo(() => buildMonthGrid(monthKey, days), [days, monthKey]);

  if (!monthKey) {
    return (
      <Card className="border-white/8 bg-white/[0.03] px-5 py-8 text-sm leading-6 text-white/56">
        No canonical nights are available for the calendar yet.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-white/8 bg-[linear-gradient(180deg,rgba(10,17,33,0.98),rgba(12,20,40,0.96))] p-0">
      <div className="grid gap-5 px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
              Sleep calendar
            </div>
            <div className="mt-2 text-xl text-white">{formatMonthLabel(monthKey)}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-9 rounded-full"
              disabled={monthIndex <= 0}
              onClick={() => setMonthKey(monthKeys[Math.max(0, monthIndex - 1)] ?? monthKey)}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-9 rounded-full"
              disabled={monthIndex === -1 || monthIndex >= monthKeys.length - 1}
              onClick={() =>
                setMonthKey(
                  monthKeys[Math.min(monthKeys.length - 1, monthIndex + 1)] ?? monthKey
                )
              }
            >
              Next
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-2 text-center text-[11px] uppercase tracking-[0.16em] text-white/38">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label}>{label}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-2">
          {cells.map((cell) => {
            const sleep = cell.sleep;
            const isSelected = sleep?.sleepId === selectedSleepId;
            const scoreTone =
              sleep && typeof sleep.score === "number"
                ? sleep.score >= 80
                  ? "rgba(45,212,191,0.22)"
                  : sleep.score >= 65
                    ? "rgba(96,165,250,0.22)"
                    : "rgba(251,191,36,0.18)"
                : "rgba(255,255,255,0.04)";
            return (
              <button
                key={cell.dateKey}
                type="button"
                disabled={!sleep}
                aria-pressed={isSelected}
                aria-label={`Select sleep for ${cell.dateKey}`}
                onClick={() => {
                  if (!sleep) {
                    return;
                  }
                  setMonthKey(sleep.dateKey.slice(0, 7));
                  onSelect(sleep.sleepId, sleep.dateKey.slice(0, 7));
                }}
                className={cn(
                  "min-h-[90px] rounded-[18px] border px-2 py-2 text-left transition",
                  sleep
                    ? "border-white/10 hover:border-white/22 hover:bg-white/[0.05]"
                    : "border-white/6 bg-white/[0.02]",
                  isSelected && "border-[var(--primary)] bg-[var(--primary)]/12",
                  cell.outsideMonth && !sleep && "opacity-35"
                )}
                style={sleep ? { background: `linear-gradient(180deg, ${scoreTone}, rgba(255,255,255,0.03))` } : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={cn("text-sm", cell.outsideMonth ? "text-white/40" : "text-white/82")}>
                    {cell.dayNumber}
                  </span>
                  {sleep?.hasReflection ? <span className="size-2 rounded-full bg-emerald-300" /> : null}
                </div>
                {sleep ? (
                  <div className="mt-4 grid gap-1">
                    <div className="text-lg text-white">{sleep.sleepHours.toFixed(1)}h</div>
                    <div className="text-xs text-white/52">
                      {sleep.score ?? "n/a"} score
                    </div>
                    <div className="text-xs text-white/40">
                      {sleep.hasRawSegments ? "phases available" : "summary only"}
                    </div>
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function DetailTabButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-4 py-2 text-sm transition",
        active
          ? "border-[var(--primary)] bg-[var(--primary)]/12 text-white"
          : "border-white/8 bg-white/[0.03] text-white/60 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

function SleepDetailPanel({
  session,
  draft,
  rawDetail,
  rawDetailLoading,
  pending,
  tab,
  linkOptions,
  onTabChange,
  onDraftChange,
  onSave
}: {
  session: SleepSessionRecord;
  draft: SleepDraft;
  rawDetail: SleepSessionDetailPayload | null;
  rawDetailLoading: boolean;
  pending: boolean;
  tab: "summary" | "reflection" | "raw";
  linkOptions: ReturnType<typeof buildHealthEntityLinkOptions>;
  onTabChange: (tab: "summary" | "reflection" | "raw") => void;
  onDraftChange: (patch: Partial<SleepDraft>) => void;
  onSave: () => void;
}) {
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const normalizedRawDetail = useMemo(() => normalizeRawDetail(rawDetail), [rawDetail]);
  const efficiency =
    typeof session.derived.efficiency === "number"
      ? session.derived.efficiency
      : session.timeInBedSeconds > 0
        ? session.asleepSeconds / session.timeInBedSeconds
        : 0;
  const restorativeShare =
    typeof session.derived.restorativeShare === "number"
      ? session.derived.restorativeShare
      : 0;
  const recoveryState =
    typeof session.derived.recoveryState === "string"
      ? session.derived.recoveryState
      : null;

  return (
    <Card className="overflow-hidden border-white/8 bg-[linear-gradient(180deg,rgba(10,17,33,0.98),rgba(13,20,38,0.96))] p-0">
      <div className="grid gap-5 px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn("border-white/0", summaryBadgeTone(recoveryState))}>
                {recoveryState ? recoveryState.replaceAll("_", " ") : "Canonical night"}
              </Badge>
              <Badge tone="meta">{session.rawSegmentCount} raw segments</Badge>
              <Badge tone="meta">{session.sourceTimezone}</Badge>
            </div>
            <div className="mt-3 text-[11px] uppercase tracking-[0.18em] text-white/42">
              Selected night
            </div>
            <div className="mt-2 text-2xl text-white">
              {formatDateLabel(session.endedAt, session.sourceTimezone)}
            </div>
            <div className="mt-2 text-sm text-white/56">
              {formatSleepWindow(session.startedAt, session.endedAt, session.sourceTimezone)}
            </div>
          </div>
          <div className="grid gap-2 text-right">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
              Summary
            </div>
            <div className="text-3xl text-white">{formatDurationCompact(session.asleepSeconds)}</div>
            <div className="text-sm text-white/54">asleep</div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-4">
            <div className="text-xs uppercase tracking-[0.18em] text-white/40">In bed</div>
            <div className="mt-2 text-xl text-white">
              {formatDurationCompact(session.timeInBedSeconds)}
            </div>
          </div>
          <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-4">
            <div className="text-xs uppercase tracking-[0.18em] text-white/40">Awake</div>
            <div className="mt-2 text-xl text-white">
              {formatDurationCompact(session.awakeSeconds)}
            </div>
          </div>
          <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-4">
            <div className="text-xs uppercase tracking-[0.18em] text-white/40">Efficiency</div>
            <div className="mt-2 text-xl text-white">{formatPercent(efficiency)}</div>
          </div>
          <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-4">
            <div className="text-xs uppercase tracking-[0.18em] text-white/40">Restorative</div>
            <div className="mt-2 text-xl text-white">{formatPercent(restorativeShare)}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DetailTabButton active={tab === "summary"} onClick={() => onTabChange("summary")}>
            Summary
          </DetailTabButton>
          <DetailTabButton
            active={tab === "reflection"}
            onClick={() => onTabChange("reflection")}
          >
            Reflection
          </DetailTabButton>
          <DetailTabButton active={tab === "raw"} onClick={() => onTabChange("raw")}>
            Show raw data
          </DetailTabButton>
        </div>

        {tab === "summary" ? (
          <div className="grid gap-5">
            <div className="rounded-[22px] border border-white/8 bg-black/18 px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                Phase timeline
              </div>
              <div className="mt-4">
                {rawDetailLoading ? (
                  <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-6 text-sm text-white/56">
                    Loading phase timing from raw sleep segments…
                  </div>
                ) : (
                  <SleepPhaseTimeline
                    timeline={
                      rawDetail?.phaseTimeline ?? {
                        startedAt: session.startedAt,
                        endedAt: session.endedAt,
                        totalSeconds: Math.max(
                          0,
                          Math.round(
                            (new Date(session.endedAt).getTime() -
                              new Date(session.startedAt).getTime()) /
                              1000
                          )
                        ),
                        hasRawSegments: false,
                        hasSleepStageData: false,
                        blocks: []
                      }
                    }
                    timeZone={session.sourceTimezone}
                  />
                )}
              </div>
            </div>

            <div className="rounded-[22px] border border-white/8 bg-black/18 px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                Stage composition
              </div>
              <div className="mt-4">
                <StageDistributionBar stages={session.stageBreakdown} />
              </div>
            </div>
          </div>
        ) : null}

        {tab === "reflection" ? (
          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Quality summary</span>
              <Input
                value={draft.qualitySummary}
                onChange={(event) =>
                  onDraftChange({ qualitySummary: event.target.value })
                }
                placeholder="Recovered after a late evening, but sleep onset drifted."
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Night notes</span>
              <Textarea
                className="min-h-[200px]"
                value={draft.notes}
                onChange={(event) => onDraftChange({ notes: event.target.value })}
                placeholder="What shaped this night, and what should we remember about it?"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Tags</span>
              <Input
                value={draft.tagsText}
                onChange={(event) => onDraftChange({ tagsText: event.target.value })}
                placeholder="travel, stress, good-routine, late-caffeine"
              />
            </label>
            <div className="grid gap-2">
              <span className="text-sm text-white/58">Linked context</span>
              <EntityLinkMultiSelect
                options={linkOptions}
                selectedValues={draft.linkValues}
                onChange={(linkValues) => onDraftChange({ linkValues })}
                placeholder="Search goals, tasks, habits, beliefs, reports, or patterns…"
              />
            </div>
            <div className="flex justify-end">
              <Button type="button" pending={pending} pendingLabel="Saving" onClick={onSave}>
                <Save className="size-4" />
                Save reflection
              </Button>
            </div>
          </div>
        ) : null}

        {tab === "raw" ? (
          <div className="grid gap-5">
            <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-4 text-sm leading-6 text-white/56">
              Forge shows the canonical overnight session by default. This view reveals the evidence stack underneath it: raw provider or historical imported records first, then Forge-normalized sleep segments.
            </div>

            {rawDetailLoading ? (
              <div className="text-sm text-white/56">Loading raw sleep evidence…</div>
            ) : null}

            {!rawDetailLoading ? (
              <div className="grid gap-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={cn("border-white/0", rawStatusTone(normalizedRawDetail.rawDataStatus))}>
                    {rawStatusLabel(normalizedRawDetail.rawDataStatus)}
                  </Badge>
                  {normalizedRawDetail.rawDataStatus === "historical_raw" ? (
                    <Badge tone="meta">Partial evidence</Badge>
                  ) : null}
                </div>

                <div className="grid gap-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                    Raw data
                  </div>
                  {normalizedRawDetail.sourceRecords.length ? (
                    normalizedRawDetail.sourceRecords.map((record) => (
                      <div
                        key={record.id}
                        className="rounded-[16px] border border-white/8 bg-black/18 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={cn("border-white/0", sourceRecordTone(record))}>
                              {record.qualityKind === "provider_native"
                                ? "Provider raw"
                                : "Historical raw"}
                            </Badge>
                            <Badge tone="meta" className="capitalize">
                              {record.rawStage.replaceAll("_", " ")}
                            </Badge>
                            <span className="text-sm text-white/64">
                              {formatSleepWindow(
                                record.startedAt,
                                record.endedAt,
                                record.sourceTimezone
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-white/42">
                              {record.providerRecordType.replaceAll("_", " ")}
                            </span>
                            <Button
                              type="button"
                              variant="secondary"
                              className="h-8 rounded-full px-3"
                              onClick={() =>
                                setExpandedRecordId((current) =>
                                  current === record.id ? null : record.id
                                )
                              }
                            >
                              {expandedRecordId === record.id ? "Hide JSON" : "See JSON"}
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 text-sm text-white/50">
                          {formatDurationCompact(
                            Math.max(
                              0,
                              Math.round(
                                (new Date(record.endedAt).getTime() -
                                  new Date(record.startedAt).getTime()) /
                                  1000
                              )
                            )
                          )}
                        </div>
                        {expandedRecordId === record.id ? (
                          <pre className="mt-3 overflow-x-auto rounded-[14px] border border-white/8 bg-slate-950/70 p-3 text-xs leading-6 text-white/72">
                            {JSON.stringify(
                              {
                                payload: record.payload,
                                metadata: record.metadata
                              },
                              null,
                              2
                            )}
                          </pre>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[16px] border border-dashed border-white/10 bg-black/10 px-4 py-4 text-sm text-white/52">
                      No raw data was stored for this night.
                    </div>
                  )}
                </div>

                <div className="grid gap-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                    Sleep segments
                  </div>
                  {normalizedRawDetail.segments.length ? (
                    normalizedRawDetail.segments.map((segment) => (
                      <div
                        key={segment.id}
                        className="rounded-[16px] border border-white/8 bg-black/18 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone="meta" className="capitalize">
                              {segment.stage.replaceAll("_", " ")}
                            </Badge>
                            <Badge tone="meta">
                              {segment.qualityKind === "provider_native"
                                ? "provider-backed"
                                : "historical"}
                            </Badge>
                            <span className="text-sm text-white/64">
                              {formatSleepWindow(
                                segment.startedAt,
                                segment.endedAt,
                                segment.sourceTimezone
                              )}
                            </span>
                          </div>
                          <span className="text-sm text-white/50">
                            {formatDurationCompact(
                              Math.max(
                                0,
                                Math.round(
                                  (new Date(segment.endedAt).getTime() -
                                    new Date(segment.startedAt).getTime()) /
                                    1000
                                )
                              )
                            )}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[16px] border border-dashed border-white/10 bg-black/10 px-4 py-4 text-sm text-white/52">
                      No normalized sleep segments were stored for this night.
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function SleepPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, SleepDraft>>({});
  const [selectedSleepId, setSelectedSleepId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"summary" | "reflection" | "raw">(
    "summary"
  );
  const selectedUserIds = Array.isArray(shell?.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const shellSnapshot = shell?.snapshot;

  const sleepQuery = useQuery({
    queryKey: ["forge-sleep", ...selectedUserIds],
    queryFn: async () => (await getSleepView(selectedUserIds)).sleep
  });
  const rawDetailQuery = useQuery({
    queryKey: ["forge-sleep-raw", selectedSleepId],
    enabled: Boolean(selectedSleepId),
    queryFn: async () => getSleepSessionRawDetail(selectedSleepId!)
  });
  const valuesQuery = useQuery({
    queryKey: ["forge-sleep-values", ...selectedUserIds],
    queryFn: async () => (await listPsycheValues(selectedUserIds)).values
  });
  const patternsQuery = useQuery({
    queryKey: ["forge-sleep-patterns", ...selectedUserIds],
    queryFn: async () => (await listBehaviorPatterns(selectedUserIds)).patterns
  });
  const behaviorsQuery = useQuery({
    queryKey: ["forge-sleep-behaviors", ...selectedUserIds],
    queryFn: async () => (await listBehaviors(selectedUserIds)).behaviors
  });
  const beliefsQuery = useQuery({
    queryKey: ["forge-sleep-beliefs", ...selectedUserIds],
    queryFn: async () => (await listBeliefs(selectedUserIds)).beliefs
  });
  const reportsQuery = useQuery({
    queryKey: ["forge-sleep-reports", ...selectedUserIds],
    queryFn: async () => (await listTriggerReports(selectedUserIds)).reports
  });

  useEffect(() => {
    if (!sleepQuery.data) {
      return;
    }
    setDrafts(
      Object.fromEntries(
        sleepQuery.data.sessions.map((session) => [session.id, buildSleepDraft(session)])
      )
    );
  }, [sleepQuery.data]);

  useEffect(() => {
    if (!sleepQuery.data?.sessions.length) {
      setSelectedSleepId(null);
      return;
    }
    const hasSelection = sleepQuery.data.sessions.some(
      (session) => session.id === selectedSleepId
    );
    if (hasSelection) {
      return;
    }
    setSelectedSleepId(
      sleepQuery.data.latestNight?.sleepId ?? sleepQuery.data.sessions[0]?.id ?? null
    );
  }, [selectedSleepId, sleepQuery.data]);

  useEffect(() => {
    setDetailTab("summary");
  }, [selectedSleepId]);

  const saveMutation = useMutation({
    mutationFn: async (input: {
      sleepId: string;
      qualitySummary: string;
      notes: string;
      tagsText: string;
      linkValues: string[];
    }) =>
      patchSleepSession(input.sleepId, {
        qualitySummary: input.qualitySummary,
        notes: input.notes,
        tags: input.tagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        links: parseHealthLinkValues(input.linkValues)
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-sleep"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-sleep-raw"] });
    }
  });

  if (sleepQuery.isLoading) {
    return (
      <SurfaceSkeleton
        eyebrow="Sleep"
        title="Loading sleep surface"
        description="Reading canonical nights, calendar summaries, and sleep phase detail."
        columns={2}
        blocks={6}
      />
    );
  }

  if (sleepQuery.isError || !sleepQuery.data) {
    return (
      <ErrorState
        eyebrow="Sleep"
        error={sleepQuery.error ?? new Error("Sleep data unavailable")}
        onRetry={() => void sleepQuery.refetch()}
      />
    );
  }

  const sleep = sleepQuery.data;
  const sessions = sleep.sessions;
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const activeSession =
    (selectedSleepId ? sessionById.get(selectedSleepId) : null) ??
    (sleep.latestNight ? sessionById.get(sleep.latestNight.sleepId) : null) ??
    sessions[0] ??
    null;
  const activeDraft = activeSession
    ? drafts[activeSession.id] ?? buildSleepDraft(activeSession)
    : null;

  const linkOptions = buildHealthEntityLinkOptions({
    goals: shellSnapshot?.dashboard.goals ?? [],
    projects: shellSnapshot?.dashboard.projects ?? [],
    tasks: shellSnapshot?.dashboard.tasks ?? [],
    habits: shellSnapshot?.dashboard.habits ?? [],
    values: valuesQuery.data ?? [],
    patterns: patternsQuery.data ?? [],
    behaviors: behaviorsQuery.data ?? [],
    beliefs: beliefsQuery.data ?? [],
    reports: reportsQuery.data ?? []
  });

  function patchDraft(sessionId: string, patch: Partial<SleepDraft>) {
    setDrafts((current) => {
      const session = sessions.find((entry) => entry.id === sessionId);
      const base =
        current[sessionId] ??
        (session
          ? buildSleepDraft(session)
          : {
              qualitySummary: "",
              notes: "",
              tagsText: "",
              linkValues: []
            });
      return {
        ...current,
        [sessionId]: {
          ...base,
          ...patch
        }
      };
    });
  }

  async function saveSleep(sleepId: string) {
    const session = sessions.find((entry) => entry.id === sleepId);
    if (!session) {
      return;
    }
    const draft = drafts[sleepId] ?? buildSleepDraft(session);
    await saveMutation.mutateAsync({
      sleepId,
      qualitySummary: draft.qualitySummary,
      notes: draft.notes,
      tagsText: draft.tagsText,
      linkValues: draft.linkValues
    });
  }

  return (
    <div className="grid gap-5">
      <PageHero
        eyebrow="Health"
        title="Sleep"
        description="Canonical overnight sessions first, with last-night recovery, a clickable night calendar, and raw segment evidence only when you ask for it."
        badge={`${sessions.length} nights`}
      />

      <PsycheSectionNav />

      <SleepSummaryBox>
        <LastNightHero latestNight={sleep.latestNight} />
      </SleepSummaryBox>

      <SleepPatternsBox>
        <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <WeekBaselineCard
            title="Weekly average"
            value={formatDurationCompact(sleep.summary.averageSleepSeconds)}
            description="Average overnight sleep duration across the recent week, used as the baseline for the latest-night comparison."
          />
          <WeekBaselineCard
            title="Regularity"
            value={`${sleep.summary.averageRegularityScore}`}
            description={`Average bedtime drift ${sleep.summary.averageBedtimeConsistencyMinutes}m and wake drift ${sleep.summary.averageWakeConsistencyMinutes}m.`}
          />
          <WeekBaselineCard
            title="Restorative share"
            value={formatPercent(sleep.summary.averageRestorativeShare)}
            description={`Deep + REM share across recent nights, with ${sleep.summary.reflectiveNightCount} nights already carrying context.`}
          />
          <Card className="border-white/8 bg-white/[0.03]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                  Recent stage mix
                </div>
                <div className="mt-2 text-xl text-white">Average nightly phases</div>
              </div>
              <CalendarDays className="size-5 text-[var(--primary)]" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {sleep.stageAverages.length > 0 ? (
                sleep.stageAverages.slice(0, 5).map((stage) => (
                  <Badge key={stage.stage} tone="meta">
                    {stageMeta(stage.stage).label} {formatDurationCompact(stage.averageSeconds)}
                  </Badge>
                ))
              ) : (
                <div className="text-sm text-white/52">
                  Stage averages will appear once nights include phase data.
                </div>
              )}
            </div>
          </Card>
        </section>
      </SleepPatternsBox>

      <SleepBrowserBox>
        <section className="grid gap-4 xl:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
          <SleepCalendar
            days={sleep.calendarDays}
            selectedSleepId={activeSession?.id ?? null}
            onSelect={(sleepId) => setSelectedSleepId(sleepId)}
          />

          {activeSession && activeDraft ? (
            <SleepDetailPanel
              session={activeSession}
              draft={activeDraft}
              rawDetail={rawDetailQuery.data ?? null}
              rawDetailLoading={rawDetailQuery.isLoading}
              pending={
                saveMutation.isPending &&
                saveMutation.variables?.sleepId === activeSession.id
              }
              tab={detailTab}
              linkOptions={linkOptions}
              onTabChange={setDetailTab}
              onDraftChange={(patch) => patchDraft(activeSession.id, patch)}
              onSave={() => void saveSleep(activeSession.id)}
            />
          ) : (
            <Card className="border-white/8 bg-white/[0.03] px-6 py-8 text-sm leading-6 text-white/58">
              Pick a night from the calendar to inspect its phase timing, stage summary, and reflection context.
            </Card>
          )}
        </section>
      </SleepBrowserBox>
    </div>
  );
}
