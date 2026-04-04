import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { PageHero } from "@/components/shell/page-hero";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { DailyRunway } from "@/components/daily-runway";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { EmptyState } from "@/components/ui/page-state";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { useForgeShell } from "@/components/shell/app-shell";
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

function eventFallsOnDay(event: CalendarEvent, range: { start: Date; end: Date }) {
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
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const navigate = useNavigate();
  const todayRange = useMemo(() => buildTodayRange(), []);
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
  const nextMilestone = shell.snapshot.today.milestoneRewards.find((reward) => !reward.completed) ?? shell.snapshot.today.milestoneRewards[0] ?? null;
  const comebackTask = shell.snapshot.risk.blockedTasks[0] ?? shell.snapshot.risk.overdueTasks[0] ?? null;
  const nextLevelXp = Math.max(0, shell.snapshot.metrics.nextLevelXp - shell.snapshot.metrics.currentLevelXp);
  const START_BOUNTY_XP = 8;
  const TIME_BOUNTY_XP = 4;
  const TIME_BOUNTY_MINUTES = 10;
  const FINISH_BOUNTY_XP = 20;
  const todayEvents = useMemo(
    () =>
      (calendarQuery.data?.calendar.events ?? [])
        .filter((event) => !event.deletedAt && event.status !== "cancelled" && eventFallsOnDay(event, todayRange))
        .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime()),
    [calendarQuery.data?.calendar.events, todayRange]
  );
  const visibleTodayEvents = todayEvents.slice(0, MAX_VISIBLE_TODAY_EVENTS);
  const hasCalendarEvents = todayEvents.length > 0;
  const todayDateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric"
      }).format(todayRange.start),
    [todayRange.start]
  );
  const hasTodayData =
    directive !== null ||
    shell.snapshot.overview.topTasks.length > 0 ||
    shell.snapshot.today.dueHabits.length > 0 ||
    shell.snapshot.today.dailyQuests.length > 0 ||
    shell.snapshot.today.milestoneRewards.length > 0 ||
    hasCalendarEvents;

  if (!hasTodayData && !calendarQuery.isLoading) {
    return (
      <div className="grid gap-5">
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
            <Link to="/goals" className="inline-flex min-h-10 min-w-max shrink-0 items-center justify-center rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium whitespace-nowrap text-slate-950 transition hover:opacity-90">
              {t("common.todayPage.emptyAction")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-5">
      <PageHero
        title="Today"
        titleText="Today"
        description={directive?.description ?? "Start one real task, collect XP, and keep today's work moving."}
        badge={`${shell.snapshot.metrics.weeklyXp} weekly xp`}
      />

      <section className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <Card>
          <div className="flex items-center gap-2">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Weekly XP</div>
            <InfoTooltip content="Weekly XP is the XP earned since the start of the current week." />
          </div>
          <div className="mt-3 font-display text-4xl text-[var(--primary)]">{shell.snapshot.metrics.weeklyXp}</div>
          <div className="mt-2 text-sm text-white/58">Total XP: {shell.snapshot.metrics.totalXp}</div>
        </Card>
        <Card>
          <div className="flex items-center gap-2">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Level</div>
            <InfoTooltip content="Levels come from total XP. The progress bar below shows how much XP is left before the next level." />
          </div>
          <div className="mt-3 font-display text-4xl text-white">{shell.snapshot.metrics.level}</div>
          <div className="mt-2 text-sm text-white/58">{nextLevelXp} xp to next level</div>
          <div className="mt-3">
            <ProgressMeter value={(shell.snapshot.metrics.currentLevelXp / shell.snapshot.metrics.nextLevelXp) * 100} tone="tertiary" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-2">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Momentum</div>
            <InfoTooltip content="Momentum is a simple signal that combines weekly XP, active work, and overdue drag." />
          </div>
          <div className="mt-3 font-display text-4xl text-white">{shell.snapshot.metrics.momentumScore}%</div>
          <div className="mt-2 text-sm text-white/58">{shell.snapshot.metrics.streakDays} day streak</div>
        </Card>
        <Card>
          <div className="flex items-center gap-2">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Reward flows</div>
            <InfoTooltip content="Starting work, staying in work, completing work, and aligned habit check-ins all move XP through the same ledger." />
          </div>
          <div className="mt-3 grid gap-2 text-sm text-white/70">
            <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.04] px-3 py-2"><span>Start work</span><Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">+{START_BOUNTY_XP} xp</Badge></div>
            <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.04] px-3 py-2"><span>Every {TIME_BOUNTY_MINUTES} min</span><Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">+{TIME_BOUNTY_XP} xp</Badge></div>
            <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.04] px-3 py-2"><span>Complete timer</span><Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">+{FINISH_BOUNTY_XP} xp</Badge></div>
            <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.04] px-3 py-2"><span>Aligned habit check-in</span><Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">Habit XP</Badge></div>
          </div>
        </Card>
      </section>

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,22rem)] 2xl:grid-cols-[minmax(0,1.35fr)_24rem]">
        <div className="min-w-0">
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
        </div>

        <div className="grid min-w-0 gap-5">
          {hasCalendarEvents ? (
            <Card className="min-w-0 overflow-hidden">
              <div className="flex items-center gap-2">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Today&apos;s calendar</div>
                <InfoTooltip content="These are the calendar events already on today. Open any row to continue in the Calendar page." />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)]/14 text-[var(--primary)]">
                    <CalendarDays className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">{todayDateLabel}</div>
                    <div className="text-sm text-white/58">
                      {todayEvents.length} event{todayEvents.length === 1 ? "" : "s"} scheduled
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
              <div className="mt-4 grid gap-2.5">
                {visibleTodayEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className="grid min-w-0 gap-2 rounded-[18px] bg-white/[0.04] px-3 py-3 text-left transition hover:bg-white/[0.07]"
                    onClick={() => navigate("/calendar")}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">{event.title}</div>
                        <div className="mt-1 text-sm text-white/58">{formatTodayEventWindow(event)}</div>
                      </div>
                      <Badge className="shrink-0 bg-white/[0.08] text-white/72">
                        {event.originType === "native" ? "Forge" : event.originType}
                      </Badge>
                    </div>
                    {event.description ? (
                      <div className="line-clamp-2 text-sm leading-6 text-white/52">{event.description}</div>
                    ) : null}
                  </button>
                ))}
                {todayEvents.length > MAX_VISIBLE_TODAY_EVENTS ? (
                  <Link
                    to="/calendar"
                    className="inline-flex items-center justify-between rounded-[18px] bg-white/[0.03] px-3 py-3 text-sm text-white/62 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    <span>See {todayEvents.length - MAX_VISIBLE_TODAY_EVENTS} more events in Calendar</span>
                    <ChevronRight className="size-4" />
                  </Link>
                ) : null}
              </div>
            </Card>
          ) : null}

          <Card className="min-w-0 overflow-hidden">
            <div className="flex items-center gap-2">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Current task</div>
              <InfoTooltip content="This is the task Forge currently considers the best anchor for today." />
            </div>
            {directive ? (
              <button type="button" className="mt-4 grid w-full gap-3 rounded-[20px] bg-white/[0.04] p-4 text-left transition hover:bg-white/[0.06]" onClick={() => navigate(`/tasks/${directive.id}`)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-white">{directive.title}</div>
                    <div className="mt-2 text-sm leading-6 text-white/58">{directive.description || "No description yet."}</div>
                  </div>
                  <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">{shell.snapshot.today.directive.rewardXp} xp</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {shell.snapshot.today.directive.goalTitle ? <Badge className="bg-white/[0.08] text-white/72">{shell.snapshot.today.directive.goalTitle}</Badge> : null}
                  <Badge className="bg-white/[0.08] text-white/72">{shell.snapshot.today.directive.sessionLabel}</Badge>
                  <EntityNoteCountLink entityType="task" entityId={directive.id} count={shell.snapshot.dashboard.notesSummaryByEntity[`task:${directive.id}`]?.count ?? 0} />
                </div>
              </button>
            ) : (
              <div className="mt-4 rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/58">No task is selected for today yet. Start one from the list on the left.</div>
            )}
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <div className="flex items-center gap-2">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Due habits</div>
              <InfoTooltip content="Recurring records that still need a truthful check-in today." />
            </div>
            {shell.snapshot.today.dueHabits.length === 0 ? (
              <div className="mt-4 rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/58">No due habits are waiting on today.</div>
            ) : (
              <div className="mt-4 grid min-w-0 gap-3">
                {shell.snapshot.today.dueHabits.map((habit) => (
                  <Link key={habit.id} to="/habits" className="grid gap-3 rounded-[20px] bg-white/[0.04] p-4 transition hover:bg-white/[0.06]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-white">{habit.title}</div>
                        <div className="mt-2 text-sm leading-6 text-white/58">{habit.description || "Recurring operating commitment."}</div>
                      </div>
                      <Badge className="bg-white/[0.08] text-white/72">{habit.polarity}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">+{habit.rewardXp} xp aligned</Badge>
                      <Badge className="bg-white/[0.08] text-white/72">Streak {habit.streakCount}</Badge>
                      <EntityNoteCountLink entityType="habit" entityId={habit.id} count={shell.snapshot.dashboard.notesSummaryByEntity[`habit:${habit.id}`]?.count ?? 0} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <div className="flex items-center gap-2">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">{t("common.todayPage.questsTitle")}</div>
              <InfoTooltip content="Daily rewards are small XP targets for today. They should support real work, not replace it." />
            </div>
            {shell.snapshot.today.dailyQuests.length === 0 ? (
              <div className="mt-4 rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/58">{t("common.todayPage.questsEmpty")}</div>
            ) : (
              <div className="mt-4 grid min-w-0 gap-3">
                {shell.snapshot.today.dailyQuests.map((quest) => (
                  <div key={quest.id} className="rounded-[20px] bg-white/[0.04] p-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium leading-tight text-white">{quest.title}</div>
                        <div className="mt-2 text-sm leading-6 text-white/58">{quest.summary}</div>
                      </div>
                      <Badge className={`shrink-0 self-start ${quest.completed ? "text-emerald-300" : "text-[var(--tertiary)]"}`}>+{quest.rewardXp} xp</Badge>
                    </div>
                    <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-white/38">{quest.progressLabel}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <div className="flex items-center gap-2">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">{t("common.todayPage.rewardsTitle")}</div>
              <InfoTooltip content="Milestones are larger progress targets that stay active across multiple days." />
            </div>
            {shell.snapshot.today.milestoneRewards.length === 0 ? (
              <div className="mt-4 rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/58">{t("common.todayPage.rewardsEmpty")}</div>
            ) : (
              <div className="mt-4 grid min-w-0 gap-3">
                {shell.snapshot.today.milestoneRewards.map((reward) => (
                  <div key={reward.id} className="overflow-hidden rounded-[20px] bg-white/[0.04] p-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium leading-tight text-white">{reward.title}</div>
                        <div className="mt-2 text-sm text-white/58">{reward.summary}</div>
                      </div>
                      <Badge className="max-w-[10.5rem] shrink-0 self-start">{reward.rewardLabel}</Badge>
                    </div>
                    <div className="mt-4">
                      <ProgressMeter value={(reward.current / reward.target) * 100} tone="tertiary" />
                    </div>
                    <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-white/38">{reward.progressLabel}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <div className="flex items-center gap-2">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Needs attention</div>
              <InfoTooltip content="This highlights the blocked or overdue task most likely to slow you down if ignored." />
            </div>
            {comebackTask ? (
              <button type="button" className="mt-4 grid w-full gap-3 rounded-[20px] bg-white/[0.04] p-4 text-left transition hover:bg-white/[0.06]" onClick={() => navigate(`/tasks/${comebackTask.id}`)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-white">{comebackTask.title}</div>
                    <div className="mt-2 text-sm leading-6 text-white/58">{comebackTask.description || shell.snapshot.today.momentum.recoveryHint}</div>
                  </div>
                  <Badge className="bg-white/[0.08] text-white/72">{comebackTask.status.replaceAll("_", " ")}</Badge>
                </div>
              </button>
            ) : (
              <div className="mt-4 rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/58">{shell.snapshot.today.momentum.recoveryHint}</div>
            )}
            {nextMilestone ? (
              <div className="mt-4 rounded-[20px] bg-white/[0.04] p-4">
                <div className="text-sm font-medium text-white">{nextMilestone.title}</div>
                <div className="mt-2 text-sm text-white/58">{nextMilestone.progressLabel}</div>
              </div>
            ) : null}
          </Card>
        </div>
      </section>
    </div>
  );
}
