import { AiSurfaceWorkspace } from "@/components/customization/ai-surface-workspace";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  type SurfaceWidgetDefinition
} from "@/components/customization/editable-surface";
import {
  MiniCalendarWidget,
  QuickCaptureWidget,
  SpotifyWidget,
  TimeWidget,
  WeatherWidget
} from "@/components/customization/utility-widgets";
import { FlagshipSignalDeck } from "@/components/experience/flagship-signal-deck";
import { LifeForceOverviewWorkspace } from "@/components/life-force/life-force-workspace";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  SurfaceLayoutPayload,
  VitalsViewData
} from "@/lib/types";
import { cn } from "@/lib/utils";

function normalizeOverviewLayout(layout: SurfaceLayoutPayload): SurfaceLayoutPayload {
  const orderedIds = ["summary", "body-signals", "signals"] as const;
  const nextOrder = [...layout.order];
  let mutated = false;

  for (const id of orderedIds) {
    if (!nextOrder.includes(id)) {
      nextOrder.push(id);
      mutated = true;
    }
  }

  const summaryIndex = nextOrder.indexOf("summary");
  const bodySignalsIndex = nextOrder.indexOf("body-signals");
  const signalsIndex = nextOrder.indexOf("signals");

  if (summaryIndex === -1 || bodySignalsIndex === -1 || signalsIndex === -1) {
    return mutated
      ? {
          ...layout,
          order: nextOrder
        }
      : layout;
  }

  if (summaryIndex < bodySignalsIndex && bodySignalsIndex < signalsIndex && !mutated) {
    return layout;
  }

  for (const id of orderedIds) {
    const index = nextOrder.indexOf(id);
    if (index !== -1) {
      nextOrder.splice(index, 1);
    }
  }
  const anchorIndex = nextOrder.indexOf("goals");
  nextOrder.splice(anchorIndex === -1 ? 0 : anchorIndex, 0, ...orderedIds);
  return {
    ...layout,
    order: nextOrder
  };
}

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
    .filter((metric): metric is VitalsViewData["metrics"][number] => Boolean(metric))
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
  const todayDateKey = localDateKey();
  const sleepQuery =
    useQuery({
      queryKey: ["forge-overview-sleep", ...selectedUserIds],
      queryFn: async () => (await getSleepView(selectedUserIds)).sleep
    }) ?? {};
  const fitnessQuery =
    useQuery({
      queryKey: ["forge-overview-fitness", ...selectedUserIds],
      queryFn: async () => (await getFitnessView(selectedUserIds)).fitness
    }) ?? {};
  const movementDayQuery =
    useQuery({
      queryKey: ["forge-overview-movement-day", todayDateKey, ...selectedUserIds],
      queryFn: async () =>
        (
          await getMovementDay({
            date: todayDateKey,
            userIds: selectedUserIds
          })
        ).movement
    }) ?? {};
  const vitalsQuery =
    useQuery({
      queryKey: ["forge-overview-vitals", ...selectedUserIds],
      queryFn: async () => (await getVitalsView(selectedUserIds)).vitals
    }) ?? {};
  const nextMilestone =
    snapshot.dashboard.milestoneRewards.find((reward) => !reward.completed) ??
    snapshot.dashboard.milestoneRewards[0] ??
    null;
  const topTask = snapshot.overview.topTasks[0] ?? null;
  const topHabit = snapshot.overview.dueHabits[0] ?? null;
  const driftGoal = snapshot.overview.neglectedGoals[0] ?? null;
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
  const vitalsHighlightRows = buildVitalsHighlightRows(vitalsSummary ?? undefined);
  const movementPlaceBreakdown = buildMovementPlaceBreakdown(movementDay);
  const hasHealthData =
    sleepSummary !== null ||
    fitnessSummary !== null ||
    vitalsSummary !== null;
  const hasMovementData =
    movementDay !== undefined &&
    (movementDay.summary.tripCount > 0 ||
      movementDay.summary.stayCount > 0 ||
      movementDay.summary.totalMovingSeconds > 0 ||
      movementPlaceBreakdown.length > 0);
  const hasOverviewData =
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
          detail: `Remaining ${formatLifeForceAp(snapshot.lifeForce.remainingAp)}`
        },
        {
          label: "Momentum",
          value: `${snapshot.metrics.momentumScore}`,
          detail: `${heroStatus} · ${snapshot.metrics.streakDays} day streak`
        },
        {
          label: "Instant",
          value: formatLifeForceRate(snapshot.lifeForce.instantFreeApPerHour),
          detail:
            snapshot.lifeForce.overloadApPerHour > 0
              ? `${formatLifeForceRate(snapshot.lifeForce.overloadApPerHour)} overload`
              : "Headroom right now"
        },
        {
          label: "Level",
          value: `L${snapshot.metrics.level}`,
          detail: `${snapshot.metrics.currentLevelXp} XP in level`
        },
        {
          label: "Weekly XP",
          value: `${snapshot.metrics.weeklyXp}`,
          detail: `${snapshot.metrics.totalXp} total XP`
        }
      ]
    : [
        {
          label: "Level",
          value: `L${snapshot.metrics.level}`,
          detail: `${snapshot.metrics.currentLevelXp} XP in level`
        },
        {
          label: "Weekly XP",
          value: `${snapshot.metrics.weeklyXp}`,
          detail: `${snapshot.metrics.totalXp} total XP`
        },
        {
          label: "Momentum",
          value: `${snapshot.metrics.momentumScore}`,
          detail: `${heroStatus} · ${snapshot.metrics.streakDays} day streak`
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
              className="inline-flex min-h-10 min-w-0 max-w-full items-center justify-center rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium whitespace-nowrap text-slate-950 transition hover:opacity-90"
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
          description={`${heroStatus}. Life Force, momentum, XP, goals, active projects, and top tasks all start here.`}
          badge={`Momentum ${snapshot.metrics.momentumScore}`}
        />
      )
    },
    {
      id: "summary",
      title: "Momentum summary",
      description:
        "Smaller titles and denser metrics free space for the widgets themselves.",
      defaultWidth: 12,
      defaultHeight: 4,
      minWidth: 6,
      render: ({ compact }) => (
        <div className="grid h-full gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
          <div className="rounded-[24px] bg-white/[0.04] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                  Momentum summary
                </div>
                <div className="mt-2 text-lg font-semibold text-white">
                  Core live metrics
                </div>
                <div className="mt-1 text-sm leading-6 text-white/56">
                  Life Force, momentum, XP, and instant headroom stay grouped
                  here so the title bar can stay clean.
                </div>
              </div>
              <Badge className="bg-white/[0.08] text-white/70">
                {heroStatus}
              </Badge>
            </div>
            <div
              className={cn(
                "mt-4 grid gap-3",
                compact
                  ? "grid-cols-2"
                  : "sm:grid-cols-2 xl:grid-cols-5"
              )}
            >
              {summaryMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3"
                >
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">
                    {metric.label}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-white">
                    {metric.value}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-white/54">
                    {metric.detail}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[20px] bg-white/[0.04] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[12px] uppercase tracking-[0.16em] text-white/38">
                Goal needing attention
              </div>
              <Badge className="bg-white/[0.08] text-white/70">
                {driftGoal?.risk ?? "stable"}
              </Badge>
            </div>
            <div className="mt-3 text-base font-semibold text-white">
              {driftGoal?.title ?? "No goal is drifting hard right now"}
            </div>
            <div className="mt-2 text-sm leading-6 text-white/58">
              {driftGoal?.summary ??
                `Only ${snapshot.overview.strategicHeader.overdueTasks} overdue task${snapshot.overview.strategicHeader.overdueTasks === 1 ? "" : "s"} are slowing the system.`}
            </div>
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
      render: () => (
        snapshot.lifeForce ? (
          <LifeForceOverviewWorkspace
            selectedUserIds={selectedUserIds}
            fallbackLifeForce={snapshot.lifeForce}
            onRefresh={shell.refresh}
            showEditor={false}
          />
        ) : (
          <Card className="rounded-[24px] border-white/8 bg-white/[0.04] p-5 text-sm leading-6 text-white/60">
            Life Force is not configured for this user yet. Once a profile exists,
            the full capacity curve, drains, and recommendations will appear here.
          </Card>
        )
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
      render: () => (
        <div className="grid min-w-0 gap-4 xl:grid-cols-3">
          <Card className="rounded-[24px] border-white/8 bg-white/[0.04] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                  Life Force
                </div>
                <div className="mt-2 text-lg font-semibold text-white">
                  {snapshot.lifeForce
                    ? `${Math.round(snapshot.lifeForce.remainingAp)} AP remaining`
                    : "No Life Force profile yet"}
                </div>
              </div>
              {snapshot.lifeForce ? (
                <Badge className="bg-white/[0.08] text-white/72">
                  {formatLifeForceRate(snapshot.lifeForce.instantFreeApPerHour)}
                </Badge>
              ) : null}
            </div>
            <div className="mt-3 text-sm leading-6 text-white/58">
              {snapshot.lifeForce
                ? `${Math.round(snapshot.lifeForce.spentTodayAp)} / ${Math.round(snapshot.lifeForce.dailyBudgetAp)} AP spent today. Remaining ${formatLifeForceAp(snapshot.lifeForce.remainingAp)} with ${formatLifeForceRate(snapshot.lifeForce.currentDrainApPerHour)} current drain.`
                : "Once Life Force is configured, this block will show today's budget, remaining headroom, and live drain."}
            </div>
          </Card>

          <Card className="rounded-[24px] border-white/8 bg-white/[0.04] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                  Body signals
                </div>
                <div className="mt-2 text-lg font-semibold text-white">
                  {hasHealthData ? "Recovery, training, and vitals" : "No health data yet"}
                </div>
              </div>
              {vitalsSummary ? (
                <Badge className="bg-white/[0.08] text-white/72">
                  {vitalsSummary.summary.metricCount} metrics
                </Badge>
              ) : null}
            </div>
            {sleepQuery.isLoading || fitnessQuery.isLoading || vitalsQuery.isLoading ? (
              <div className="mt-3 text-sm leading-6 text-white/58">
                Loading recent sleep, workout, and body-signal metrics…
              </div>
            ) : hasHealthData ? (
              <div className="mt-3 grid gap-2 text-sm text-white/72">
                {sleepSummary ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>Average sleep</span>
                    <span className="font-medium text-white">
                      {formatCompactDuration(sleepSummary.averageSleepSeconds)}
                    </span>
                  </div>
                ) : null}
                {sleepSummary ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>Sleep score</span>
                    <span className="font-medium text-white">
                      {Math.round(sleepSummary.averageSleepScore)}
                    </span>
                  </div>
                ) : null}
                {fitnessSummary ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>Exercise</span>
                    <span className="font-medium text-white">
                      {Math.round(fitnessSummary.exerciseMinutes)} min
                    </span>
                  </div>
                ) : null}
                {fitnessSummary ? (
                  <div className="text-xs leading-5 text-white/54">
                    {fitnessSummary.topWorkoutType
                      ? `${fitnessSummary.topWorkoutType} is the top workout type right now.`
                      : "Workout imports are available when Apple Health or habit-generated sessions exist."}
                  </div>
                ) : null}
                {vitalsHighlightRows.length > 0 ? (
                  <div className="mt-1 grid gap-2">
                    {vitalsHighlightRows.map((metric) => (
                      <div
                        key={metric.metric}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2"
                      >
                        <span>{metric.label}</span>
                        <span className="font-medium text-white">
                          {formatVitalOverviewValue(metric)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 text-sm leading-6 text-white/58">
                Sleep, workout, and vitals summaries appear here as soon as Forge has recent HealthKit records.
              </div>
            )}
          </Card>

          <Card className="rounded-[24px] border-white/8 bg-white/[0.04] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                  Movement
                </div>
                <div className="mt-2 text-lg font-semibold text-white">
                  {hasMovementData ? "Today's place balance" : "No movement timeline yet"}
                </div>
              </div>
              {hasMovementData ? (
                <Badge className="bg-white/[0.08] text-white/72">
                  {formatCompactDuration(movementDay?.summary.totalMovingSeconds ?? 0)} moving
                </Badge>
              ) : null}
            </div>
            {movementDayQuery.isLoading ? (
              <div className="mt-3 text-sm leading-6 text-white/58">
                Loading today's stays, trips, and place balance…
              </div>
            ) : hasMovementData ? (
              <div className="mt-3 grid gap-2">
                <div className="flex flex-wrap gap-2">
                  {movementPlaceBreakdown.map((entry) => (
                    <Badge
                      key={entry.label}
                      className="bg-white/[0.08] text-white/78"
                    >
                      {formatCompactDuration(entry.seconds)} at {entry.label}
                    </Badge>
                  ))}
                  {(movementDay?.summary.totalMovingSeconds ?? 0) > 0 ? (
                    <Badge className="bg-[rgba(78,222,163,0.14)] text-[var(--secondary)]">
                      {formatCompactDuration(movementDay?.summary.totalMovingSeconds ?? 0)} moving
                    </Badge>
                  ) : null}
                </div>
                <div className="text-sm leading-6 text-white/58">
                  {(movementDay?.summary.tripCount ?? 0)} trip{(movementDay?.summary.tripCount ?? 0) === 1 ? "" : "s"} and{" "}
                  {formatCompactDistance(movementDay?.summary.totalDistanceMeters ?? 0)} tracked today.
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm leading-6 text-white/58">
                Movement summaries appear here once the companion has synced stays, trips, or known places.
              </div>
            )}
          </Card>
        </div>
      )
    },
    {
      id: "signals",
      title: "Action signals",
      description: "Direct links to the next things worth opening.",
      defaultWidth: 7,
      defaultHeight: 4,
      minWidth: 4,
      render: () => (
        <FlagshipSignalDeck
          eyebrow="Actions"
          title="Open what matters now"
          description="These cards stay compact by default so the page can fit more live context at once."
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
              href: "/today",
              actionLabel: "Open today"
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
      defaultWidth: 8,
      defaultHeight: 5,
      minWidth: 4,
      render: ({ compact }) => (
        <div className="grid gap-3">
          {snapshot.overview.activeGoals
            .slice(0, compact ? 2 : 4)
            .map((goal) => (
              <Link
                key={goal.id}
                to={`/goals/${goal.id}`}
                className="rounded-[20px] bg-white/[0.04] p-4 transition hover:bg-white/[0.06]"
              >
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <EntityBadge
                    kind="goal"
                    label={goal.tags[0]?.name ?? goal.horizon}
                    compact
                    gradient={false}
                  />
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
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
                  <p className="mt-2 text-sm leading-6 text-white/60">
                    {goal.description}
                  </p>
                ) : null}
                <div className="mt-3">
                  <ProgressMeter value={goal.progress} />
                </div>
                <div className="mt-3">
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
              </Link>
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
      render: ({ compact }) => (
        <div className="grid min-w-0 gap-4 xl:grid-cols-3">
          <div className="grid gap-3">
            <div className="text-[12px] uppercase tracking-[0.16em] text-white/38">
              Projects
            </div>
            {snapshot.overview.projects
              .slice(0, compact ? 3 : 4)
              .map((project) => (
                <Link
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="rounded-[18px] bg-white/[0.04] px-4 py-3 transition hover:bg-white/[0.06]"
                >
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">
                        {project.title}
                      </div>
                      <div className="mt-1 text-sm text-white/56">
                        {projectLookup.get(project.id)?.status ?? "active"}
                      </div>
                    </div>
                    <Badge wrap className="max-w-[7rem] shrink-0">
                      {project.earnedPoints} xp
                    </Badge>
                  </div>
                  {!compact ? (
                    <div className="mt-2 text-sm leading-6 text-white/56">
                      {project.description}
                    </div>
                  ) : null}
                </Link>
              ))}
          </div>
          <div className="grid gap-3">
            <div className="text-[12px] uppercase tracking-[0.16em] text-white/38">
              Due habits
            </div>
            {snapshot.overview.dueHabits
              .slice(0, compact ? 3 : 4)
              .map((habit) => (
                <div
                  key={habit.id}
                  className="rounded-[18px] bg-white/[0.04] px-4 py-3"
                >
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">
                        {habit.title}
                      </div>
                      {!compact ? (
                        <div className="mt-1 text-sm text-white/56">
                          {habit.description}
                        </div>
                      ) : null}
                    </div>
                    <Badge className="bg-[rgba(78,222,163,0.14)] text-[var(--secondary)]">
                      {habit.rewardXp} xp
                    </Badge>
                  </div>
                </div>
              ))}
          </div>
          <div className="grid gap-3">
            <div className="text-[12px] uppercase tracking-[0.16em] text-white/38">
              Top tasks
            </div>
            {snapshot.overview.topTasks
              .slice(0, compact ? 3 : 4)
              .map((task) => (
                <Link
                  key={task.id}
                  to={`/tasks/${task.id}`}
                  className="rounded-[18px] bg-white/[0.04] px-4 py-3 transition hover:bg-white/[0.06]"
                >
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">
                        {task.title}
                      </div>
                      <div className="mt-1 text-sm text-white/56">
                        {task.status.replaceAll("_", " ")}
                      </div>
                    </div>
                    <Badge className="bg-white/[0.08] text-white/72">
                      {task.points} xp
                    </Badge>
                  </div>
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
