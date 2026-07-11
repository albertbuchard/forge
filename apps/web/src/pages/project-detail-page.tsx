import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SchedulingRulesEditor } from "@/components/calendar/scheduling-rules-editor";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { OpenInGraphButton } from "@/components/knowledge-graph/open-in-graph-button";
import { ProjectDialog } from "@/components/project-dialog";
import {
  PlanningRecordDeleteDialog,
  PlanningRecordDeletedState
} from "@/components/planning/planning-record-delete-dialog";
import { ProjectManagementSectionNav } from "@/components/projects/project-management-section-nav";
import { TaskDialog } from "@/components/task-dialog";
import { WorkAdjustmentDialog } from "@/components/work-adjustment-dialog";
import { ExecutionBoard } from "@/components/execution-board";
import { NoteMarkdown } from "@/components/notes/note-markdown";
import { EntityNotesSurface } from "@/components/notes/entity-notes-surface";
import { PreferenceEntityHandoffButton } from "@/components/preferences/preference-entity-handoff-button";
import { GamificationMiniHud } from "@/components/gamification/gamification-widgets";
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
  getDeletedPlanningRecord,
  getProjectBoard,
  patchProject,
  restoreEntities,
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
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";

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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletedProjectOverride, setDeletedProjectOverride] = useState<{
    id: string;
    title: string;
  } | null>(null);
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
  const deletedProjectQuery = useQuery({
    queryKey: ["deleted-planning-record", "project", params.projectId],
    queryFn: () => getDeletedPlanningRecord("project", params.projectId!),
    enabled: Boolean(params.projectId) && !isLegacyProject
  });
  const deletedProject =
    deletedProjectOverride ??
    (deletedProjectQuery.data
      ? {
          id: deletedProjectQuery.data.entityId,
          title: deletedProjectQuery.data.title
        }
      : null);

  const projectBoardQuery = useQuery({
    queryKey: ["project-board", params.projectId],
    queryFn: () => getProjectBoard(params.projectId!),
    enabled: Boolean(params.projectId) && !isLegacyProject && !deletedProject
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
    enabled: Boolean(params.projectId) && !isLegacyProject && !deletedProject
  });

  const reopenMutation = useMutation({
    mutationFn: (taskId: string) => uncompleteTask(taskId),
    onSuccess: async () => {
      await Promise.all([
        invalidateForgeSnapshot(queryClient),
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
        invalidateForgeSnapshot(queryClient),
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
        invalidateForgeSnapshot(queryClient),
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
      if (payload) {
        setDeletedProjectOverride({
          id: payload.project.id,
          title: payload.project.title
        });
      }
      await Promise.all([
        invalidateForgeSnapshot(queryClient),
        queryClient.invalidateQueries({
          queryKey: ["project-board", params.projectId]
        })
      ]);
    }
  });
  const restoreProjectMutation = useMutation({
    mutationFn: (projectId: string) =>
      restoreEntities({
        operations: [{ entityType: "project", id: projectId }]
      })
  });
  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onSuccess: async () => {
      await Promise.all([
        invalidateForgeSnapshot(queryClient),
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

  if (deletedProject) {
    return (
      <PlanningRecordDeletedState
        recordKind="project"
        recordTitle={deletedProject.title}
        backHref="/projects"
        backLabel="Back to projects"
        restoring={restoreProjectMutation.isPending}
        restoreError={restoreProjectMutation.error}
        onRestore={async () => {
          await restoreProjectMutation.mutateAsync(deletedProject.id);
          setDeletedProjectOverride(null);
          queryClient.setQueryData(
            ["deleted-planning-record", "project", deletedProject.id],
            null
          );
          await Promise.all([
            invalidateForgeSnapshot(queryClient),
            queryClient.invalidateQueries({
              queryKey: ["project-board", params.projectId]
            }),
            queryClient.invalidateQueries({
              queryKey: [
                "deleted-planning-record",
                "project",
                deletedProject.id
              ]
            })
          ]);
        }}
      />
    );
  }

  if (projectBoardQuery.isError && deletedProjectQuery.isLoading) {
    return <SurfaceSkeleton />;
  }

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
  const goalStrategies = shell.snapshot.strategies.filter((strategy) =>
    strategy.targetGoalIds.includes(payload.goal.id)
  );
  const projectStrategies = shell.snapshot.strategies.filter((strategy) =>
    strategy.targetProjectIds.includes(payload.project.id)
  );

  const updateProjectStatus = async (status: Project["status"]) => {
    await lifecycleMutation.mutateAsync(status);
  };

  return (
    <div className="grid min-w-0 gap-5">
      <ProjectManagementSectionNav />
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
            <GamificationMiniHud metrics={shell.snapshot.metrics} />
            <PreferenceEntityHandoffButton
              userId={defaultUserId}
              domain="projects"
              entityType="project"
              entityId={payload.project.id}
              label={payload.project.title}
              description={payload.project.description}
            />
            <OpenInGraphButton
              entityType="project"
              entityId={payload.project.id}
            />
          </div>
        }
      />

      {payload.project.user ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--ui-ink-medium)]">
          <span className="text-[var(--ui-ink-faint)]">Owned by</span>
          <UserBadge user={payload.project.user} />
          {payload.project.assignees && payload.project.assignees.length > 0 ? (
            <>
              <span className="text-[var(--ui-ink-faint)]">Assigned with</span>
              <div className="flex flex-wrap items-center gap-2">
                {payload.project.assignees.map((user) => (
                  <UserBadge key={user.id} user={user} compact />
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {payload.project.productRequirementsDocument ? (
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Product requirements document
          </div>
          <div className="mt-3">
            <NoteMarkdown
              markdown={payload.project.productRequirementsDocument}
              className="[&>p]:text-[13px] [&>p]:leading-6 [&>blockquote]:text-[13px] [&>ul]:text-[13px] [&>ol]:text-[13px]"
            />
          </div>
        </Card>
      ) : null}

      {goalStrategies.length > 0 || projectStrategies.length > 0 ? (
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Strategy stack
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-xs uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Goal-level strategies
              </div>
              {goalStrategies.length === 0 ? (
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  No goal-level strategies linked yet.
                </div>
              ) : (
                goalStrategies.map((strategy) => (
                  <Link
                    key={strategy.id}
                    to={`/strategies/${strategy.id}`}
                    className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 transition hover:bg-[var(--ui-surface-hover)]"
                  >
                    <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                      {strategy.title}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                      {strategy.overview || strategy.endStateDescription}
                    </div>
                  </Link>
                ))
              )}
            </div>
            <div className="grid gap-2">
              <div className="text-xs uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Project-level strategies
              </div>
              {projectStrategies.length === 0 ? (
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  No lower-level strategies linked yet.
                </div>
              ) : (
                projectStrategies.map((strategy) => (
                  <Link
                    key={strategy.id}
                    to={`/strategies/${strategy.id}`}
                    className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 transition hover:bg-[var(--ui-surface-hover)]"
                  >
                    <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                      {strategy.title}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                      {strategy.overview || strategy.endStateDescription}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </Card>
      ) : null}

      {isLegacyProject ? (
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            {t("common.projectDetail.compatibility")}
          </div>
          <p className="mt-3 text-sm leading-7 text-[var(--ui-ink-soft)]">
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
            onClick={() => setDeleteDialogOpen(true)}
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
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                {t("common.projectDetail.commandEyebrow")}
              </div>
              <h2 className="mt-2 font-display text-[clamp(1.35rem,2vw,1.9rem)] text-[var(--ui-ink-strong)]">
                {t("common.projectDetail.commandTitle")}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ui-ink-soft)]">
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
              className="rounded-[20px] bg-[var(--ui-surface-1)] p-4 transition hover:bg-[var(--ui-surface-hover)]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  {t("common.projectDetail.signalNext")}
                </div>
                {nextTask ? (
                  <EntityBadge kind="task" compact gradient={false} />
                ) : null}
              </div>
              <div className="mt-2 font-medium text-[var(--ui-ink-strong)]">
                {nextTask?.title ?? t("common.projectDetail.noNextTask")}
              </div>
              <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
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
              className="rounded-[20px] bg-[var(--ui-surface-1)] p-4 transition hover:bg-[var(--ui-surface-hover)]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  {t("common.projectDetail.signalRisk")}
                </div>
                {driftTask ? (
                  <EntityBadge kind="task" compact gradient={false} />
                ) : null}
              </div>
              <div className="mt-2 font-medium text-[var(--ui-ink-strong)]">
                {driftTask?.title ?? t("common.projectDetail.noRisk")}
              </div>
              <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                {driftTask?.description ||
                  t("common.projectDetail.noRiskDetail")}
              </div>
            </Link>
          </div>
        </Card>

        <Card className="h-fit min-w-0">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            {t("common.projectDetail.sectionHealth")}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {t(`common.enums.projectStatus.${payload.project.status}`)}
            </Badge>
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {payload.project.momentumLabel}
            </Badge>
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {Math.floor(payload.project.time.totalCreditedSeconds / 60)} min
              tracked
            </Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                {t("common.projectDetail.fieldProgress")}
              </div>
              <div className="mt-2 font-display text-xl text-[var(--ui-ink-strong)]">
                {payload.project.progress}%
              </div>
            </div>
            <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                {t("common.projectDetail.fieldMomentum")}
              </div>
              <div className="mt-2 font-display text-xl text-[var(--ui-ink-strong)]">
                {payload.project.momentumLabel}
              </div>
            </div>
            <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                {t("common.projectDetail.fieldStatus")}
              </div>
              <div className="mt-2 font-display text-xl text-[var(--ui-ink-strong)]">
                {t(`common.enums.projectStatus.${payload.project.status}`)}
              </div>
            </div>
            <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Live tasks
              </div>
              <div className="mt-2 font-display text-xl text-[var(--ui-ink-strong)]">
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
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Calendar status
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge
                className={
                  schedulingState.tone === "blocked"
                    ? "bg-[var(--ui-danger-soft)] text-[var(--danger)]"
                    : schedulingState.tone === "waiting"
                      ? "bg-[var(--ui-warning-soft)] text-[var(--warning)]"
                      : "bg-[var(--ui-success-soft)] text-[var(--success)]"
                }
              >
                {schedulingState.label}
              </Badge>
              <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                Project defaults
              </Badge>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
              These rules act as the default calendar gate for every task in the
              project unless a task sets its own override.
            </p>
            {schedulingState.context.length > 0 ? (
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Current context
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {schedulingState.context.map((entry) => (
                    <Badge
                      key={entry}
                      className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
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
                    className="rounded-[16px] bg-[var(--ui-danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
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
        activeRuns={shell.snapshot.activeTaskRuns}
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
        onStopTask={async (run) => {
          await shell.stopTaskRun(run);
          await queryClient.invalidateQueries({
            queryKey: ["project-board", params.projectId]
          });
          await queryClient.invalidateQueries({
            queryKey: ["task-context", run.taskId]
          });
        }}
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
        <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
          {t("common.projectDetail.sectionEvidence")}
        </div>
        <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2">
          {payload.activity.slice(0, 6).map((event) => (
            <Link
              key={event.id}
              to={
                getActivityEventHref(event) ?? `/activity?eventId=${event.id}`
              }
              className="min-w-0 max-w-full rounded-[18px] bg-[var(--ui-surface-1)] p-4 transition hover:bg-[var(--ui-surface-hover)]"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 break-words font-medium text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
                  {getReadableActivityTitle(event)}
                </div>
                <Badge>{event.source}</Badge>
              </div>
              <div className="mt-2 min-w-0 break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
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
        workItems={shell.snapshot.workItems}
        tags={shell.snapshot.tags}
        users={shell.snapshot.users}
        editingTask={null}
        initialProjectId={isLegacyProject ? null : payload.project.id}
        defaultUserId={payload.project.userId ?? defaultUserId}
        onRefreshEntities={shell.refresh}
        onOpenChange={setTaskDialogOpen}
        onSubmit={async (input, taskId) => {
          if (taskId) {
            await shell.patchTask(taskId, input);
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

      {!isLegacyProject ? (
        <PlanningRecordDeleteDialog
          open={deleteDialogOpen}
          recordKind="project"
          recordTitle={payload.project.title}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open);
            if (!open) {
              deleteProjectMutation.reset();
            }
          }}
          onConfirm={async () => {
            await deleteProjectMutation.mutateAsync();
          }}
        />
      ) : null}
    </div>
  );
}
