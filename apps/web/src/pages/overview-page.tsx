import { AiSurfaceWorkspace } from "@/components/customization/ai-surface-workspace";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { type SurfaceWidgetDefinition } from "@/components/customization/editable-surface";
import {
  MiniCalendarWidget,
  QuickCaptureWidget,
  SpotifyWidget,
  TimeWidget,
  WeatherWidget
} from "@/components/customization/utility-widgets";
import { FlagshipSignalDeck } from "@/components/experience/flagship-signal-deck";
import { GamificationOverviewWidget } from "@/components/gamification/gamification-widgets";
import { LifeForceOverviewWorkspace } from "@/components/life-force/life-force-workspace";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { EmptyState } from "@/components/ui/page-state";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import {
  getFitnessView,
  getMovementDay,
  getSleepView,
  getVitalsView
} from "@/lib/api";
import { useGetXpMetricsQuery } from "@/store/api/forge-api";
import {
  getReadableActivityDescription,
  getReadableActivityTitle
} from "@/lib/activity-copy";
import {
  formatLifeForceAp,
  formatLifeForceRate
} from "@/lib/life-force-display";
import { getEntityNotesSummary } from "@/lib/note-helpers";
import { useI18n } from "@/lib/i18n";
import type {
  MovementDayData,
  VitalsViewData
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { normalizeOverviewLayout } from "@/pages/overview-layout";

const OVERVIEW_METRIC_HELP: Record<string, string> = {
  "Life Force":
    "Life Force compares today's spent Action Points with the modeled daily budget. It is Forge's local capacity planning layer, not a medical score.",
  Momentum:
    "Momentum summarizes recent execution, XP, streak context, and movement across Forge records. Use it as an attention signal.",
  Instant:
    "Instant AP/hour estimates current headroom from the Life Force drain model. Higher values mean Forge thinks the next block can absorb more effort.",
  Level:
    "Level comes from the XP ledger. It represents accumulated meaningful Forge activity for the selected user scope.",
  "Weekly XP":
    "Weekly XP is recent reward-ledger movement. It helps separate a genuinely active week from old accumulated progress."
};

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCompactDuration(seconds: number) {
  if (seconds >= 3_600) {
    const hours = seconds / 3_600;
    if (hours >= 10 || Number.isInteger(hours)) {
      return `${Math.round(hours)}h`;
    }
    return `${hours.toFixed(1)}h`;
  }
  return `${Math.max(1, Math.round(seconds / 60))}m`;
}

function formatCompactDistance(distanceMeters: number) {
  if (distanceMeters >= 1_000) {
    return `${(distanceMeters / 1_000).toFixed(1)} km`;
  }
  return `${Math.round(distanceMeters)} m`;
}

function buildMovementPlaceBreakdown(day: MovementDayData | undefined) {
  if (!day) {
    return [];
  }
  const totals = new Map<string, number>();
  for (const segment of day.segments) {
    if (segment.kind !== "stay" || segment.durationSeconds <= 0) {
      continue;
    }
    const label = segment.label.trim() || "Unlabeled stay";
    totals.set(label, (totals.get(label) ?? 0) + segment.durationSeconds);
  }
  return [...totals.entries()]
    .map(([label, seconds]) => ({ label, seconds }))
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, 3);
}

function buildVitalsHighlightRows(vitals: VitalsViewData | undefined) {
  if (!vitals) {
    return [];
  }
  const desiredMetrics = [
    "restingHeartRate",
    "heartRateVariabilitySDNN",
    "vo2Max",
    "oxygenSaturation"
  ] as const;
  return desiredMetrics
    .map((key) => vitals.metrics.find((metric) => metric.metric === key))
    .filter((metric): metric is VitalsViewData["metrics"][number] =>
      Boolean(metric)
    )
    .slice(0, 3);
}

