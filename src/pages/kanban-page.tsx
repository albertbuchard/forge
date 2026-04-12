import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Scissors } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  KanbanBoardBox,
  KanbanFiltersBox,
  KanbanSummaryBox
} from "@/components/workbench-boxes/kanban/kanban-boxes";
import { ExecutionBoard } from "@/components/execution-board";
import { TaskDialog } from "@/components/task-dialog";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityName } from "@/components/ui/entity-name";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page-state";
import { deleteTask, patchTask, splitTask, uncompleteTask } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useCommandCenterStore } from "@/store/use-command-center";
import { useForgeShell } from "@/components/shell/app-shell";
import { getSingleSelectedUserId } from "@/lib/user-ownership";

function buildDefaultSplitTitles(title: string) {
  const cleaned = title.trim();
  if (cleaned.length === 0) {
    return {
      firstTitle: "Split task part 1",
      secondTitle: "Split task part 2"
    };
  }
  return {
    firstTitle: `${cleaned} - part 1`,
    secondTitle: `${cleaned} - part 2`
  };
}

export function KanbanPage() {
  const { t } = useI18n();
  const shell = useForgeShell();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    shell.snapshot.tasks[0]?.id ?? null
  );
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [splittingTaskId, setSplittingTaskId] = useState<string | null>(null);
  const [splitDraft, setSplitDraft] = useState({
    firstTitle: "",
    secondTitle: "",
    remainingRatio: 0.5
  });
  const {
    selectedGoalId,
    selectedUserId,
    selectedTagIds,
    setGoal,
    setUserId,
    toggleTag,
    reset
  } = useCommandCenterStore();

  const filteredTasks = shell.snapshot.tasks.filter((task) => {
    if (selectedGoalId && task.goalId !== selectedGoalId) {
      return false;
    }
    if (selectedUserId && task.userId !== selectedUserId) {
      return false;
    }
    if (
      selectedTagIds.length > 0 &&
      !selectedTagIds.every((tagId) => task.tagIds.includes(tagId))
    ) {
      return false;
    }
    return true;
  });

  const selectedTask =
    filteredTasks.find((task) => task.id === selectedTaskId) ??
    shell.snapshot.tasks.find((task) => task.id === selectedTaskId) ??
    null;
  const editingTask = editingTaskId
    ? (shell.snapshot.tasks.find((task) => task.id === editingTaskId) ?? null)
    : null;
  const blockedCount = filteredTasks.filter(
    (task) => task.status === "blocked"
  ).length;
  const doneCount = filteredTasks.filter(
    (task) => task.status === "done"
  ).length;
  const focusCount = filteredTasks.filter(
    (task) => task.status === "focus" || task.status === "in_progress"
  ).length;
  const liveRunCount = shell.snapshot.activeTaskRuns.length;
  const defaultUserId = getSingleSelectedUserId(shell.selectedUserIds);
  const splittingTask = splittingTaskId
    ? (shell.snapshot.tasks.find((task) => task.id === splittingTaskId) ?? null)
    : null;

  const invalidateBoard = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
      queryClient.invalidateQueries({ queryKey: ["project-board"] }),
      queryClient.invalidateQueries({ queryKey: ["task-context"] })
    ]);
  };

  const updateTaskMutation = useMutation({
    mutationFn: ({
      taskId,
      patch
    }: {
      taskId: string;
      patch: Parameters<typeof patchTask>[1];
    }) => patchTask(taskId, patch),
    onSuccess: invalidateBoard
  });
  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onSuccess: invalidateBoard
  });
  const splitTaskMutation = useMutation({
    mutationFn: ({
      taskId,
      firstTitle,
      secondTitle,
      remainingRatio
    }: {
      taskId: string;
      firstTitle: string;
      secondTitle: string;
      remainingRatio: number;
    }) =>
      splitTask(taskId, {
        firstTitle,
        secondTitle,
        remainingRatio
      }),
    onSuccess: async () => {
      await invalidateBoard();
      setSplittingTaskId(null);
    }
  });

  if (shell.snapshot.tasks.length === 0) {
    return (
      <div className="grid min-w-0 grid-cols-1 gap-5">
        <PageHero
          title="Kanban"
          description="Move tasks across the board, start work quickly, and keep your next step visible."
          badge="0 visible tasks"
          actions={
            <Button size="lg" onClick={() => shell.openStartWork()}>
              Start work
            </Button>
          }
        />
        <EmptyState
          eyebrow={t("common.kanban.heroEyebrow")}
          title={t("common.kanban.emptyTitle")}
          description={t("common.kanban.emptyDescription")}
          action={
            <Link
              to="/goals"
              className="inline-flex whitespace-nowrap rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium text-slate-950 transition hover:opacity-90"
            >
              {t("common.kanban.emptyAction")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <PageHero
        title="Kanban"
        description="Move tasks between states, start work directly from the board, or open a task when you need to edit it."
        badge={`${filteredTasks.length} visible tasks`}
        actions={
          <Button
            size="lg"
            onClick={() =>
              shell.openStartWork(
                selectedTask ? { taskId: selectedTask.id } : undefined
              )
            }
          >
            Start work
          </Button>
        }
      />

      <KanbanSummaryBox>
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Board
            </div>
            <div className="mt-2 text-base text-white">
              See what is not started, ready, active, blocked, or done, then
              move tasks where they belong.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className="bg-white/[0.08] text-white/72">
              {focusCount} ready or active
            </Badge>
            <Badge className="bg-white/[0.08] text-white/72">
              {blockedCount} blocked
            </Badge>
            <Badge className="bg-white/[0.08] text-white/72">
              {doneCount} done
            </Badge>
            <Badge className="bg-white/[0.08] text-white/72">
              {liveRunCount} live timer{liveRunCount === 1 ? "" : "s"}
            </Badge>
            <Badge className="bg-[var(--primary)]/12 text-[var(--primary)]">
              {Math.round(shell.snapshot.lifeForce?.spentTodayAp ?? 0)} /{" "}
              {Math.round(shell.snapshot.lifeForce?.dailyBudgetAp ?? 0)} AP
            </Badge>
          </div>
          </div>
        </Card>
      </KanbanSummaryBox>

      <KanbanFiltersBox>
        <Card className="min-w-0 overflow-hidden">
        <div className="type-label text-white/40">Filters</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="meta" className="bg-white/[0.08] text-white/60">
            Goal
          </Badge>
          <button
            className={`interactive-tap max-w-full rounded-full px-4 py-2 text-sm ${selectedGoalId === null ? "bg-white/[0.12] text-white" : "bg-white/[0.04] text-white/58"}`}
            onClick={() => setGoal(null)}
          >
            All goals
          </button>
          {shell.snapshot.goals.map((goal) => (
            <button
              key={goal.id}
              className={`interactive-tap min-w-0 max-w-full rounded-full px-4 py-2 text-sm ${selectedGoalId === goal.id ? "bg-white/[0.12] text-white" : "bg-white/[0.04] text-white/58"}`}
              onClick={() =>
                setGoal(selectedGoalId === goal.id ? null : goal.id)
              }
            >
              <EntityName
                kind="goal"
                label={goal.title}
                className="max-w-full min-w-0"
                lines={2}
                labelClassName="whitespace-normal text-left"
              />
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone="meta" className="bg-white/[0.08] text-white/60">
            Owner
          </Badge>
          <button
            className={`interactive-tap max-w-full rounded-full px-4 py-2 text-sm ${selectedUserId === null ? "bg-white/[0.12] text-white" : "bg-white/[0.04] text-white/58"}`}
            onClick={() => setUserId(null)}
          >
            Everyone
          </button>
          {shell.snapshot.users.map((user) => (
            <button
              key={user.id}
              className={`interactive-tap max-w-full rounded-full px-4 py-2 text-sm ${selectedUserId === user.id ? "bg-white/[0.12] text-white" : "bg-white/[0.04] text-white/58"}`}
              onClick={() =>
                setUserId(selectedUserId === user.id ? null : user.id)
              }
            >
              {user.displayName}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {shell.snapshot.tags.map((tag) => (
            <button
              key={tag.id}
              className={`interactive-tap max-w-full rounded-full px-4 py-2 text-sm ${selectedTagIds.includes(tag.id) ? "bg-white/[0.12] text-white" : "bg-white/[0.04] text-white/58"}`}
              onClick={() => toggleTag(tag.id)}
            >
              {tag.name}
            </button>
          ))}
          <button
            className="interactive-tap max-w-full rounded-full bg-white/[0.04] px-4 py-2 text-sm text-[var(--primary)]"
            onClick={reset}
          >
            Reset
          </button>
        </div>
        </Card>
      </KanbanFiltersBox>

      {filteredTasks.length === 0 ? (
        <EmptyState
          eyebrow={t("common.kanban.heroEyebrow")}
          title={t("common.kanban.noTasksMatch")}
          description="No tasks match the current filters. Reset the filters to bring the full board back."
          action={
            <Button variant="secondary" onClick={reset}>
              Reset
            </Button>
          }
        />
      ) : (
        <KanbanBoardBox>
          <ExecutionBoard
            tasks={filteredTasks}
            goals={shell.snapshot.goals}
            tags={shell.snapshot.tags}
            notesSummaryByEntity={shell.snapshot.dashboard.notesSummaryByEntity}
            selectedTaskId={selectedTaskId}
            onMove={async (taskId, nextStatus) => {
              await shell.patchTaskStatus(taskId, nextStatus);
            }}
            onQuickReopenTask={async (taskId) => {
              await uncompleteTask(taskId);
              await invalidateBoard();
            }}
            onDeleteTask={async (taskId) => {
              await deleteTaskMutation.mutateAsync(taskId);
              setSelectedTaskId((current) => {
                if (current !== taskId) {
                  return current;
                }
                return filteredTasks.find((task) => task.id !== taskId)?.id ?? null;
              });
              setEditingTaskId((current) => (current === taskId ? null : current));
            }}
            onStartTask={async (taskId) => {
              await shell.startTaskNow(taskId);
              setSelectedTaskId(taskId);
              await queryClient.invalidateQueries({
                queryKey: ["task-context", taskId]
              });
            }}
            onSelectTask={(taskId) => {
              setSelectedTaskId(taskId);
            }}
            onOpenTask={(taskId) => {
              navigate(`/tasks/${taskId}`);
            }}
            onEditTask={(taskId) => {
              setEditingTaskId(taskId);
            }}
            onSplitTask={(taskId) => {
              const task =
                shell.snapshot.tasks.find((entry) => entry.id === taskId) ?? null;
              if (!task) {
                return;
              }
              const defaultTitles = buildDefaultSplitTitles(task.title);
              setSplittingTaskId(taskId);
              setSplitDraft({
                firstTitle: defaultTitles.firstTitle,
                secondTitle: defaultTitles.secondTitle,
                remainingRatio: 0.5
              });
            }}
          />
        </KanbanBoardBox>
      )}

      <TaskDialog
        open={editingTask !== null}
        goals={shell.snapshot.goals}
        projects={shell.snapshot.dashboard.projects}
        tags={shell.snapshot.tags}
        users={shell.snapshot.users}
        editingTask={editingTask}
        defaultUserId={editingTask?.userId ?? defaultUserId}
        onOpenChange={(open) => {
          if (!open) {
            setEditingTaskId(null);
          }
        }}
        onSubmit={async (input, taskId) => {
          if (!taskId) {
            return;
          }
          await updateTaskMutation.mutateAsync({ taskId, patch: input });
          setEditingTaskId(null);
        }}
      />

      {splittingTask ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(5,8,18,0.74)] p-4 backdrop-blur-xl">
          <Card className="w-full max-w-xl border border-white/10 bg-[linear-gradient(180deg,rgba(16,22,36,0.96),rgba(9,13,22,0.98))] shadow-[0_32px_90px_rgba(5,8,18,0.58)]">
            <div className="flex items-start gap-3">
              <div className="mt-1 flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-400/14 text-amber-100">
                <Scissors className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="font-display text-[1.35rem] leading-tight text-white">
                  Split this task
                </div>
                <div className="mt-2 text-sm leading-6 text-white/64">
                  {splittingTask.title} has grown beyond its expected shape.
                  Split the remaining work into two child tasks while keeping
                  the original history intact.
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              <div className="grid gap-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                  First task name
                </div>
                <Input
                  value={splitDraft.firstTitle}
                  onChange={(event) =>
                    setSplitDraft((current) => ({
                      ...current,
                      firstTitle: event.target.value
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                  Second task name
                </div>
                <Input
                  value={splitDraft.secondTitle}
                  onChange={(event) =>
                    setSplitDraft((current) => ({
                      ...current,
                      secondTitle: event.target.value
                    }))
                  }
                />
              </div>
              <div className="grid gap-3 rounded-[18px] bg-white/[0.04] px-4 py-4">
                <div className="flex items-center justify-between gap-3 text-sm text-white/70">
                  <span>Remaining work ratio</span>
                  <span>{Math.round(splitDraft.remainingRatio * 100)}% / {100 - Math.round(splitDraft.remainingRatio * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={25}
                  max={75}
                  step={5}
                  value={Math.round(splitDraft.remainingRatio * 100)}
                  onChange={(event) =>
                    setSplitDraft((current) => ({
                      ...current,
                      remainingRatio: Number(event.target.value) / 100
                    }))
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-white/[0.08] text-white/72">
                    {Math.round(
                      (splittingTask.actionPointSummary?.totalCostAp ?? 0) *
                        splitDraft.remainingRatio
                    )}{" "}
                    AP first child
                  </Badge>
                  <Badge className="bg-white/[0.08] text-white/72">
                    {Math.round(
                      (splittingTask.actionPointSummary?.totalCostAp ?? 0) *
                        (1 - splitDraft.remainingRatio)
                    )}{" "}
                    AP second child
                  </Badge>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setSplittingTaskId(null);
                }}
              >
                Cancel
              </Button>
              <Button
                pending={splitTaskMutation.isPending}
                disabled={
                  splitDraft.firstTitle.trim().length === 0 ||
                  splitDraft.secondTitle.trim().length === 0
                }
                onClick={() => {
                  void splitTaskMutation.mutateAsync({
                    taskId: splittingTask.id,
                    firstTitle: splitDraft.firstTitle.trim(),
                    secondTitle: splitDraft.secondTitle.trim(),
                    remainingRatio: splitDraft.remainingRatio
                  });
                }}
              >
                Create split tasks
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
