import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  type SurfaceWidgetDefinition
} from "@/components/customization/editable-surface";
import { AiSurfaceWorkspace } from "@/components/customization/ai-surface-workspace";
import {
  MiniCalendarWidget,
  QuickCaptureWidget,
  SpotifyWidget,
  TimeWidget,
  WeatherWidget
} from "@/components/customization/utility-widgets";
import { DailyRunway } from "@/components/daily-runway";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { getCalendarOverview } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { CalendarEvent } from "@/lib/types";

const MAX_VISIBLE_TODAY_EVENTS = 5;

function buildTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end, from: start.toISOString(), to: end.toISOString() };
}

function eventFallsOnDay(
  event: CalendarEvent,
  range: { start: Date; end: Date }
) {
  const eventStart = new Date(event.startAt);
  const eventEnd = new Date(event.endAt);
  return eventStart < range.end && eventEnd > range.start;
}

function formatTodayEventWindow(event: CalendarEvent) {
  if (event.isAllDay) {
    return "All day";
  }
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
  return `${formatter.format(new Date(event.startAt))} - ${formatter.format(new Date(event.endAt))}`;
}

export function TodayPage() {
  const { t } = useI18n();
  const shell = useForgeShell();
  const navigate = useNavigate();
  const todayRange = useMemo(() => buildTodayRange(), []);
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const calendarQuery = useQuery({
    queryKey: [
      "forge-calendar-overview",
      todayRange.from,
      todayRange.to,
      ...selectedUserIds
    ],
    queryFn: () =>
      getCalendarOverview({
        from: todayRange.from,
        to: todayRange.to,
        userIds: selectedUserIds
      })
  });
  const directive = shell.snapshot.today.directive.task;
  const nextMilestone =
    shell.snapshot.today.milestoneRewards.find((reward) => !reward.completed) ??
    shell.snapshot.today.milestoneRewards[0] ??
    null;
  const comebackTask =
    shell.snapshot.risk.blockedTasks[0] ??
    shell.snapshot.risk.overdueTasks[0] ??
    null;
  const nextLevelXp = Math.max(
    0,
    shell.snapshot.metrics.nextLevelXp - shell.snapshot.metrics.currentLevelXp
  );
  const todayEvents = useMemo(
    () =>
      (calendarQuery.data?.calendar.events ?? [])
        .filter(
          (event) =>
            !event.deletedAt &&
            event.status !== "cancelled" &&
            eventFallsOnDay(event, todayRange)
        )
        .sort(
          (left, right) =>
            new Date(left.startAt).getTime() - new Date(right.startAt).getTime()
        ),
    [calendarQuery.data?.calendar.events, todayRange]
  );
  const visibleTodayEvents = todayEvents.slice(0, MAX_VISIBLE_TODAY_EVENTS);
  const hasTodayData =
    directive !== null ||
    shell.snapshot.overview.topTasks.length > 0 ||
    shell.snapshot.today.dueHabits.length > 0 ||
    shell.snapshot.today.dailyQuests.length > 0 ||
    shell.snapshot.today.milestoneRewards.length > 0 ||
    todayEvents.length > 0;

  if (!hasTodayData && !calendarQuery.isLoading) {
    return (
      <div className="grid gap-4">
        <PageHero
          title="Today"
          titleText="Today"
          description="Start a task, earn XP, and keep today's work clear."
          badge={`${shell.snapshot.metrics.weeklyXp} weekly xp`}
        />
        <EmptyState
          eyebrow={t("common.todayPage.heroEyebrow")}
          title={t("common.todayPage.emptyTitle")}
          description={t("common.todayPage.emptyDescription")}
          action={
            <Link
              to="/goals"
              className="inline-flex min-h-10 min-w-max shrink-0 items-center justify-center rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium whitespace-nowrap text-slate-950 transition hover:opacity-90"
            >
              {t("common.todayPage.emptyAction")}
            </Link>
          }
        />
      </div>
    );
  }

  const widgets: SurfaceWidgetDefinition[] = [
    {
      id: "hero",
      title: "Today",
      description: "Compact page header.",
      defaultWidth: 12,
      defaultHeight: 1,
      removable: false,
      render: () => (
        <PageHero
          title="Today"
          titleText="Today"
          description={
            directive?.description ??
            "Start one real task, collect XP, and keep today's work moving."
          }
          badge={`${shell.snapshot.metrics.weeklyXp} weekly xp`}
        />
      )
    },
    {
      id: "metrics",
      title: "Live metrics",
      description:
        "XP, level, and momentum stay visible but lighter than before.",
      defaultWidth: 5,
      defaultHeight: 3,
      minWidth: 4,
      render: ({ compact }) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
              Weekly XP
            </div>
            <div className="mt-2 font-display text-4xl text-[var(--primary)]">
              {shell.snapshot.metrics.weeklyXp}
            </div>
            <div className="mt-1 text-sm text-white/56">
              {shell.snapshot.metrics.totalXp} total XP
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
              Level
            </div>
            <div className="mt-2 font-display text-4xl text-white">
              {shell.snapshot.metrics.level}
            </div>
            <div className="mt-1 text-sm text-white/56">
              {nextLevelXp} xp to the next level
            </div>
            {!compact ? (
              <div className="mt-3">
                <ProgressMeter
                  value={
                    (shell.snapshot.metrics.currentLevelXp /
                      shell.snapshot.metrics.nextLevelXp) *
                    100
                  }
                  tone="tertiary"
                />
              </div>
            ) : null}
          </Card>
          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
              Momentum
            </div>
            <div className="mt-2 font-display text-4xl text-white">
              {shell.snapshot.metrics.momentumScore}%
            </div>
            <div className="mt-1 text-sm text-white/56">
              {shell.snapshot.metrics.streakDays} day streak
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
              Next reward
            </div>
            <div className="mt-2 text-base font-semibold text-white">
              {nextMilestone?.title ?? "Keep showing up"}
            </div>
            <div className="mt-1 text-sm text-white/56">
              {nextMilestone?.progressLabel ??
                "The next visible win comes from a task completion or aligned habit check-in."}
            </div>
          </Card>
        </div>
      )
    },
    {
      id: "runway",
      title: "Runway",
      description: "The execution lane itself can be widened or narrowed.",
      defaultWidth: 7,
      defaultHeight: 5,
      minWidth: 5,
      render: () => (
        <DailyRunway
          tasks={shell.snapshot.overview.topTasks}
          timeline={shell.snapshot.today.timeline}
          goals={shell.snapshot.goals}
          tags={shell.snapshot.tags}
          notesSummaryByEntity={shell.snapshot.dashboard.notesSummaryByEntity}
          selectedTaskId={directive?.id ?? null}
          onSelectTask={(taskId) => navigate(`/tasks/${taskId}`)}
          onStartTask={async (taskId) => {
            await shell.startTaskNow(taskId);
          }}
          onMove={async (taskId, nextStatus) => {
            await shell.patchTaskStatus(taskId, nextStatus);
          }}
        />
      )
    },
    {
      id: "calendar",
      title: "Calendar",
      description:
        "Today's events stay grouped with their results instead of splitting search from outcome.",
      defaultWidth: 5,
      defaultHeight: 4,
      minWidth: 4,
      render: ({ compact }) => (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)]/14 text-[var(--primary)]">
                <CalendarDays className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                  Today&apos;s calendar
                </div>
                <div className="text-sm font-semibold text-white">
                  {new Intl.DateTimeFormat(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric"
                  }).format(todayRange.start)}
                </div>
                <div className="text-sm text-white/58">
                  {todayEvents.length} event
                  {todayEvents.length === 1 ? "" : "s"}
                </div>
              </div>
            </div>
            <Link
              to="/calendar"
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white/[0.06] px-3 py-2 text-xs font-medium text-white/72 transition hover:bg-white/[0.1] hover:text-white"
            >
              Open calendar
              <ChevronRight className="size-3.5" />
            </Link>
          </div>
          {todayEvents.length === 0 ? (
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-4 text-sm text-white/58">
              Nothing is scheduled yet for today.
            </div>
          ) : (
            visibleTodayEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                className="grid min-w-0 gap-2 rounded-[18px] bg-white/[0.04] px-3 py-3 text-left transition hover:bg-white/[0.07]"
                onClick={() => navigate("/calendar")}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">
                      {event.title}
                    </div>
                    <div className="mt-1 text-sm text-white/58">
                      {formatTodayEventWindow(event)}
                    </div>
                  </div>
                  <Badge className="shrink-0 bg-white/[0.08] text-white/72">
                    {event.originType === "native" ? "Forge" : event.originType}
                  </Badge>
                </div>
                {!compact && event.description ? (
                  <div className="line-clamp-2 text-sm leading-6 text-white/52">
                    {event.description}
                  </div>
                ) : null}
              </button>
            ))
          )}
        </div>
      )
    },
    {
      id: "focus",
      title: "Current focus",
      description:
        "Current task, comeback task, and due habits stay in one movable stack.",
      defaultWidth: 12,
      defaultHeight: 3,
      minWidth: 6,
      render: ({ compact }) => (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="rounded-[20px] bg-white/[0.04] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                Current task
              </div>
              {directive ? (
                <EntityNoteCountLink
                  entityType="task"
                  entityId={directive.id}
                  count={
                    shell.snapshot.dashboard.notesSummaryByEntity[
                      `task:${directive.id}`
                    ]?.count ?? 0
                  }
                />
              ) : null}
            </div>
            <div className="mt-3 text-base font-semibold text-white">
              {directive?.title ?? "Pick a task from the runway"}
            </div>
            <div className="mt-2 text-sm leading-6 text-white/58">
              {directive?.description ??
                "Once a task is active, the timer rail and this panel stay aligned."}
            </div>
            {directive ? (
              <button
                type="button"
                className="mt-4 inline-flex min-h-10 items-center justify-center rounded-2xl bg-[rgba(192,193,255,0.16)] px-3.5 py-2 text-sm font-medium text-[var(--primary)] transition hover:bg-[rgba(192,193,255,0.24)]"
                onClick={async () => {
                  await shell.startTaskNow(directive.id);
                }}
              >
                Start work
              </button>
            ) : null}
          </div>
          <div className="grid gap-3">
            <div className="rounded-[20px] bg-white/[0.04] p-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                Recovery task
              </div>
              <div className="mt-3 text-sm font-semibold text-white">
                {comebackTask?.title ??
                  "No blocked or overdue task is dominating today"}
              </div>
              {!compact ? (
                <div className="mt-2 text-sm leading-6 text-white/56">
                  {comebackTask?.description ??
                    "If something slips, it will surface here as the clean comeback move."}
                </div>
              ) : null}
            </div>
            <div className="rounded-[20px] bg-white/[0.04] p-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                Due habits
              </div>
              <div className="mt-3 grid gap-2">
                {shell.snapshot.today.dueHabits
                  .slice(0, compact ? 2 : 3)
                  .map((habit) => (
                    <div
                      key={habit.id}
                      className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.04] px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">
                          {habit.title}
                        </div>
                        {!compact ? (
                          <div className="text-sm text-white/52">
                            {habit.frequency}
                          </div>
                        ) : null}
                      </div>
                      <Badge className="bg-[rgba(78,222,163,0.14)] text-[var(--secondary)]">
                        {habit.rewardXp} xp
                      </Badge>
                    </div>
                  ))}
              </div>
            </div>
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
      render: () => <SpotifyWidget surfaceId="today" />
    },
    {
      id: "quick-capture",
      title: "Quick capture",
      description: "Save a note or wiki draft without leaving Today.",
      defaultWidth: 5,
      defaultHeight: 3,
      defaultHidden: true,
      render: ({ compact }) => (
        <QuickCaptureWidget
          compact={compact}
          defaultUserId={
            shell.selectedUserIds[0] ?? shell.snapshot.users[0]?.id ?? null
          }
        />
      )
    }
  ];

  return <AiSurfaceWorkspace surfaceId="today" baseWidgets={widgets} />;
}