function formatVitalOverviewValue(metric: VitalsViewData["metrics"][number]) {
  if (metric.latestValue == null) {
    return "No reading";
  }
  const digits =
    metric.unit === "steps" ||
    metric.unit === "flights" ||
    metric.unit === "kcal" ||
    metric.unit === "min"
      ? 0
      : 1;
  return `${metric.latestValue.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits === 0 ? 0 : metric.latestValue >= 100 ? 0 : 1
  })} ${metric.unit}`;
}

export function OverviewPage() {
  const { t } = useI18n();
  const shell = useForgeShell();
  const snapshot = shell.snapshot;
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const selectedScopeKey = selectedUserIds.join("|");
  const [enableOverviewSideData, setEnableOverviewSideData] = useState(false);

  useEffect(() => {
    setEnableOverviewSideData(false);
    const timer = window.setTimeout(() => {
      setEnableOverviewSideData(true);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [selectedScopeKey]);

  const todayDateKey = localDateKey();
  const sleepQuery =
    useQuery({
      queryKey: ["forge-overview-sleep", ...selectedUserIds],
      queryFn: async () => (await getSleepView(selectedUserIds)).sleep,
      enabled: enableOverviewSideData,
      staleTime: 60_000
    }) ?? {};
  const fitnessQuery =
    useQuery({
      queryKey: ["forge-overview-fitness", ...selectedUserIds],
      queryFn: async () =>
        (await getFitnessView(selectedUserIds, { compact: true })).fitness,
      enabled: enableOverviewSideData,
      staleTime: 60_000
    }) ?? {};
  const movementDayQuery =
    useQuery({
      queryKey: [
        "forge-overview-movement-day",
        todayDateKey,
        ...selectedUserIds
      ],
      queryFn: async () =>
        (
          await getMovementDay({
            date: todayDateKey,
            userIds: selectedUserIds
          })
        ).movement,
      enabled: enableOverviewSideData,
      staleTime: 60_000
    }) ?? {};
  const vitalsQuery =
    useQuery({
      queryKey: ["forge-overview-vitals", ...selectedUserIds],
      queryFn: async () => (await getVitalsView(selectedUserIds)).vitals,
      enabled: enableOverviewSideData,
      staleTime: 60_000
    }) ?? {};
  const xpMetricsQuery = useGetXpMetricsQuery(selectedUserIds, {
    skip: !enableOverviewSideData
  });
  const nextMilestone =
    snapshot.dashboard.milestoneRewards.find((reward) => !reward.completed) ??
    snapshot.dashboard.milestoneRewards[0] ??
    null;
  const topTask = snapshot.overview.topTasks[0] ?? null;
  const topHabit = snapshot.overview.dueHabits[0] ?? null;
  const latestEvidence = snapshot.overview.recentEvidence[0] ?? null;
  const projectLookup = new Map(
    snapshot.projects.map((project) => [project.id, project])
  );
  const heroStatus =
    snapshot.metrics.momentumScore >= 80
      ? "Strong"
      : snapshot.metrics.momentumScore >= 60
        ? "Steady"
        : "Needs attention";
  const sleepSummary = sleepQuery.data?.summary ?? null;
  const fitnessSummary = fitnessQuery.data?.summary ?? null;
  const movementDay = movementDayQuery.data;
  const vitalsSummary = vitalsQuery.data ?? null;
  const vitalsHighlightRows = buildVitalsHighlightRows(
    vitalsSummary ?? undefined
  );
  const movementPlaceBreakdown = buildMovementPlaceBreakdown(movementDay);
  const hasHealthData =
    sleepSummary !== null || fitnessSummary !== null || vitalsSummary !== null;
  const hasMovementData =
    movementDay !== undefined &&
    (movementDay.summary.tripCount > 0 ||
      movementDay.summary.stayCount > 0 ||
      movementDay.summary.totalMovingSeconds > 0 ||
      movementPlaceBreakdown.length > 0);
  const hasGamificationData = true;
  const hasOverviewData =
    hasGamificationData ||
    snapshot.lifeForce !== undefined ||
    snapshot.overview.activeGoals.length > 0 ||
    snapshot.overview.projects.length > 0 ||
    snapshot.overview.topTasks.length > 0 ||
    snapshot.overview.recentEvidence.length > 0 ||
    snapshot.overview.dueHabits.length > 0 ||
    snapshot.overview.neglectedGoals.length > 0 ||
    sleepQuery.isLoading ||
    fitnessQuery.isLoading ||
    movementDayQuery.isLoading ||
    vitalsQuery.isLoading ||
    hasHealthData ||
    hasMovementData;
  const summaryMetrics = snapshot.lifeForce
    ? [
        {
          label: "Life Force",
          value: `${Math.round(snapshot.lifeForce.spentTodayAp)} / ${Math.round(snapshot.lifeForce.dailyBudgetAp)} AP`,
          detail: `Remaining ${formatLifeForceAp(snapshot.lifeForce.remainingAp)}`,
          help: OVERVIEW_METRIC_HELP["Life Force"]
        },
        {
          label: "Momentum",
          value: `${snapshot.metrics.momentumScore}`,
          detail: `${heroStatus} · ${snapshot.metrics.streakDays} day streak`,
          help: OVERVIEW_METRIC_HELP.Momentum
        },
        {
          label: "Instant",
          value: formatLifeForceRate(snapshot.lifeForce.instantFreeApPerHour),
          detail:
            snapshot.lifeForce.overloadApPerHour > 0
              ? `${formatLifeForceRate(snapshot.lifeForce.overloadApPerHour)} overload`
              : "Headroom right now",
          help: OVERVIEW_METRIC_HELP.Instant
        },
        {
          label: "Level",
          value: `L${snapshot.metrics.level}`,
          detail: `${snapshot.metrics.currentLevelXp} XP in level`,
          help: OVERVIEW_METRIC_HELP.Level
        },
        {
          label: "Weekly XP",
          value: `${snapshot.metrics.weeklyXp}`,
          detail: `${snapshot.metrics.totalXp} total XP`,
          help: OVERVIEW_METRIC_HELP["Weekly XP"]
        }
      ]
    : [
        {
          label: "Level",
          value: `L${snapshot.metrics.level}`,
          detail: `${snapshot.metrics.currentLevelXp} XP in level`,
          help: OVERVIEW_METRIC_HELP.Level
        },
        {
          label: "Weekly XP",
          value: `${snapshot.metrics.weeklyXp}`,
          detail: `${snapshot.metrics.totalXp} total XP`,
          help: OVERVIEW_METRIC_HELP["Weekly XP"]
        },
        {
          label: "Momentum",
          value: `${snapshot.metrics.momentumScore}`,
          detail: `${heroStatus} · ${snapshot.metrics.streakDays} day streak`,
          help: OVERVIEW_METRIC_HELP.Momentum
        }
      ];

  function activityLink(
    event: (typeof snapshot.overview.recentEvidence)[number]
  ) {
    if (event.entityType === "goal") {
      return `/goals/${event.entityId}`;
    }
    if (event.entityType === "project") {
      return `/projects/${event.entityId}`;
    }
    if (event.entityType === "task") {
      return `/tasks/${event.entityId}`;
    }
    if (event.entityType === "habit") {
      return "/habits";
    }
    if (
      event.entityType === "task_run" &&
      typeof event.metadata.taskId === "string"
    ) {
      return `/tasks/${event.metadata.taskId}`;
    }
    return `/activity?eventId=${event.id}`;
  }

  if (!hasOverviewData) {
    return (
      <div className="grid min-w-0 gap-4">
        <PageHero
          title="Overview"
          titleText="Overview"
          description="See your main goals, active projects, top tasks, and recent activity in one place."
          badge="0 live signals"
        />
        <EmptyState
          eyebrow={t("common.overview.heroEyebrow")}
          title={t("common.overview.emptyTitle")}
          description={t("common.overview.emptyDescription")}
          action={
            <Link
              to="/goals"
              className="inline-flex min-h-10 min-w-0 max-w-full items-center justify-center rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium whitespace-nowrap text-[var(--ui-ink-on-accent)] transition hover:opacity-90"
            >
              {t("common.overview.emptyAction")}
            </Link>
          }
        />
      </div>
    );
  }

  const widgets: SurfaceWidgetDefinition[] = [
    {
      id: "hero",
      title: "Overview",
      description:
        "The route header stays movable like any other surface block.",
      defaultWidth: 12,
      defaultHeight: 2,
      removable: false,
      minHeight: 2,
      maxHeight: 3,
      surfaceChrome: "none",
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () => (
        <PageHero
          title="Overview"
          titleText="Overview"
          description={`${heroStatus}. Current capacity, progress, goals, work, health, and movement.`}
          badge={`Momentum ${snapshot.metrics.momentumScore}`}
        />
      )
    },
    {
      id: "gamification",
      title: "Forge Smith",
      description: "Selected-user level, XP, streak, trophy, and unlock state.",
      defaultWidth: 12,
      defaultHeight: 4,
      defaultHidden: true,
      minHeight: 3,
      surfaceChrome: "none",
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: ({ compact }) =>
        xpMetricsQuery.data ? (
          <GamificationOverviewWidget
            metrics={xpMetricsQuery.data.metrics}
            compact={compact}
          />
        ) : (
          <GamificationOverviewWidget
            metrics={{
              scope: {
                mode: "operator_fallback",
                userIds: snapshot.userScope.selectedUserIds,
                users: snapshot.userScope.selectedUsers,
                label:
                  snapshot.userScope.selectedUsers[0]?.displayName ?? "Forge"
              },
              profile: snapshot.metrics,
              achievements: [],
              milestoneRewards: [],
              momentumPulse: {
                status:
                  snapshot.metrics.momentumScore >= 80
                    ? "surging"
                    : snapshot.metrics.momentumScore >= 60
                      ? "steady"
                      : "recovering",
                headline: `${snapshot.metrics.streakDays}-day streak`,
                detail: `${snapshot.metrics.currentLevelXp}/${snapshot.metrics.nextLevelXp} XP in level ${snapshot.metrics.level}.`,
                celebrationLabel: "Forge Smith",
                nextMilestoneId: null,
                nextMilestoneLabel: "Next unlock"
              },
              catalogPreview: [],
              unlockedItemCount: 0,
              totalItemCount: 144,
              nextUnlock: null,
              newestUnlock: null,
              nextTargets: [],
              equipment: {
                selectedMascotSkin: null,
                selectedHudTreatment: null,
                selectedStreakEffect: null,
                selectedTrophyShelf: null,
                selectedCelebrationVariant: null,
                updatedAt: null
              },
              mascot: {
                mood: "wise",
                spriteKey: "mascot-state-014",
                streakSpriteKey: "mascot-state-017",
                headline: "Small heat still counts.",
                line: "Return to the anvil today.",
                pressureLevel: 0,
                missedDays: 0,
                lastActiveDateKey: null
              },
              celebrations: [],
              recentLedger: [],
              rules: [],
              dailyAmbientXp: 0,
              dailyAmbientCap: 12
            }}
            compact={compact}
          />
        )
    },
    {
      id: "summary",
      title: "Momentum summary",
      description:
        "Smaller titles and denser metrics free space for the widgets themselves.",
      defaultWidth: 12,
      defaultHeight: 3,
      minWidth: 6,
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: ({ compact }) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Momentum summary
              </div>
              <div className="mt-2 text-lg font-semibold text-[var(--ui-ink-strong)]">
                Current state
              </div>
              {!compact ? (
                <div className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Capacity and recent progress across Forge.
                </div>
              ) : null}
            </div>
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]">
              {heroStatus}
            </Badge>
          </div>
          <div
            className={cn(
              "mt-4 grid gap-3",
              compact ? "grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-5"
            )}
          >
            {summaryMetrics.map((metric) => (
              <div
                key={metric.label}
                className="min-w-0 border-l border-[var(--ui-border-subtle)] py-1 pl-3"
              >
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  <span>{metric.label}</span>
                  <InfoTooltip
                    label={`Explain ${metric.label}`}
                    title={metric.label}
                    content={metric.help}
                    panelClassName="normal-case tracking-normal"
                  />
                </div>
                <div className="mt-1 text-lg font-semibold text-[var(--ui-ink-strong)]">
                  {metric.value}
                </div>
                {!compact ? (
                  <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-faint)]">
                    {metric.detail}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )
    },
    {
      id: "life-force",
      title: "Life Force",
      description:
        "Dynamic Action Points, the editable capacity curve, current drains, and stat growth all live here.",
      defaultWidth: 12,
      defaultHeight: 7,
      minWidth: 6,
      defaultHidden: true,
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () =>
        snapshot.lifeForce ? (
          <LifeForceOverviewWorkspace
            selectedUserIds={selectedUserIds}
            fallbackLifeForce={snapshot.lifeForce}
            onRefresh={shell.refresh}
            showEditor={false}
          />
        ) : (
          <Card className="rounded-[24px] border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5 text-sm leading-6 text-[var(--ui-ink-soft)]">
            Life Force is not configured for this user yet. Once a profile
            exists, the full capacity curve, drains, and recommendations will
            appear here.
          </Card>
        )
    },
    {
      id: "body-signals",
      title: "Life, health, movement",
      description:
        "Health imports and movement context make the overview feel like a real daily operating page.",
      defaultWidth: 12,
      defaultHeight: 4,
      minWidth: 6,
      defaultDescriptionVisible: false,
      render: ({ compact }) => (
        <div className="grid min-w-0 gap-4 xl:grid-cols-3">
          <Card className="rounded-[24px] border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Life Force
                </div>
                <div className="mt-2 text-lg font-semibold text-[var(--ui-ink-strong)]">
                  {snapshot.lifeForce
                    ? `${Math.round(snapshot.lifeForce.remainingAp)} AP remaining`
                    : "No Life Force profile yet"}
                </div>
              </div>
              {snapshot.lifeForce ? (
                <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]">
                  {formatLifeForceRate(snapshot.lifeForce.instantFreeApPerHour)}
                </Badge>
              ) : null}
            </div>
            <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
              {snapshot.lifeForce
                ? compact
                  ? `${Math.round(snapshot.lifeForce.spentTodayAp)} / ${Math.round(snapshot.lifeForce.dailyBudgetAp)} AP spent today.`
                  : `${Math.round(snapshot.lifeForce.spentTodayAp)} / ${Math.round(snapshot.lifeForce.dailyBudgetAp)} AP spent today. Remaining ${formatLifeForceAp(snapshot.lifeForce.remainingAp)} with ${formatLifeForceRate(snapshot.lifeForce.currentDrainApPerHour)} current drain.`
                : "Once Life Force is configured, this block will show today's budget, remaining headroom, and live drain."}
            </div>
          </Card>

          <Card className="rounded-[24px] border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Body signals
                </div>
                <div className="mt-2 text-lg font-semibold text-[var(--ui-ink-strong)]">
                  {hasHealthData
                    ? "Recovery, training, and vitals"
                    : "No health data yet"}
                </div>
              </div>
              {vitalsSummary ? (
                <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]">
                  {vitalsSummary.summary.metricCount} metrics
                </Badge>
              ) : null}
            </div>
            {sleepQuery.isLoading ||
            fitnessQuery.isLoading ||
            vitalsQuery.isLoading ? (
              <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Loading recent sleep, workout, and body-signal metrics…
              </div>
            ) : hasHealthData ? (
              <div className="mt-3 grid gap-2 text-sm text-[var(--ui-ink-soft)]">
                {sleepSummary ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>Average sleep</span>
                    <span className="font-medium text-[var(--ui-ink-strong)]">
                      {formatCompactDuration(sleepSummary.averageSleepSeconds)}
                    </span>
                  </div>
                ) : null}
                {sleepSummary ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>Sleep score</span>
                    <span className="font-medium text-[var(--ui-ink-strong)]">
                      {Math.round(sleepSummary.averageSleepScore)}
                    </span>
                  </div>
                ) : null}
                {fitnessSummary && !compact ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>Exercise</span>
                    <span className="font-medium text-[var(--ui-ink-strong)]">
                      {Math.round(fitnessSummary.exerciseMinutes)} min
                    </span>
                  </div>
                ) : null}
                {fitnessSummary && !compact ? (
                  <div className="text-xs leading-5 text-[var(--ui-ink-faint)]">
                    {fitnessSummary.topWorkoutType
                      ? `${fitnessSummary.topWorkoutType} is the top workout type right now.`
                      : "Workout imports are available when Apple Health or habit-generated sessions exist."}
                  </div>
                ) : null}
                {vitalsHighlightRows.length > 0 ? (
                  <div className="mt-1 grid gap-2">
                    {vitalsHighlightRows
                      .slice(0, compact ? 1 : vitalsHighlightRows.length)
                      .map((metric) => (
                        <div
                          key={metric.metric}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2"
                        >
                          <span>{metric.label}</span>
                          <span className="font-medium text-[var(--ui-ink-strong)]">
                            {formatVitalOverviewValue(metric)}
                          </span>
                        </div>
                      ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Sleep, workout, and vitals summaries appear here as soon as
                Forge has recent HealthKit records.
              </div>
            )}
          </Card>

          <Card className="rounded-[24px] border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Movement
                </div>
                <div className="mt-2 text-lg font-semibold text-[var(--ui-ink-strong)]">
                  {hasMovementData
                    ? "Today's place balance"
                    : "No movement timeline yet"}
                </div>
              </div>
              {hasMovementData ? (
                <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]">
                  {formatCompactDuration(
                    movementDay?.summary.totalMovingSeconds ?? 0
                  )}{" "}
                  moving
                </Badge>
              ) : null}
            </div>
            {movementDayQuery.isLoading ? (
              <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Loading today's stays, trips, and place balance…
              </div>
            ) : hasMovementData ? (
              <div className="mt-3 grid gap-2">
                <div className="flex flex-wrap gap-2">
                  {movementPlaceBreakdown.map((entry) => (
                    <Badge
                      key={entry.label}
                      className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                    >
                      {formatCompactDuration(entry.seconds)} at {entry.label}
                    </Badge>
                  ))}
                  {(movementDay?.summary.totalMovingSeconds ?? 0) > 0 ? (
                    <Badge className="bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_74%,var(--ui-ink-strong)_26%)]">
                      {formatCompactDuration(
                        movementDay?.summary.totalMovingSeconds ?? 0
                      )}{" "}
                      moving
                    </Badge>
                  ) : null}
                </div>
                <div className="text-sm leading-6 text-[var(--ui-ink-soft)]">
                  {movementDay?.summary.tripCount ?? 0} trip
                  {(movementDay?.summary.tripCount ?? 0) === 1
                    ? ""
                    : "s"} and{" "}
                  {formatCompactDistance(
                    movementDay?.summary.totalDistanceMeters ?? 0
                  )}{" "}
                  tracked today.
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Movement summaries appear here once the companion has synced
                stays, trips, or known places.
              </div>
            )}
          </Card>
        </div>
      )
    },
    {
      id: "signals",
      title: "Next actions",
      description: "Open the work, reward, or evidence that needs attention.",
      defaultWidth: 12,
      defaultHeight: 4,
      minWidth: 6,
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: ({ compact }) => (
        <FlagshipSignalDeck
          eyebrow="Actions"
          title="Next actions"
          description="Open the top task, next reward, or latest recorded activity."
          compact={compact}
          items={[
            {
              id: "top-task",
              label: topTask
                ? "Top task"
                : topHabit
                  ? "Due habit"
                  : "Recovery lane",
              title:
                topTask?.title ?? topHabit?.title ?? "Get a real task moving",
              detail:
                topTask?.description ||
                topHabit?.description ||
                "There is no single top task yet, so use this surface to choose one clean next move.",
              badge: topTask
                ? `${topTask.points} xp`
                : topHabit
                  ? `${topHabit.rewardXp} xp`
                  : `${snapshot.metrics.weeklyXp} weekly xp`,
              href: topTask
                ? `/tasks/${topTask.id}`
                : topHabit
                  ? "/habits"
                  : "/today",
              actionLabel: topTask
                ? "Open task"
                : topHabit
                  ? "Open habits"
                  : "Open today"
            },
            {
              id: "reward",
              label: "Next reward",
              title: nextMilestone?.title ?? "Keep the streak alive",
              detail:
                nextMilestone?.progressLabel ??
                `Level ${snapshot.metrics.level} is active. ${snapshot.metrics.weeklyXp} weekly XP is already logged.`,
              badge:
                nextMilestone?.rewardLabel ??
                `${snapshot.metrics.comboMultiplier.toFixed(2)}x combo`,
              href: "/rewards",
              actionLabel: "Open rewards"
            },
            {
              id: "recent-activity",
              label: "Recent activity",
              title: latestEvidence
                ? getReadableActivityTitle(latestEvidence)
                : "No recent evidence",
              detail: latestEvidence
                ? getReadableActivityDescription(latestEvidence)
                : "The next work closeout or note will appear here.",
              badge: latestEvidence?.source ?? "activity",
              href: latestEvidence ? activityLink(latestEvidence) : "/activity",
              actionLabel: "Open"
            }
          ]}
        />
      )
    },
    {
      id: "goals",
      title: "Goals",
      description:
        "Long-range direction stays visible without taking over the whole page.",
      defaultWidth: 12,
      defaultHeight: 5,
      minWidth: 6,
      defaultDescriptionVisible: false,
      render: ({ compact }) => (
        <div className={cn("grid gap-3", !compact && "xl:grid-cols-2")}>
          {snapshot.overview.activeGoals
            .slice(0, compact ? 2 : 4)
            .map((goal) => (
              <div
                key={goal.id}
                className="group relative rounded-[20px] bg-[var(--ui-surface-1)] p-4 transition hover:bg-[var(--ui-surface-hover)]"
              >
                <Link
                  to={`/goals/${goal.id}`}
                  className="absolute inset-0 rounded-[20px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                  aria-label={`Open goal ${goal.title}`}
                />
                <div className="pointer-events-none relative z-10">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <EntityBadge
                      kind="goal"
                      label={goal.tags[0]?.name ?? goal.horizon}
                      compact
                      gradient={false}
                    />
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      {goal.progress}%
                    </div>
                  </div>
                  <div className="mt-3">
                    <EntityName
                      kind="goal"
                      label={goal.title}
                      variant="heading"
                      size={compact ? "md" : "lg"}
                      lines={2}
                      className="max-w-full"
                      labelClassName="[overflow-wrap:anywhere]"
                    />
                  </div>
                  {!compact ? (
                    <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                      {goal.description}
                    </p>
                  ) : null}
                  <div className="mt-3">
                    <ProgressMeter value={goal.progress} />
                  </div>
                </div>
                <div className="relative z-20 mt-3">
                  <EntityNoteCountLink
                    entityType="goal"
                    entityId={goal.id}
                    count={
                      getEntityNotesSummary(
                        snapshot.dashboard.notesSummaryByEntity,
                        "goal",
                        goal.id
                      ).count
                    }
                  />
                </div>
              </div>
            ))}
        </div>
      )
    },
    {
      id: "pipeline",
      title: "Projects, habits, tasks",
      description:
        "Execution blocks can shrink while keeping the useful subtitles visible.",
      defaultWidth: 12,
      defaultHeight: 5,
      minWidth: 6,
      defaultDescriptionVisible: false,
      render: ({ compact }) => (
        <div className="min-w-0">
          <div className="grid min-w-0 gap-4 xl:grid-cols-3">
            <div className="grid min-w-0 content-start gap-3">
              <div className="text-[12px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Projects
              </div>
              {snapshot.overview.projects
                .slice(0, compact ? 2 : 3)
                .map((project) => (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="block min-w-0 max-w-full rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 transition hover:bg-[var(--ui-surface-hover)]"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
                          {project.title}
                        </div>
                        <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                          {projectLookup.get(project.id)?.status ?? "active"}
                        </div>
                      </div>
                      <Badge wrap className="max-w-[7rem] shrink-0">
                        {project.earnedPoints} xp
                      </Badge>
                    </div>
                    {!compact ? (
                      <div className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                        {project.description}
                      </div>
                    ) : null}
                  </Link>
                ))}
            </div>
            <div className="grid min-w-0 content-start gap-3">
              <div className="text-[12px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Due habits
              </div>
              {snapshot.overview.dueHabits
                .slice(0, compact ? 2 : 3)
                .map((habit) => (
                  <Link
                    key={habit.id}
                    to="/habits"
                    aria-label={`Open habit ${habit.title}`}
                    className="block min-w-0 max-w-full rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 transition hover:bg-[var(--ui-surface-hover)]"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
                          {habit.title}
                        </div>
                        {!compact ? (
                          <div className="mt-1 line-clamp-2 text-sm text-[var(--ui-ink-soft)]">
                            {habit.description}
                          </div>
                        ) : null}
                      </div>
                      <Badge
                        wrap
                        className="max-w-[7rem] shrink-0 bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_74%,var(--ui-ink-strong)_26%)]"
                      >
                        {habit.rewardXp} xp
                      </Badge>
                    </div>
                  </Link>
                ))}
            </div>
            <div className="grid min-w-0 content-start gap-3">
              <div className="text-[12px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Top tasks
              </div>
              {snapshot.overview.topTasks
                .slice(0, compact ? 2 : 3)
                .map((task) => (
                  <Link
                    key={task.id}
                    to={`/tasks/${task.id}`}
                    className="block min-w-0 max-w-full rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 transition hover:bg-[var(--ui-surface-hover)]"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
                          {task.title}
                        </div>
                        <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                          {task.status.replaceAll("_", " ")}
                        </div>
                      </div>
                      <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]">
                        {task.points} xp
                      </Badge>
                    </div>
                  </Link>
                ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--ui-border-subtle)] pt-3">
            {[
              ["All projects", "/projects"],
              ["All habits", "/habits"],
              ["All tasks", "/kanban"]
            ].map(([label, href]) => (
              <Link
                key={href}
                to={href}
                className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--ui-ink-medium)] transition hover:text-[var(--ui-ink-strong)]"
              >
                {label}
                <ArrowRight className="size-3.5" />
              </Link>
            ))}
          </div>
        </div>
      )
    },
    {
      id: "time",
      title: "Clock",
      description: "Optional utility widget.",
      defaultWidth: 3,
      defaultHeight: 2,
      defaultHidden: true,
      render: ({ compact }) => <TimeWidget compact={compact} />
    },
    {
      id: "weather",
      title: "Weather",
      description: "Optional utility widget.",
      defaultWidth: 3,
      defaultHeight: 2,
      defaultHidden: true,
      render: ({ compact }) => <WeatherWidget compact={compact} />
    },
    {
      id: "mini-calendar",
      title: "Mini calendar",
      description: "Optional utility widget.",
      defaultWidth: 4,
      defaultHeight: 3,
      defaultHidden: true,
      render: ({ compact }) => <MiniCalendarWidget compact={compact} />
    },
    {
      id: "spotify",
      title: "Spotify",
      description: "Optional utility widget.",
      defaultWidth: 4,
      defaultHeight: 2,
      defaultHidden: true,
      render: () => <SpotifyWidget surfaceId="overview" />
    },
    {
      id: "quick-capture",
      title: "Quick capture",
      description: "Save a standalone note or wiki draft from any dashboard.",
      defaultWidth: 5,
      defaultHeight: 3,
      defaultHidden: true,
      render: ({ compact }) => (
        <QuickCaptureWidget
          compact={compact}
          defaultUserId={selectedUserIds[0] ?? snapshot.users[0]?.id ?? null}
        />
      )
    }
  ];

  return (
    <AiSurfaceWorkspace
      surfaceId="overview"
      baseWidgets={widgets}
      normalizeLayout={normalizeOverviewLayout}
    />
  );
}
