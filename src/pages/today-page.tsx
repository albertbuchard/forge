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
import { useI18n } from "@/lib/i18n";

export function TodayPage() {
  const { t } = useI18n();
  const shell = useForgeShell();
  const navigate = useNavigate();
  const directive = shell.snapshot.today.directive.task;
  const nextMilestone = shell.snapshot.today.milestoneRewards.find((reward) => !reward.completed) ?? shell.snapshot.today.milestoneRewards[0] ?? null;
  const comebackTask = shell.snapshot.risk.blockedTasks[0] ?? shell.snapshot.risk.overdueTasks[0] ?? null;
  const nextLevelXp = Math.max(0, shell.snapshot.metrics.nextLevelXp - shell.snapshot.metrics.currentLevelXp);
  const START_BOUNTY_XP = 8;
  const TIME_BOUNTY_XP = 4;
  const TIME_BOUNTY_MINUTES = 10;
  const FINISH_BOUNTY_XP = 20;
  const hasTodayData =
    directive !== null ||
    shell.snapshot.overview.topTasks.length > 0 ||
    shell.snapshot.today.dueHabits.length > 0 ||
    shell.snapshot.today.dailyQuests.length > 0 ||
    shell.snapshot.today.milestoneRewards.length > 0;

  if (!hasTodayData) {
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

      <section className="grid gap-3 lg:grid-cols-4">
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

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.4fr)_24rem]">
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
