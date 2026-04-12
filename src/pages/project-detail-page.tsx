import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SchedulingRulesEditor } from "@/components/calendar/scheduling-rules-editor";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { OpenInGraphButton } from "@/components/knowledge-graph/open-in-graph-button";
import { ProjectDialog } from "@/components/project-dialog";
import { TaskDialog } from "@/components/task-dialog";
import { WorkAdjustmentDialog } from "@/components/work-adjustment-dialog";
import { ExecutionBoard } from "@/components/execution-board";
import { NoteMarkdown } from "@/components/notes/note-markdown";
import { EntityNotesSurface } from "@/components/notes/entity-notes-surface";
import { PreferenceEntityHandoffButton } from "@/components/preferences/preference-entity-handoff-button";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { ErrorState } from "@/components/ui/page-state";
import { UserBadge } from "@/components/ui/user-badge";
import {
  createWorkAdjustment,
  deleteProject,
  deleteTask,
  getCalendarOverview,
  getProjectBoard,
  patchProject,
  patchTask,
  uncompleteTask
} from "@/lib/api";
import {
  getReadableActivityDescription,
  getReadableActivityTitle
} from "@/lib/activity-copy";
import { evaluateSchedulingRulesNow } from "@/lib/calendar-rules";
import { getActivityEventHref } from "@/lib/entity-links";
import { useI18n } from "@/lib/i18n";
import { useForgeShell } from "@/components/shell/app-shell";
import type { Project } from "@/lib/types";
import { getSingleSelectedUserId } from "@/lib/user-ownership";

function isLegacyProjectId(projectId: string | undefined): boolean {
  return Boolean(projectId && projectId.startsWith("campaign:"));
}

