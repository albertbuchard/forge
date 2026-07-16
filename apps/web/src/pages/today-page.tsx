import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronRight, RefreshCcw } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { type SurfaceWidgetDefinition } from "@/components/customization/editable-surface";
import { AiSurfaceWorkspace } from "@/components/customization/ai-surface-workspace";
import {
  MiniCalendarWidget,
  QuickCaptureWidget,
  SpotifyWidget,
  TimeWidget,
  WeatherWidget
} from "@/components/customization/utility-widgets";
import { DailyRunway } from "@/components/daily-runway";
import { LifeForceTodayCard } from "@/components/life-force/life-force-workspace";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import {
  TodayCalendarBox,
  TodayFocusBox,
  TodayHeroBox,
  TodayMetricsBox,
  TodayRunwayBox
} from "@/components/workbench-boxes/today/today-boxes";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressMeter } from "@/components/ui/progress-meter";
import {
  getCalendarOverview,
  getLifeForce,
  getTodayPriorityDecision
} from "@/lib/api";
import type { CalendarEvent } from "@/lib/types";
import { normalizeTodayLayout } from "@/pages/today-layout";
import { TodayPriorityPanel } from "@/pages/today-priority-panel";

const MAX_VISIBLE_TODAY_EVENTS = 5;
const todayEyebrowClass =
  "text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]";
const todaySoftTextClass = "text-[var(--ui-ink-soft)]";
const todayStrongTextClass = "text-[var(--ui-ink-strong)]";
const todayPanelClass =
  "min-w-0 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] shadow-[var(--ui-shadow-soft)]";
const todayInnerPanelClass =
  "min-w-0 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]";
const todayGhostButtonClass =
  "inline-flex min-h-10 max-w-full shrink-0 items-center justify-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2 text-xs font-medium text-[var(--ui-ink-medium)] shadow-[var(--ui-shadow-soft)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]";

function buildTodayRange() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    now,
    start,
    end,
    from: start.toISOString(),
    to: end.toISOString()
  };
}

function eventFallsOnDay(
  event: CalendarEvent,
  range: { start: Date; end: Date }
) {
  const eventStart = new Date(event.startAt);
  const eventEnd = new Date(event.endAt);
  return (
    Number.isFinite(eventStart.getTime()) &&
    Number.isFinite(eventEnd.getTime()) &&
    eventStart < range.end &&
    eventEnd > range.start
  );
}

function formatTodayEventWindow(event: CalendarEvent) {
  if (event.isAllDay) {
    return "All day";
  }
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return "Time unavailable";
  }
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

