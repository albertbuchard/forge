import { ArrowRight, CheckCheck, Crosshair, Play, ShieldAlert } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { useI18n } from "@/lib/i18n";
import type { Goal, Tag, Task, TaskStatus } from "@/lib/types";

function getGoalTitle(task: Task, goals: Goal[], fallback: string) {
  return goals.find((goal) => goal.id === task.goalId)?.title ?? fallback;
}

function getTaskTags(task: Task, tags: Tag[]) {
  return task.tagIds.map((tagId) => tags.find((tag) => tag.id === tagId)).filter(Boolean) as Tag[];
}

function handleCardKeyDown(event: KeyboardEvent<HTMLElement>, onActivate: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate();
  }
}

function getNextAction(task: Task, labels: Record<"backlog" | "focus" | "in_progress" | "blocked", string>): { label: string; nextStatus?: TaskStatus; action: "start" | "move"; icon: typeof Crosshair } | null {
  switch (task.status) {
    case "backlog":
      return { label: labels.backlog, action: "start", icon: Play };
    case "focus":
      return { label: labels.focus, action: "start", icon: Play };
    case "in_progress":
      return { label: labels.in_progress, nextStatus: "done", action: "move", icon: CheckCheck };
    case "blocked":
      return { label: labels.blocked, action: "start", icon: Play };
    default:
      return null;
  }
}

export function DailyRunway({
  tasks,
  timeline,
  goals,
  tags,
  selectedTaskId,
  onSelectTask,
  onMove,
  onStartTask
}: {
  tasks: Task[];
  timeline: Array<{ id: string; label: string; tasks: Task[] }>;
  goals: Goal[];
  tags: Tag[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onMove: (taskId: string, nextStatus: TaskStatus) => Promise<void>;
  onStartTask: (taskId: string) => Promise<void>;
}) {
  const { t, formatDate } = useI18n();
  const nextActionLabels = {
    backlog: t("common.dailyRunway.actionBacklog"),
    focus: t("common.dailyRunway.actionFocus"),
    in_progress: t("common.dailyRunway.actionProgress"),
    blocked: t("common.dailyRunway.actionBlocked")
  } as const;
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.9fr)]">
      <div className="min-w-0 rounded-[24px] bg-white/[0.04] p-4">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">{t("common.dailyRunway.runwayEyebrow")}</div>
              <InfoTooltip content="These are the tasks that matter most for today. Click a card to open the task details. Use Start to begin work immediately." />
            </div>
            <h4 className="mt-2 font-display text-2xl text-white">{t("common.dailyRunway.runwayTitle")}</h4>
          </div>
          <Badge className="shrink-0 text-[var(--primary)]">{t(tasks.length === 1 ? "common.dailyRunway.prioritiesOne" : "common.dailyRunway.prioritiesOther", { count: tasks.length })}</Badge>
        </div>

        <div className="mt-4 grid min-w-0 gap-3">
          {tasks.map((task, index) => {
            const nextAction = getNextAction(task, nextActionLabels);
            const taskTags = getTaskTags(task, tags).slice(0, 2);
            const isSelected = selectedTaskId === task.id;

            return (
              <article
                key={task.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                className={`grid w-full gap-3 rounded-[22px] px-4 py-4 text-left transition ${
                  isSelected
                    ? "bg-[linear-gradient(180deg,rgba(192,193,255,0.16),rgba(192,193,255,0.05))] shadow-[inset_0_0_0_1px_rgba(192,193,255,0.2)]"
                    : "bg-white/[0.03] hover:bg-white/[0.06]"
                }`}
                onClick={() => onSelectTask(task.id)}
                onKeyDown={(event) => handleCardKeyDown(event, () => onSelectTask(task.id))}
              >
                <div className="flex min-w-0 items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                      {t("common.dailyRunway.runwayItem", { index: index + 1 })}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <EntityBadge kind="goal" label={getGoalTitle(task, goals, t("common.dailyRunway.unassigned"))} compact gradient={false} />
                      {task.time.activeRunCount > 0 ? <Badge className="bg-emerald-500/12 text-emerald-200">Live</Badge> : null}
                    </div>
                    <div className="mt-2">
                      <EntityName kind="task" label={task.title} variant="heading" size="md" />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-white/60">{task.description || t("common.dailyRunway.noNote")}</p>
                  </div>
                  <Badge className="shrink-0 self-start">{task.status.replaceAll("_", " ")}</Badge>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">{task.points} xp</Badge>
                  {task.time.totalCreditedSeconds > 0 ? <Badge className="bg-white/[0.08] text-white/70">{Math.floor(task.time.totalCreditedSeconds / 60)} min tracked</Badge> : null}
                  <Badge className="bg-white/[0.08] text-white/70">{task.effort}</Badge>
                  <Badge className="bg-white/[0.08] text-white/70">{formatDate(task.dueDate)}</Badge>
                  {taskTags.map((tag) => (
                    <Badge key={tag.id} className="bg-white/[0.08]" style={{ color: tag.color }}>
                      {tag.name}
                    </Badge>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">{task.owner}</div>
                  {nextAction ? (
                    <Button
                      variant={nextAction.action === "start" ? "primary" : "secondary"}
                      className="px-3 py-2 text-[11px] uppercase tracking-[0.16em]"
                      onClick={async (event) => {
                        event.stopPropagation();
                        if (nextAction.action === "start") {
                          await onStartTask(task.id);
                          return;
                        }
                        if (nextAction.nextStatus) {
                          await onMove(task.id, nextAction.nextStatus);
                        }
                      }}
                    >
                      <nextAction.icon className="mr-2 size-3.5" />
                      {nextAction.label}
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="min-w-0 rounded-[24px] bg-white/[0.04] p-4">
        <div className="flex items-center gap-2">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">{t("common.dailyRunway.timelineEyebrow")}</div>
          <InfoTooltip content="This groups today's tasks by status, so you can see what is already moving, what is ready to start, what is blocked, and what is done." />
        </div>
        <h4 className="mt-2 font-display text-2xl text-white">{t("common.dailyRunway.timelineTitle")}</h4>
        <div className="mt-4 grid min-w-0 gap-3">
          {timeline.map((bucket) => (
            <div key={bucket.id} className="rounded-[20px] bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-white">{bucket.label}</div>
                <Badge className="bg-white/[0.08] text-white/65">{bucket.tasks.length}</Badge>
              </div>
              <div className="mt-3 grid gap-2">
                {bucket.tasks.slice(0, 3).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.06]"
                    onClick={() => onSelectTask(task.id)}
                  >
                    <div className="min-w-0">
                      <EntityName kind="task" label={task.title} className="max-w-full" />
                      <div className="mt-2">
                        <EntityBadge kind="goal" label={getGoalTitle(task, goals, t("common.dailyRunway.unassigned"))} compact gradient={false} />
                      </div>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-white/35" />
                  </button>
                ))}
                {bucket.tasks.length === 0 ? <div className="text-sm text-white/42">{t("common.dailyRunway.emptyBucket")}</div> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
