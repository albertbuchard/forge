import { Link } from "react-router-dom";
import {
  EditableSurface,
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
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { MetricTile } from "@/components/ui/metric-tile";
import {
  getReadableActivityDescription,
  getReadableActivityTitle
} from "@/lib/activity-copy";
import { getEntityNotesSummary } from "@/lib/note-helpers";
import { useI18n } from "@/lib/i18n";

export function OverviewPage() {
  const { t } = useI18n();
  const shell = useForgeShell();
  const snapshot = shell.snapshot;
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
  const hasOverviewData =
    snapshot.overview.activeGoals.length > 0 ||
    snapshot.overview.projects.length > 0 ||
    snapshot.overview.topTasks.length > 0 ||
    snapshot.overview.recentEvidence.length > 0 ||
    snapshot.overview.dueHabits.length > 0 ||
    snapshot.overview.neglectedGoals.length > 0;

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
      defaultHeight: 1,
      removable: false,
      minHeight: 1,
      maxHeight: 2,
      render: () => (
        <PageHero
          title="Overview"
          titleText="Overview"
          description={`${heroStatus}. Core goals, active projects, top tasks, and momentum are all here.`}
          badge={`${snapshot.metrics.streakDays} day streak`}
        />
      )
    },
    {
      id: "signals",
      title: "Action signals",
      description: "Direct links to the next things worth opening.",
      defaultWidth: 7,
      defaultHeight: 3,
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
      id: "summary",
      title: "Momentum summary",
      description:
        "Smaller titles and denser metrics free space for the widgets themselves.",
      defaultWidth: 5,
      defaultHeight: 3,
      minWidth: 4,
      render: ({ compact }) => (
        <div className="grid h-full gap-3">
          <div className={compact ? "grid gap-3" : "grid gap-3 sm:grid-cols-2"}>
            <MetricTile
              label="Level"
              value={snapshot.metrics.level}
              tone="core"
              detail={`${snapshot.metrics.currentLevelXp} XP in the current level`}
            />
            <MetricTile
              label="Weekly XP"
              value={snapshot.metrics.weeklyXp}
              tone="core"
              detail={`${snapshot.metrics.totalXp} total XP recorded`}
            />
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
      id: "goals",
      title: "Goals",
      description:
        "Long-range direction stays visible without taking over the whole page.",
      defaultWidth: 8,
      defaultHeight: 4,
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
      defaultHeight: 4,
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
          defaultUserId={
            shell.selectedUserIds[0] ?? snapshot.users[0]?.id ?? null
          }
        />
      )
    }
  ];

  return <EditableSurface surfaceId="overview" widgets={widgets} />;
}