export function ProjectDetailPage() {
  const { t } = useI18n();
  const shell = useForgeShell();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [workAdjustmentOpen, setWorkAdjustmentOpen] = useState(false);
  const [calendarWindow] = useState(() => {
    const now = new Date();
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now);
    to.setHours(23, 59, 59, 999);
    return {
      from: from.toISOString(),
      to: to.toISOString()
    };
  });
  const defaultUserId = getSingleSelectedUserId(selectedUserIds);
  const legacyProject =
    shell.snapshot.dashboard.projects.find(
      (project) => project.id === params.projectId
    ) ?? null;
  const goal = legacyProject
    ? (shell.snapshot.goals.find(
        (entry) => entry.id === legacyProject.goalId
      ) ?? null)
    : null;
  const fallbackTasks = legacyProject
    ? shell.snapshot.tasks.filter(
        (task) =>
          task.projectId === legacyProject.id ||
          (!task.projectId && task.goalId === legacyProject.goalId)
      )
    : [];
  const fallbackTaskIds = new Set(fallbackTasks.map((task) => task.id));
  const fallbackActivity = legacyProject
    ? shell.snapshot.activity.filter(
        (event) =>
          event.entityId === legacyProject.goalId ||
          event.entityId === legacyProject.id ||
          fallbackTaskIds.has(event.entityId) ||
          (event.entityType === "task_run" &&
            typeof event.metadata.taskId === "string" &&
            fallbackTaskIds.has(event.metadata.taskId))
      )
    : [];
  const isLegacyProject = isLegacyProjectId(params.projectId);

  const projectBoardQuery = useQuery({
    queryKey: ["project-board", params.projectId],
    queryFn: () => getProjectBoard(params.projectId!),
    enabled: Boolean(params.projectId) && !isLegacyProject
  });
  const calendarOverviewQuery = useQuery({
    queryKey: [
      "project-calendar-overview",
      params.projectId,
      calendarWindow.from,
      calendarWindow.to,
      ...selectedUserIds
    ],
    queryFn: () =>
      getCalendarOverview({
        ...calendarWindow,
        userIds: selectedUserIds
      }),
    enabled: Boolean(params.projectId) && !isLegacyProject
  });

  const reopenMutation = useMutation({
    mutationFn: (taskId: string) => uncompleteTask(taskId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
        queryClient.invalidateQueries({
          queryKey: ["project-board", params.projectId]
        })
      ]);
    }
  });
  const workAdjustmentMutation = useMutation({
    mutationFn: createWorkAdjustment,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
        queryClient.invalidateQueries({
          queryKey: ["project-board", params.projectId]
        }),
        queryClient.invalidateQueries({ queryKey: ["forge-xp-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-reward-ledger"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-operator-context"] })
      ]);
    }
  });
  const lifecycleMutation = useMutation({
    mutationFn: (status: Project["status"]) =>
      patchProject(params.projectId!, { status }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
        queryClient.invalidateQueries({
          queryKey: ["project-board", params.projectId]
        }),
        queryClient.invalidateQueries({ queryKey: ["forge-xp-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-reward-ledger"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-operator-context"] })
      ]);
    }
  });
  const deleteProjectMutation = useMutation({
    mutationFn: () => deleteProject(params.projectId!),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
        queryClient.invalidateQueries({
          queryKey: ["project-board", params.projectId]
        })
      ]);
      navigate("/projects");
    }
  });
  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
        queryClient.invalidateQueries({
          queryKey: ["project-board", params.projectId]
        }),
        queryClient.invalidateQueries({ queryKey: ["task-context"] })
      ]);
    }
  });

  const payload =
    projectBoardQuery.data ??
    (legacyProject && goal
      ? {
          project: legacyProject,
          goal,
          tasks: fallbackTasks,
          activity: fallbackActivity
        }
      : undefined);
  const editingProject =
    shell.snapshot.dashboard.projects.find(
      (project) => project.id === params.projectId
    ) ?? null;

  if (projectBoardQuery.isError && !isLegacyProject) {
    return (
      <ErrorState
        eyebrow={t("common.projectDetail.errorEyebrow")}
        error={projectBoardQuery.error}
        onRetry={() => void projectBoardQuery.refetch()}
      />
    );
  }

  if (!payload) {
    return <SurfaceSkeleton />;
  }

  const nextTask =
    payload.tasks.find(
      (task) => task.status === "focus" || task.status === "in_progress"
    ) ??
    payload.tasks[0] ??
    null;
  const driftTask =
    payload.tasks.find((task) => task.status === "blocked") ??
    payload.tasks.find((task) => task.status === "backlog") ??
    null;
  const latestEvidence = payload.activity[0] ?? null;
  const notesSummaryByEntity =
    "notesSummaryByEntity" in payload
      ? payload.notesSummaryByEntity
      : shell.snapshot.dashboard.notesSummaryByEntity;
  const lifecyclePending =
    lifecycleMutation.isPending || deleteProjectMutation.isPending;
  const schedulingState = evaluateSchedulingRulesNow({
    rules: payload.project.schedulingRules,
    overview: calendarOverviewQuery.data?.calendar
  });

  const updateProjectStatus = async (status: Project["status"]) => {
    await lifecycleMutation.mutateAsync(status);
  };

  const handleDeleteProject = async () => {
    const confirmed = window.confirm(
      t("common.projectDetail.deleteProjectConfirm", {
        title: payload.project.title
      })
    );
    if (!confirmed) {
      return;
    }
    await deleteProjectMutation.mutateAsync();
  };

  return (
    <div className="grid min-w-0 gap-5">
      <PageHero
        entityKind="project"
        title={
          <EntityName
            kind="project"
            label={payload.project.title}
            variant="heading"
            size="lg"
          />
        }
        titleText={payload.project.title}
        description={
          payload.project.description ? (
            <NoteMarkdown
              markdown={payload.project.description}
              className="[&>p]:text-[13px] [&>p]:leading-6 [&>blockquote]:text-[13px] [&>ul]:text-[13px] [&>ol]:text-[13px]"
            />
          ) : (
            "No project description yet."
          )
        }
        badge={
          <EntityBadge
            kind="goal"
            label={payload.goal.title}
            compact
            gradient={false}
          />
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <PreferenceEntityHandoffButton
              userId={defaultUserId}
              domain="projects"
              entityType="project"
              entityId={payload.project.id}
              label={payload.project.title}
              description={payload.project.description}
            />
            <OpenInGraphButton entityType="project" entityId={payload.project.id} />
          </div>
        }
      />

      {payload.project.user ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-white/62">
          <span className="text-white/42">Owned by</span>
          <UserBadge user={payload.project.user} />
        </div>
      ) : null}

      {isLegacyProject ? (
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            {t("common.projectDetail.compatibility")}
          </div>
          <p className="mt-3 text-sm leading-7 text-white/60">
            {t("common.projectDetail.compatibilityDescription")}
          </p>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setTaskDialogOpen(true)}>
          {t("common.projectDetail.addTask")}
        </Button>
        {!isLegacyProject ? (
          <Button
            variant="secondary"
            onClick={() => setWorkAdjustmentOpen(true)}
          >
            Adjust work
          </Button>
        ) : null}
        {!isLegacyProject ? (
          <Button
            variant="secondary"
            onClick={() => setProjectDialogOpen(true)}
          >
            {t("common.projectDetail.editProject")}
          </Button>
        ) : null}
        {!isLegacyProject && payload.project.status === "active" ? (
          <Button
            variant="secondary"
            pending={
              lifecyclePending && lifecycleMutation.variables === "paused"
            }
            pendingLabel={t("common.projectDetail.suspending")}
            onClick={() => void updateProjectStatus("paused")}
          >
            {t("common.projectDetail.suspendProject")}
          </Button>
        ) : null}
        {!isLegacyProject && payload.project.status !== "completed" ? (
          <Button
            pending={
              lifecyclePending && lifecycleMutation.variables === "completed"
            }
            pendingLabel={t("common.projectDetail.finishing")}
            onClick={() => void updateProjectStatus("completed")}
          >
            {t("common.projectDetail.finishProject")}
          </Button>
        ) : null}
        {!isLegacyProject && payload.project.status !== "active" ? (
          <Button
            variant="secondary"
            pending={
              lifecyclePending && lifecycleMutation.variables === "active"
            }
            pendingLabel={t("common.projectDetail.restarting")}
            onClick={() => void updateProjectStatus("active")}
          >
            {t("common.projectDetail.restartProject")}
          </Button>
        ) : null}
        {!isLegacyProject ? (
          <Button
            variant="ghost"
            pending={deleteProjectMutation.isPending}
            pendingLabel={t("common.projectDetail.deleting")}
            onClick={() => void handleDeleteProject()}
          >
            {t("common.projectDetail.deleteProject")}
          </Button>
        ) : null}
        <Link to={`/goals/${payload.goal.id}`}>
          <Button variant="ghost">{t("common.projectDetail.openGoal")}</Button>
        </Link>
      </div>

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                {t("common.projectDetail.commandEyebrow")}
              </div>
              <h2 className="mt-2 font-display text-[clamp(1.35rem,2vw,1.9rem)] text-white">
                {t("common.projectDetail.commandTitle")}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
                {t("common.projectDetail.commandDescription")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <EntityBadge kind="project" compact gradient={false} />
              <EntityBadge
                kind="goal"
                label={payload.goal.title}
                compact
                gradient={false}
              />
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <Link
              to={
                nextTask
                  ? `/tasks/${nextTask.id}`
                  : `/projects/${payload.project.id}`
              }
              className="rounded-[20px] bg-white/[0.04] p-4 transition hover:bg-white/[0.08]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                  {t("common.projectDetail.signalNext")}
                </div>
                {nextTask ? (
                  <EntityBadge kind="task" compact gradient={false} />
                ) : null}
              </div>
              <div className="mt-2 font-medium text-white">
                {nextTask?.title ?? t("common.projectDetail.noNextTask")}
              </div>
              <div className="mt-2 text-sm leading-6 text-white/58">
                {nextTask?.description ||
                  t("common.projectDetail.noNextTaskDetail")}
              </div>
            </Link>
            <Link
              to={
                driftTask
                  ? `/tasks/${driftTask.id}`
                  : `/projects/${payload.project.id}`
              }
              className="rounded-[20px] bg-white/[0.04] p-4 transition hover:bg-white/[0.08]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                  {t("common.projectDetail.signalRisk")}
                </div>
                {driftTask ? (
                  <EntityBadge kind="task" compact gradient={false} />
                ) : null}
              </div>
              <div className="mt-2 font-medium text-white">
                {driftTask?.title ?? t("common.projectDetail.noRisk")}
              </div>
              <div className="mt-2 text-sm leading-6 text-white/58">
                {driftTask?.description ||
                  t("common.projectDetail.noRiskDetail")}
              </div>
            </Link>
          </div>
        </Card>

        <Card className="h-fit min-w-0">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            {t("common.projectDetail.sectionHealth")}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge className="bg-white/[0.08] text-white/72">
              {t(`common.enums.projectStatus.${payload.project.status}`)}
            </Badge>
            <Badge className="bg-white/[0.08] text-white/72">
              {payload.project.momentumLabel}
            </Badge>
            <Badge className="bg-white/[0.08] text-white/72">
              {Math.floor(payload.project.time.totalCreditedSeconds / 60)} min
              tracked
            </Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                {t("common.projectDetail.fieldProgress")}
              </div>
              <div className="mt-2 font-display text-xl text-white">
                {payload.project.progress}%
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                {t("common.projectDetail.fieldMomentum")}
              </div>
              <div className="mt-2 font-display text-xl text-white">
                {payload.project.momentumLabel}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                {t("common.projectDetail.fieldStatus")}
              </div>
              <div className="mt-2 font-display text-xl text-white">
                {t(`common.enums.projectStatus.${payload.project.status}`)}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                Live tasks
              </div>
              <div className="mt-2 font-display text-xl text-white">
                {
                  payload.tasks.filter(
                    (task) =>
                      task.status === "focus" || task.status === "in_progress"
                  ).length
                }
              </div>
            </div>
          </div>
        </Card>
      </section>

      {!isLegacyProject ? (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <SchedulingRulesEditor
            title="Project scheduling defaults"
            subtitle="Define the calendar contexts where work from this project is allowed or blocked. Tasks can inherit these defaults or override them."
            initialRules={payload.project.schedulingRules}
            saveLabel="Save project scheduling"
            onSave={async ({ schedulingRules }) => {
              await shell.patchProject(payload.project.id, { schedulingRules });
              await queryClient.invalidateQueries({
                queryKey: ["project-board", params.projectId]
              });
              await queryClient.invalidateQueries({
                queryKey: ["project-calendar-overview", params.projectId]
              });
            }}
          />

          <Card className="h-fit min-w-0">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Calendar status
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge
                className={
                  schedulingState.tone === "blocked"
                    ? "bg-rose-500/14 text-rose-100"
                    : schedulingState.tone === "waiting"
                      ? "bg-amber-500/14 text-amber-100"
                      : "bg-emerald-500/14 text-emerald-100"
                }
              >
                {schedulingState.label}
              </Badge>
              <Badge className="bg-white/[0.08] text-white/72">
                Project defaults
              </Badge>
            </div>
            <p className="mt-3 text-sm leading-6 text-white/58">
              These rules act as the default calendar gate for every task in the
              project unless a task sets its own override.
            </p>
            {schedulingState.context.length > 0 ? (
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                  Current context
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {schedulingState.context.map((entry) => (
                    <Badge
                      key={entry}
                      className="bg-white/[0.08] text-white/72"
                    >
                      {entry}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {schedulingState.conflicts.length > 0 ? (
              <div className="mt-4 grid gap-2">
                {schedulingState.conflicts.map((entry) => (
                  <div
                    key={entry}
                    className="rounded-[16px] bg-rose-500/10 px-3 py-2 text-sm text-rose-100"
                  >
                    {entry}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-4">
              <Link to="/calendar">
                <Button variant="secondary">Open calendar workspace</Button>
              </Link>
            </div>
          </Card>
        </section>
      ) : null}

      <ExecutionBoard
        tasks={payload.tasks}
        goals={shell.snapshot.goals}
        tags={shell.snapshot.tags}
        notesSummaryByEntity={notesSummaryByEntity}
        selectedTaskId={null}
        onMove={async (taskId, nextStatus) => {
          await shell.patchTaskStatus(taskId, nextStatus);
          await queryClient.invalidateQueries({
            queryKey: ["project-board", params.projectId]
          });
        }}
        onSelectTask={(taskId) => navigate(`/tasks/${taskId}`)}
        onQuickReopenTask={async (taskId) => {
          await reopenMutation.mutateAsync(taskId);
        }}
        onDeleteTask={async (taskId) => {
          await deleteTaskMutation.mutateAsync(taskId);
        }}
      />

      {!isLegacyProject ? (
        <EntityNotesSurface
          entityType="project"
          entityId={payload.project.id}
          title="Project notes"
          description="Keep rollout notes, checkpoints, and cross-task context attached to the project itself."
          invalidateQueryKeys={[["project-board", params.projectId]]}
        />
      ) : null}

      <Card className="min-w-0">
        <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
          {t("common.projectDetail.sectionEvidence")}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {payload.activity.slice(0, 6).map((event) => (
            <Link
              key={event.id}
              to={
                getActivityEventHref(event) ?? `/activity?eventId=${event.id}`
              }
              className="rounded-[18px] bg-white/[0.04] p-4 transition hover:bg-white/[0.08]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-white">
                  {getReadableActivityTitle(event)}
                </div>
                <Badge>{event.source}</Badge>
              </div>
              <div className="mt-2 text-sm text-white/58">
                {getReadableActivityDescription(event)}
              </div>
            </Link>
          ))}
        </div>
      </Card>

      <ProjectDialog
        open={projectDialogOpen}
        goals={shell.snapshot.goals}
        users={shell.snapshot.users}
        editingProject={editingProject}
        defaultUserId={editingProject?.userId ?? defaultUserId}
        onOpenChange={setProjectDialogOpen}
        onSubmit={async (input, projectId) => {
          if (projectId) {
            await shell.patchProject(projectId, input);
            await queryClient.invalidateQueries({
              queryKey: ["project-board", params.projectId]
            });
          }
        }}
      />

      <TaskDialog
        open={taskDialogOpen}
        goals={shell.snapshot.goals}
        projects={shell.snapshot.dashboard.projects}
        tags={shell.snapshot.tags}
        users={shell.snapshot.users}
        editingTask={null}
        initialProjectId={isLegacyProject ? null : payload.project.id}
        defaultUserId={payload.project.userId ?? defaultUserId}
        onOpenChange={setTaskDialogOpen}
        onSubmit={async (input, taskId) => {
          if (taskId) {
            await patchTask(taskId, input);
          } else {
            await shell.createTask(input);
          }
          await queryClient.invalidateQueries({
            queryKey: ["project-board", params.projectId]
          });
        }}
      />

      {!isLegacyProject ? (
        <WorkAdjustmentDialog
          open={workAdjustmentOpen}
          onOpenChange={setWorkAdjustmentOpen}
          entityType="project"
          entityId={payload.project.id}
          targetLabel={payload.project.title}
          currentCreditedSeconds={payload.project.time.totalCreditedSeconds}
          pending={workAdjustmentMutation.isPending}
          onSubmit={async (input) => {
            await workAdjustmentMutation.mutateAsync(input);
          }}
        />
      ) : null}
    </div>
  );
}
