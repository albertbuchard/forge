import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ExecutionBoard } from "@/components/execution-board";
import { TaskDialog } from "@/components/task-dialog";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityName } from "@/components/ui/entity-name";
import { EmptyState } from "@/components/ui/page-state";
import { deleteTask, patchTask, uncompleteTask } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useCommandCenterStore } from "@/store/use-command-center";
import { useForgeShell } from "@/components/shell/app-shell";
import { getSingleSelectedUserId } from "@/lib/user-ownership";

export function KanbanPage() {
  const { t } = useI18n();
  const shell = useForgeShell();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    shell.snapshot.tasks[0]?.id ?? null
  );
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
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
          </div>
        </div>
      </Card>

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
        />
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
    </div>
  );
}
