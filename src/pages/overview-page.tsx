import { Link } from "react-router-dom";
import { FlagshipSignalDeck } from "@/components/experience/flagship-signal-deck";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { PageHero } from "@/components/shell/page-hero";
import { XpCommandDeck } from "@/components/xp/xp-command-deck";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { InteractiveCard } from "@/components/ui/interactive-card";
import { MetricTile } from "@/components/ui/metric-tile";
import { EmptyState } from "@/components/ui/page-state";
import { useForgeShell } from "@/components/shell/app-shell";
import { getReadableActivityDescription, getReadableActivityTitle } from "@/lib/activity-copy";
import { useI18n } from "@/lib/i18n";
import { getEntityNotesSummary } from "@/lib/note-helpers";

export function OverviewPage() {
  const { t, formatDateTime } = useI18n();
  const { snapshot } = useForgeShell();
  const heroStatus = snapshot.metrics.momentumScore >= 80 ? "Strong" : snapshot.metrics.momentumScore >= 60 ? "Steady" : "Needs attention";
  const projectLookup = new Map(snapshot.projects.map((project) => [project.id, project]));
  const nextMilestone = snapshot.dashboard.milestoneRewards.find((reward) => !reward.completed) ?? snapshot.dashboard.milestoneRewards[0] ?? null;
  const unlockedAchievements = snapshot.dashboard.achievements.filter((achievement) => achievement.unlocked).length;
  const topTask = snapshot.overview.topTasks[0] ?? null;
  const topGoal = snapshot.overview.activeGoals[0] ?? null;
  const driftGoal = snapshot.overview.neglectedGoals[0] ?? null;
  const latestEvidence = snapshot.overview.recentEvidence[0] ?? null;
  const overviewMomentumPulse = {
    status:
      snapshot.metrics.momentumScore >= 80 ? "surging" : snapshot.metrics.momentumScore >= 60 ? "steady" : "recovering",
    headline:
      snapshot.metrics.momentumScore >= 80
        ? `${snapshot.metrics.streakDays}-day streak active. Your recent work is building on itself.`
        : snapshot.metrics.momentumScore >= 60
          ? "Momentum is stable. One useful push will keep things moving."
          : "Momentum is soft right now. One real win will help restart it.",
    detail:
      nextMilestone !== null
        ? `${nextMilestone.title} is the clean next unlock. ${nextMilestone.progressLabel}.`
        : `Level ${snapshot.metrics.level} is active with ${snapshot.metrics.weeklyXp} weekly XP recorded.`,
    celebrationLabel:
      unlockedAchievements > 0
        ? `${unlockedAchievements} achievement${unlockedAchievements === 1 ? "" : "s"} unlocked`
        : snapshot.metrics.weeklyXp >= 120
          ? "A strong week is taking shape"
          : "The next reward comes from a real completion or repair",
    nextMilestoneId: nextMilestone?.id ?? null,
    nextMilestoneLabel: nextMilestone?.rewardLabel ?? "Keep building visible momentum"
  } as const;
  const hasOverviewData =
    snapshot.overview.activeGoals.length > 0 ||
    snapshot.overview.projects.length > 0 ||
    snapshot.overview.topTasks.length > 0 ||
    snapshot.overview.recentEvidence.length > 0 ||
    snapshot.overview.neglectedGoals.length > 0;
  const overviewSignals = [
    {
      id: "top-task",
      label: topTask ? "Top task" : "Top goal",
      title:
        topTask ? (
          <EntityName kind="task" label={topTask.title} lines={3} labelClassName="[overflow-wrap:anywhere]" />
        ) : topGoal ? (
          <EntityName kind="goal" label={topGoal.title} lines={3} labelClassName="[overflow-wrap:anywhere]" />
        ) : (
          "Choose the next task"
        ),
      detail:
        topTask?.description ||
        topGoal?.description ||
        t("common.todayPage.noDirectiveDetail"),
      badge: topTask ? `${topTask.points} xp` : `${snapshot.overview.strategicHeader.focusTasks} focus tasks`,
      href: topTask ? `/tasks/${topTask.id}` : topGoal ? `/goals/${topGoal.id}` : "/goals",
      actionLabel: topTask ? "Open task" : "Open goal"
    },
    {
      id: "reward",
      label: "Next reward",
      title: nextMilestone?.title ?? "Keep the streak going",
      detail:
        nextMilestone?.progressLabel ??
        `Level ${snapshot.metrics.level} is live. ${snapshot.metrics.currentLevelXp} XP is already banked toward the next unlock.`,
      badge: nextMilestone?.rewardLabel ?? `${snapshot.metrics.comboMultiplier.toFixed(2)}x combo`,
      href: "/today",
      actionLabel: "Open today"
    },
    {
      id: "goal-needing-attention",
      label: "Goal needing attention",
      title: driftGoal ? <EntityName kind="goal" label={driftGoal.title} lines={3} labelClassName="[overflow-wrap:anywhere]" /> : "No goal needs urgent attention",
      detail:
        driftGoal?.summary ??
        `Only ${snapshot.overview.strategicHeader.overdueTasks} overdue task${snapshot.overview.strategicHeader.overdueTasks === 1 ? "" : "s"} are currently slowing the engine.`,
      badge: driftGoal?.risk ?? "stable",
      href: driftGoal ? `/goals/${driftGoal.goalId}` : "/today",
      actionLabel: driftGoal ? "Open goal" : "Open today"
    },
    {
      id: "recent-activity",
      label: "Recent activity",
      title: latestEvidence ? getReadableActivityTitle(latestEvidence) : `${unlockedAchievements} achievement${unlockedAchievements === 1 ? "" : "s"} unlocked`,
      detail:
        (latestEvidence ? getReadableActivityDescription(latestEvidence) : null) ??
        t("common.overview.noEvidence"),
      badge: latestEvidence?.source ?? `${snapshot.metrics.weeklyXp} weekly XP`,
      href: latestEvidence ? activityLink(latestEvidence) : "/activity",
      actionLabel: latestEvidence ? "Open item" : "Open activity"
    }
  ] as const;

  function activityLink(event: (typeof snapshot.overview.recentEvidence)[number]) {
    if (event.entityType === "goal") {
      return `/goals/${event.entityId}`;
    }
    if (event.entityType === "project") {
      return `/projects/${event.entityId}`;
    }
    if (event.entityType === "task") {
      return `/tasks/${event.entityId}`;
    }
    if (event.entityType === "task_run" && typeof event.metadata.taskId === "string") {
      return `/tasks/${event.metadata.taskId}`;
    }
    return `/activity?eventId=${event.id}`;
  }

  if (!hasOverviewData) {
    return (
      <div className="grid min-w-0 grid-cols-1 gap-5">
        <PageHero
          title="Overview"
          titleText="Overview"
          description="See your main goals, active projects, top tasks, recent activity, and current progress in one place."
          badge="0 live signals"
        />
        <EmptyState
          eyebrow={t("common.overview.heroEyebrow")}
          title={t("common.overview.emptyTitle")}
          description={t("common.overview.emptyDescription")}
          action={
            <Link to="/goals" className="inline-flex min-h-10 min-w-0 max-w-full items-center justify-center rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium whitespace-nowrap text-slate-950 transition hover:opacity-90">
              {t("common.overview.emptyAction")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <PageHero
        title="Overview"
        titleText="Overview"
        description={`${heroStatus}. See your main goals, active projects, top tasks, and recent activity in one place.`}
        badge={`${snapshot.metrics.streakDays} day streak`}
      />

      <XpCommandDeck
        profile={snapshot.metrics}
        achievements={snapshot.dashboard.achievements}
        milestoneRewards={snapshot.dashboard.milestoneRewards}
        momentumPulse={overviewMomentumPulse}
      />

      <FlagshipSignalDeck
        eyebrow="Actions"
        title="What you can open or act on right now"
        description="Each card below leads to a real task, goal, reward, or recent activity item."
        items={overviewSignals}
      />

      <section className="grid min-w-0 grid-cols-1 gap-5">
        <Card className="bg-[linear-gradient(180deg,rgba(19,24,40,0.96),rgba(11,15,27,0.96))]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                <span>Overview summary</span>
                <InfoTooltip content="This summarizes your current level, weekly XP, and the goal that most needs attention." />
              </div>
              <h2 className="mt-2 font-display text-[clamp(1.35rem,2vw,1.9rem)] text-white">Level, weekly XP, and what needs attention</h2>
            </div>
            <div className="max-w-full min-w-0 rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-white/62">
              {overviewMomentumPulse.status}
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <MetricTile label={t("common.overview.metricsLevel")} value={snapshot.metrics.level} tone="core" />
            <MetricTile label={t("common.overview.metricsWeeklyXp")} value={snapshot.metrics.weeklyXp} tone="core" detail="XP earned so far this week." />
            <InteractiveCard to={driftGoal ? `/goals/${driftGoal.goalId}` : "/today"} className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
              <div className="text-sm text-white/45">Goal needing attention</div>
              <div className="mt-2 font-medium text-white">{driftGoal?.title ?? "No goal needs urgent attention"}</div>
              <div className="mt-2 text-sm leading-6 text-white/58">
                {driftGoal?.summary ??
                  `Only ${snapshot.overview.strategicHeader.overdueTasks} overdue task${snapshot.overview.strategicHeader.overdueTasks === 1 ? "" : "s"} are currently slowing the engine.`}
              </div>
            </InteractiveCard>
          </div>
        </Card>

        <div className="grid min-w-0 grid-cols-1 gap-5">
          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Goals</div>
            {snapshot.overview.activeGoals.length === 0 ? (
              <div className="mt-4 rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/58">{t("common.overview.noGoals")}</div>
            ) : (
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {snapshot.overview.activeGoals.slice(0, 3).map((goal) => (
                  <InteractiveCard key={goal.id} to={`/goals/${goal.id}`} className="rounded-[22px] p-4">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <EntityBadge kind="goal" label={goal.tags[0]?.name ?? goal.horizon} compact gradient={false} />
                      <div className="shrink-0 text-[11px] uppercase tracking-[0.16em] text-white/42">{goal.progress}%</div>
                    </div>
                    <div className="mt-4">
                      <EntityName kind="goal" label={goal.title} variant="heading" size="lg" lines={3} className="max-w-full" labelClassName="[overflow-wrap:anywhere]" />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-white/60">{goal.description}</p>
                    <div className="mt-4">
                      <ProgressMeter value={goal.progress} />
                    </div>
                    <div className="mt-4">
                      <EntityNoteCountLink entityType="goal" entityId={goal.id} count={getEntityNotesSummary(snapshot.dashboard.notesSummaryByEntity, "goal", goal.id).count} />
                    </div>
                  </InteractiveCard>
                ))}
              </div>
            )}
          </Card>

          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <Card>
              <div className="flex items-center gap-2 font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                <span>Projects</span>
                <InfoTooltip content="These are the projects currently carrying active work." />
              </div>
              {snapshot.overview.projects.length === 0 ? (
                <div className="mt-4 rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/58">{t("common.overview.noProjects")}</div>
              ) : (
                <div className="mt-4 grid gap-3">
                  {snapshot.overview.projects.slice(0, 4).map((project) => (
                    <InteractiveCard key={project.id} to={`/projects/${project.id}`} className="rounded-[20px] px-4 py-4">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <EntityBadge kind="project" compact gradient={false} />
                          <EntityName kind="project" label={project.title} className="min-w-0" showIcon={false} lines={2} labelClassName="[overflow-wrap:anywhere]" />
                        </div>
                        <Badge wrap className="max-w-[8rem] shrink-0">{project.earnedPoints} xp</Badge>
                      </div>
                      <div className="mt-2 text-sm text-white/58">{project.description}</div>
                      <div className="mt-3">
                        <EntityBadge kind="goal" label={project.goalTitle} compact />
                      </div>
                      <div className="mt-4">
                        <EntityNoteCountLink entityType="project" entityId={project.id} count={getEntityNotesSummary(snapshot.dashboard.notesSummaryByEntity, "project", project.id).count} />
                      </div>
                    </InteractiveCard>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <div className="flex items-center gap-2 font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                <span>Tasks ready to start</span>
                <InfoTooltip content="These are the strongest task candidates to pick up next." />
              </div>
              {snapshot.overview.topTasks.length === 0 ? (
                <div className="mt-4 rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/58">{t("common.overview.noFocus")}</div>
              ) : (
                <div className="mt-4 grid gap-3">
                  {snapshot.overview.topTasks.slice(0, 4).map((task) => (
                    <InteractiveCard key={task.id} to={`/tasks/${task.id}`} className="rounded-[20px] px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <EntityBadge kind="task" compact gradient={false} />
                          <EntityName kind="task" label={task.title} className="min-w-0" showIcon={false} lines={2} labelClassName="[overflow-wrap:anywhere]" />
                        </div>
                        <Badge wrap>{task.points} xp</Badge>
                      </div>
                      <div className="mt-2 text-sm text-white/58">{task.description}</div>
                      <div className="mt-3">
                        {projectLookup.get(task.projectId ?? "")?.title ? (
                          <EntityBadge kind="project" label={projectLookup.get(task.projectId ?? "")?.title ?? ""} compact />
                        ) : (
                          <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">{t("common.overview.noProjectYet")}</div>
                        )}
                      </div>
                      <div className="mt-4">
                        <EntityNoteCountLink entityType="task" entityId={task.id} count={getEntityNotesSummary(snapshot.dashboard.notesSummaryByEntity, "task", task.id).count} />
                      </div>
                    </InteractiveCard>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card>
            <div className="flex items-center gap-2 font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              <span>Recent activity</span>
              <InfoTooltip content="This shows the latest visible work, completions, and corrections linked to your goals, projects, and tasks." />
            </div>
            {snapshot.overview.recentEvidence.length === 0 ? (
              <div className="mt-4 rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/58">{t("common.overview.noEvidence")}</div>
            ) : (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {snapshot.overview.recentEvidence.slice(0, 6).map((event) => (
                  <InteractiveCard key={event.id} to={activityLink(event)} className="rounded-[20px] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-white">{event.title}</div>
                        <div className="mt-2 text-sm leading-6 text-white/58">{event.description}</div>
                      </div>
                      <Badge wrap>{event.source}</Badge>
                    </div>
                    <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-white/35">{formatDateTime(event.createdAt)}</div>
                  </InteractiveCard>
                ))}
              </div>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
