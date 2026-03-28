import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { ProjectDialog } from "@/components/project-dialog";
import { TaskDialog } from "@/components/task-dialog";
import { ExecutionBoard } from "@/components/execution-board";
import { EntityNotesSurface } from "@/components/notes/entity-notes-surface";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { ErrorState } from "@/components/ui/page-state";
import { getProjectBoard, patchTask, uncompleteTask } from "@/lib/api";
import { getReadableActivityDescription, getReadableActivityTitle } from "@/lib/activity-copy";
import { getActivityEventHref } from "@/lib/entity-links";
import { useI18n } from "@/lib/i18n";
import { useForgeShell } from "@/components/shell/app-shell";

function isLegacyProjectId(projectId: string | undefined): boolean {
  return Boolean(projectId && projectId.startsWith("campaign:"));
}

export function ProjectDetailPage() {
  const { t } = useI18n();
  const shell = useForgeShell();
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const legacyProject = shell.snapshot.dashboard.projects.find((project) => project.id === params.projectId) ?? null;
  const goal = legacyProject ? shell.snapshot.goals.find((entry) => entry.id === legacyProject.goalId) ?? null : null;
  const fallbackTasks = legacyProject
    ? shell.snapshot.tasks.filter((task) => task.projectId === legacyProject.id || (!task.projectId && task.goalId === legacyProject.goalId))
    : [];
  const fallbackTaskIds = new Set(fallbackTasks.map((task) => task.id));
  const fallbackActivity = legacyProject
    ? shell.snapshot.activity.filter(
        (event) =>
          event.entityId === legacyProject.goalId ||
          event.entityId === legacyProject.id ||
          fallbackTaskIds.has(event.entityId) ||
          (event.entityType === "task_run" && typeof event.metadata.taskId === "string" && fallbackTaskIds.has(event.metadata.taskId))
      )
    : [];
  const isLegacyProject = isLegacyProjectId(params.projectId);

  const projectBoardQuery = useQuery({
    queryKey: ["project-board", params.projectId],
    queryFn: () => getProjectBoard(params.projectId!),
    enabled: Boolean(params.projectId) && !isLegacyProject
  });

  const reopenMutation = useMutation({
    mutationFn: (taskId: string) => uncompleteTask(taskId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
        queryClient.invalidateQueries({ queryKey: ["project-board", params.projectId] })
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
  const editingProject = shell.snapshot.dashboard.projects.find((project) => project.id === params.projectId) ?? null;

  if (projectBoardQuery.isError && !isLegacyProject) {
    return <ErrorState eyebrow={t("common.projectDetail.errorEyebrow")} error={projectBoardQuery.error} onRetry={() => void projectBoardQuery.refetch()} />;
  }

  if (!payload) {
    return <SurfaceSkeleton />;
  }

  const nextTask = payload.tasks.find((task) => task.status === "focus" || task.status === "in_progress") ?? payload.tasks[0] ?? null;
  const driftTask = payload.tasks.find((task) => task.status === "blocked") ?? payload.tasks.find((task) => task.status === "backlog") ?? null;
  const latestEvidence = payload.activity[0] ?? null;
  const notesSummaryByEntity = "notesSummaryByEntity" in payload ? payload.notesSummaryByEntity : shell.snapshot.dashboard.notesSummaryByEntity;

  return (
    <div className="grid min-w-0 gap-5">
      <PageHero
        entityKind="project"
        title={<EntityName kind="project" label={payload.project.title} variant="heading" size="lg" />}
        titleText={payload.project.title}
        description={payload.project.description}
        badge={<EntityBadge kind="goal" label={payload.goal.title} compact gradient={false} />}
      />

      {isLegacyProject ? (
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">{t("common.projectDetail.compatibility")}</div>
          <p className="mt-3 text-sm leading-7 text-white/60">
            {t("common.projectDetail.compatibilityDescription")}
          </p>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setTaskDialogOpen(true)}>{t("common.projectDetail.addTask")}</Button>
        {!isLegacyProject ? (
          <Button variant="secondary" onClick={() => setProjectDialogOpen(true)}>
            {t("common.projectDetail.editProject")}
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
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">{t("common.projectDetail.commandEyebrow")}</div>
                <h2 className="mt-2 font-display text-[clamp(1.35rem,2vw,1.9rem)] text-white">{t("common.projectDetail.commandTitle")}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">{t("common.projectDetail.commandDescription")}</p>
              </div>
            <div className="flex flex-wrap gap-2">
              <EntityBadge kind="project" compact gradient={false} />
              <EntityBadge kind="goal" label={payload.goal.title} compact gradient={false} />
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <Link to={nextTask ? `/tasks/${nextTask.id}` : `/projects/${payload.project.id}`} className="rounded-[20px] bg-white/[0.04] p-4 transition hover:bg-white/[0.08]">
              <div className="flex items-center justify-between gap-3">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">{t("common.projectDetail.signalNext")}</div>
                {nextTask ? <EntityBadge kind="task" compact gradient={false} /> : null}
              </div>
              <div className="mt-2 font-medium text-white">{nextTask?.title ?? t("common.projectDetail.noNextTask")}</div>
              <div className="mt-2 text-sm leading-6 text-white/58">{nextTask?.description || t("common.projectDetail.noNextTaskDetail")}</div>
            </Link>
            <Link to={driftTask ? `/tasks/${driftTask.id}` : `/projects/${payload.project.id}`} className="rounded-[20px] bg-white/[0.04] p-4 transition hover:bg-white/[0.08]">
              <div className="flex items-center justify-between gap-3">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">{t("common.projectDetail.signalRisk")}</div>
                {driftTask ? <EntityBadge kind="task" compact gradient={false} /> : null}
              </div>
              <div className="mt-2 font-medium text-white">{driftTask?.title ?? t("common.projectDetail.noRisk")}</div>
              <div className="mt-2 text-sm leading-6 text-white/58">{driftTask?.description || t("common.projectDetail.noRiskDetail")}</div>
            </Link>
          </div>
        </Card>

        <Card className="h-fit min-w-0">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">{t("common.projectDetail.sectionHealth")}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge className="bg-white/[0.08] text-white/72">{t(`common.enums.projectStatus.${payload.project.status}`)}</Badge>
            <Badge className="bg-white/[0.08] text-white/72">{payload.project.momentumLabel}</Badge>
            <Badge className="bg-white/[0.08] text-white/72">{Math.floor(payload.project.time.totalCreditedSeconds / 60)} min tracked</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">{t("common.projectDetail.fieldProgress")}</div>
              <div className="mt-2 font-display text-xl text-white">{payload.project.progress}%</div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">{t("common.projectDetail.fieldMomentum")}</div>
              <div className="mt-2 font-display text-xl text-white">{payload.project.momentumLabel}</div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">{t("common.projectDetail.fieldStatus")}</div>
              <div className="mt-2 font-display text-xl text-white">{t(`common.enums.projectStatus.${payload.project.status}`)}</div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">Live tasks</div>
              <div className="mt-2 font-display text-xl text-white">{payload.tasks.filter((task) => task.status === "focus" || task.status === "in_progress").length}</div>
            </div>
          </div>
        </Card>
      </section>

      <ExecutionBoard
        tasks={payload.tasks}
        goals={shell.snapshot.goals}
        tags={shell.snapshot.tags}
        notesSummaryByEntity={notesSummaryByEntity}
        selectedTaskId={null}
        onMove={async (taskId, nextStatus) => {
          await shell.patchTaskStatus(taskId, nextStatus);
          await queryClient.invalidateQueries({ queryKey: ["project-board", params.projectId] });
        }}
        onSelectTask={(taskId) => navigate(`/tasks/${taskId}`)}
        onQuickReopenTask={async (taskId) => {
          await reopenMutation.mutateAsync(taskId);
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
        <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">{t("common.projectDetail.sectionEvidence")}</div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {payload.activity.slice(0, 6).map((event) => (
            <Link
              key={event.id}
              to={getActivityEventHref(event) ?? `/activity?eventId=${event.id}`}
              className="rounded-[18px] bg-white/[0.04] p-4 transition hover:bg-white/[0.08]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-white">{getReadableActivityTitle(event)}</div>
                <Badge>{event.source}</Badge>
              </div>
              <div className="mt-2 text-sm text-white/58">{getReadableActivityDescription(event)}</div>
            </Link>
          ))}
        </div>
      </Card>

      <ProjectDialog
        open={projectDialogOpen}
        goals={shell.snapshot.goals}
        editingProject={editingProject}
        onOpenChange={setProjectDialogOpen}
        onSubmit={async (input, projectId) => {
          if (projectId) {
            await shell.patchProject(projectId, input);
            await queryClient.invalidateQueries({ queryKey: ["project-board", params.projectId] });
          }
        }}
      />

      <TaskDialog
        open={taskDialogOpen}
        goals={shell.snapshot.goals}
        projects={shell.snapshot.dashboard.projects}
        tags={shell.snapshot.tags}
        editingTask={null}
        initialProjectId={isLegacyProject ? null : payload.project.id}
        onOpenChange={setTaskDialogOpen}
        onSubmit={async (input, taskId) => {
          if (taskId) {
            await patchTask(taskId, input);
          } else {
            await shell.createTask(input);
          }
          await queryClient.invalidateQueries({ queryKey: ["project-board", params.projectId] });
        }}
      />
    </div>
  );
}