export function TodayPage() {
  const shell = useForgeShell();
  const navigate = useNavigate();
  const todayRange = useMemo(() => buildTodayRange(), []);
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const priorityTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );
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
  const lifeForceQuery = useQuery({
    queryKey: ["forge-life-force", ...selectedUserIds],
    queryFn: () => getLifeForce(selectedUserIds),
    initialData:
      shell.snapshot.lifeForce === undefined
        ? undefined
        : { lifeForce: shell.snapshot.lifeForce, templates: [] }
  });
  const priorityQuery = useQuery({
    queryKey: ["forge-today-priority", priorityTimeZone, ...selectedUserIds],
    queryFn: () =>
      getTodayPriorityDecision({
        userIds: selectedUserIds,
        timeZone: priorityTimeZone,
        candidateLimit: 24
      })
  });
  const lifeForce = lifeForceQuery.data?.lifeForce ?? shell.snapshot.lifeForce;
  const todayDecision = priorityQuery.data?.decision ?? null;
  const directive = todayDecision?.task ?? null;
  const rankedTodayTasks =
    todayDecision?.rankedCandidates
      .slice(0, 6)
      .map((candidate) => candidate.task) ?? [];
  const runwayTodayTasks =
    todayDecision?.mode === "overloaded" ||
    todayDecision?.mode === "capacity-limited" ||
    todayDecision?.mode === "unresolved-active"
      ? []
      : rankedTodayTasks;
  const refreshTodayEvidence = async () => {
    await Promise.all([
      shell.refresh(),
      priorityQuery.refetch(),
      calendarQuery.refetch(),
      lifeForceQuery.refetch()
    ]);
  };
  const startTodayTask = async (taskId: string) => {
    await shell.startTaskNow(taskId);
    await Promise.all([shell.refresh(), priorityQuery.refetch()]);
  };
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
        .sort((left, right) => {
          const timeDelta =
            new Date(left.startAt).getTime() -
            new Date(right.startAt).getTime();
          return timeDelta !== 0 ? timeDelta : left.id < right.id ? -1 : 1;
        }),
    [calendarQuery.data?.calendar.events, todayRange]
  );
  const visibleTodayEvents = todayEvents.slice(0, MAX_VISIBLE_TODAY_EVENTS);

  const widgets: SurfaceWidgetDefinition[] = [
    {
      id: "hero",
      title: "Today",
      description: "Compact page header.",
      defaultWidth: 12,
      defaultHeight: 2,
      removable: false,
      surfaceChrome: "none",
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () => (
        <TodayHeroBox>
          <PageHero
            title="Today"
            titleText="Today"
            description={
              directive
                ? `${todayDecision?.mode === "continue-active" ? "Active now" : "Next"}: ${directive.title}.`
                : priorityQuery.isLoading
                  ? "Loading the current work decision."
                  : priorityQuery.isError
                    ? "The current work decision is temporarily unavailable."
                    : (todayDecision?.summary ??
                      "No priority decision is available.")
            }
            badge={`${shell.snapshot.metrics.weeklyXp} weekly xp`}
          />
        </TodayHeroBox>
      )
    },
    {
      id: "priority",
      title: "Next useful work",
      description:
        "One deterministic recommendation with urgency, schedule, capacity, and active-context evidence.",
      defaultWidth: 12,
      defaultHeight: 4,
      minWidth: 6,
      removable: false,
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () =>
        priorityQuery.isLoading && !todayDecision ? (
          <section
            aria-labelledby="today-priority-loading-title"
            aria-busy="true"
            className={`${todayInnerPanelClass} grid min-h-44 place-items-center px-4 py-8 text-center`}
          >
            <div>
              <h2
                id="today-priority-loading-title"
                className="text-base font-semibold text-[var(--ui-ink-strong)]"
              >
                Loading next useful work
              </h2>
              <p className={`mt-2 text-sm ${todaySoftTextClass}`}>
                Forge is checking active work, timing, and capacity.
              </p>
            </div>
          </section>
        ) : priorityQuery.isError || !todayDecision ? (
          <section
            aria-labelledby="today-priority-error-title"
            className={`${todayInnerPanelClass} grid min-h-44 place-items-center px-4 py-8 text-center`}
          >
            <div>
              <h2
                id="today-priority-error-title"
                className="text-base font-semibold text-[var(--ui-ink-strong)]"
              >
                Next useful work is unavailable
              </h2>
              <p role="alert" className={`mt-2 text-sm ${todaySoftTextClass}`}>
                The server could not build a current decision. No fallback
                ranking has been applied.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                pending={priorityQuery.isFetching}
                pendingLabel="Retrying"
                className="mt-4"
                onClick={() => void priorityQuery.refetch()}
              >
                <RefreshCcw className="size-3.5" />
                Retry decision
              </Button>
            </div>
          </section>
        ) : (
          <TodayPriorityPanel
            decision={todayDecision}
            onStartTask={startTodayTask}
            refreshing={Boolean(
              priorityQuery.isFetching ||
              calendarQuery.isFetching ||
              lifeForceQuery.isFetching
            )}
            onRefresh={refreshTodayEvidence}
          />
        )
    },
    {
      id: "life-force",
      title: "Capacity",
      description: "Available capacity, planned load, and fatigue today.",
      defaultWidth: 4,
      defaultHeight: 3,
      minWidth: 4,
      render: () => (
        <LifeForceTodayCard
          selectedUserIds={shell.selectedUserIds}
          fallbackLifeForce={lifeForce}
          onRefresh={shell.refresh}
        />
      )
    },
    {
      id: "metrics",
      title: "Live metrics",
      description: "XP, level, momentum, and the next reward.",
      defaultWidth: 6,
      defaultHeight: 4,
      minWidth: 4,
      render: ({ compact }) => (
        <TodayMetricsBox>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="min-w-0 p-4">
              <div className={todayEyebrowClass}>Weekly XP</div>
              <div className="mt-2 break-words font-display text-4xl text-[var(--primary)]">
                {shell.snapshot.metrics.weeklyXp}
              </div>
              <div className={`mt-1 text-sm ${todaySoftTextClass}`}>
                {shell.snapshot.metrics.totalXp} total XP
              </div>
            </Card>
            <Card className="min-w-0 p-4">
              <div className={todayEyebrowClass}>Level</div>
              <div
                className={`mt-2 font-display text-4xl ${todayStrongTextClass}`}
              >
                {shell.snapshot.metrics.level}
              </div>
              <div className={`mt-1 text-sm ${todaySoftTextClass}`}>
                {nextLevelXp} xp to the next level
              </div>
              {!compact ? (
                <div className="mt-3">
                  <ProgressMeter
                    value={
                      (shell.snapshot.metrics.currentLevelXp /
                        Math.max(1, shell.snapshot.metrics.nextLevelXp)) *
                      100
                    }
                    tone="tertiary"
                  />
                </div>
              ) : null}
            </Card>
            <Card className="min-w-0 p-4">
              <div className={todayEyebrowClass}>Momentum</div>
              <div
                className={`mt-2 font-display text-4xl ${todayStrongTextClass}`}
              >
                {shell.snapshot.metrics.momentumScore}%
              </div>
              <div className={`mt-1 text-sm ${todaySoftTextClass}`}>
                {shell.snapshot.metrics.streakDays} day streak
              </div>
            </Card>
            <Card className="min-w-0 p-4">
              <div className={todayEyebrowClass}>Next reward</div>
              <div
                className={`mt-2 break-words text-base font-semibold ${todayStrongTextClass}`}
              >
                {nextMilestone?.title ?? "Keep showing up"}
              </div>
              <div className={`mt-1 text-sm ${todaySoftTextClass}`}>
                {nextMilestone?.progressLabel ??
                  "The next visible win comes from a task completion or aligned habit check-in."}
              </div>
            </Card>
          </div>
        </TodayMetricsBox>
      )
    },
    {
      id: "runway",
      title: "Tasks",
      description: "Choose, start, or update today's tasks.",
      defaultWidth: 8,
      defaultHeight: 6,
      minWidth: 5,
      render: ({ compact }) => (
        <TodayRunwayBox>
          <DailyRunway
            tasks={runwayTodayTasks}
            timeline={shell.snapshot.today.timeline}
            goals={shell.snapshot.goals}
            tags={shell.snapshot.tags}
            notesSummaryByEntity={shell.snapshot.dashboard.notesSummaryByEntity}
            selectedTaskId={directive?.id ?? null}
            onSelectTask={(taskId) => navigate(`/tasks/${taskId}`)}
            onStartTask={async (taskId) => {
              await startTodayTask(taskId);
            }}
            onMove={async (taskId, nextStatus) => {
              await shell.patchTaskStatus(taskId, nextStatus);
            }}
            compact={compact}
          />
        </TodayRunwayBox>
      )
    },
    {
      id: "calendar",
      title: "Calendar",
      description: "Review today's scheduled events.",
      defaultWidth: 6,
      defaultHeight: 5,
      minWidth: 4,
      render: ({ compact }) => (
        <TodayCalendarBox>
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)]/14 text-[var(--primary)]">
                  <CalendarDays className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className={todayEyebrowClass}>Today&apos;s calendar</div>
                  <div
                    className={`text-sm font-semibold ${todayStrongTextClass}`}
                  >
                    {new Intl.DateTimeFormat(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric"
                    }).format(todayRange.start)}
                  </div>
                  <div className={`text-sm ${todaySoftTextClass}`}>
                    {todayEvents.length} event
                    {todayEvents.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <Link to="/calendar" className={todayGhostButtonClass}>
                Open calendar
                <ChevronRight className="size-3.5" />
              </Link>
            </div>
            {todayEvents.length === 0 ? (
              calendarQuery.isLoading ? (
                <div
                  role="status"
                  aria-live="polite"
                  className={`${todayInnerPanelClass} px-4 py-4 text-sm ${todaySoftTextClass}`}
                >
                  Loading today&apos;s calendar.
                </div>
              ) : calendarQuery.isError ? (
                <div
                  role="alert"
                  className={`${todayInnerPanelClass} grid gap-3 px-4 py-4 text-sm ${todaySoftTextClass}`}
                >
                  <span>
                    Calendar events are unavailable. The Today decision still
                    uses saved task timeboxes.
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    pending={calendarQuery.isFetching}
                    pendingLabel="Retrying"
                    className="w-fit"
                    onClick={() => void calendarQuery.refetch()}
                  >
                    <RefreshCcw className="size-3.5" />
                    Retry calendar
                  </Button>
                </div>
              ) : (
                <div
                  className={`${todayInnerPanelClass} px-4 py-4 text-sm ${todaySoftTextClass}`}
                >
                  Nothing is scheduled yet for today.
                </div>
              )
            ) : (
              visibleTodayEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={`${todayInnerPanelClass} grid gap-2 px-3 py-3 text-left transition hover:bg-[var(--ui-surface-hover)]`}
                  onClick={() => navigate("/calendar")}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-sm font-medium ${todayStrongTextClass}`}
                      >
                        {event.title}
                      </div>
                      <div className={`mt-1 text-sm ${todaySoftTextClass}`}>
                        {formatTodayEventWindow(event)}
                      </div>
                    </div>
                    <Badge className="shrink-0 bg-[var(--ui-surface-3)] text-[var(--ui-ink-medium)]">
                      {event.originType === "native"
                        ? "Forge"
                        : event.originType}
                    </Badge>
                  </div>
                  {!compact && event.description ? (
                    <div
                      className={`line-clamp-2 text-sm leading-6 ${todaySoftTextClass}`}
                    >
                      {event.description}
                    </div>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </TodayCalendarBox>
      )
    },
    {
      id: "focus",
      title: "Current focus",
      description: "Current work, recovery work, and due habits.",
      defaultWidth: 12,
      defaultHeight: 4,
      minWidth: 6,
      render: ({ compact }) => (
        <TodayFocusBox>
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className={`${todayPanelClass} p-4`}>
              <div className="flex items-center justify-between gap-3">
                <div className={todayEyebrowClass}>Current task</div>
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
              <div
                className={`mt-3 break-words text-base font-semibold ${todayStrongTextClass}`}
              >
                {directive?.title ??
                  (todayDecision?.mode === "overloaded"
                    ? "No new task recommended"
                    : todayDecision?.mode === "capacity-limited"
                      ? "No task fits current capacity"
                      : todayDecision?.mode === "unresolved-active"
                        ? "Active work needs review"
                        : todayDecision?.mode === "no-work"
                          ? "No startable work"
                          : priorityQuery.isLoading
                            ? "Loading current work"
                            : "Pick a task from the runway")}
              </div>
              <div className={`mt-2 text-sm leading-6 ${todaySoftTextClass}`}>
                {directive?.description ??
                  (todayDecision?.mode === "overloaded"
                    ? "Capacity is overloaded, so Today is not recommending a new start."
                    : todayDecision?.mode === "capacity-limited"
                      ? "The remaining AP budget is smaller than every open task. Split or replan before starting."
                      : todayDecision?.mode === "unresolved-active"
                        ? "Resolve the live run before starting other work."
                        : todayDecision?.mode === "no-work"
                          ? "No startable task is available in the selected scope."
                          : "Once a task is active, the timer rail and this panel stay aligned.")}
              </div>
              {directive && todayDecision?.mode === "ready" ? (
                <button
                  type="button"
                  className="mt-4 inline-flex min-h-10 max-w-full items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--primary)_24%,transparent)] bg-[var(--ui-accent-soft)] px-3.5 py-2 text-sm font-medium text-[var(--primary)] shadow-[var(--ui-shadow-soft)] transition hover:bg-[var(--ui-accent-soft-hover)]"
                  onClick={async () => {
                    await startTodayTask(directive.id);
                  }}
                >
                  Start work
                </button>
              ) : null}
            </div>
            <div className="grid gap-3">
              <div className={`${todayPanelClass} p-4`}>
                <div className={todayEyebrowClass}>Recovery task</div>
                <div
                  className={`mt-3 break-words text-sm font-semibold ${todayStrongTextClass}`}
                >
                  {comebackTask?.title ??
                    "No blocked or overdue task is dominating today"}
                </div>
                {!compact ? (
                  <div
                    className={`mt-2 text-sm leading-6 ${todaySoftTextClass}`}
                  >
                    {comebackTask?.description ??
                      "If something slips, it will surface here as the clean comeback move."}
                  </div>
                ) : null}
              </div>
              <div className={`${todayPanelClass} p-4`}>
                <div className={todayEyebrowClass}>Due habits</div>
                <div className="mt-3 grid gap-2">
                  {shell.snapshot.today.dueHabits
                    .slice(0, compact ? 2 : 3)
                    .map((habit) => (
                      <div
                        key={habit.id}
                        className={`${todayInnerPanelClass} flex items-center justify-between gap-3 px-3 py-2.5`}
                      >
                        <div className="min-w-0">
                          <div
                            className={`truncate text-sm font-medium ${todayStrongTextClass}`}
                          >
                            {habit.title}
                          </div>
                          {!compact ? (
                            <div className={`text-sm ${todaySoftTextClass}`}>
                              {habit.frequency}
                            </div>
                          ) : null}
                        </div>
                        <Badge className="shrink-0 bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_78%,var(--ui-ink-strong)_22%)]">
                          {habit.rewardXp} xp
                        </Badge>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </TodayFocusBox>
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

  return (
    <AiSurfaceWorkspace
      surfaceId="today"
      baseWidgets={widgets}
      normalizeLayout={normalizeTodayLayout}
    />
  );
}
