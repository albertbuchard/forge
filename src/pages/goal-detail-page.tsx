import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { GoalDialog } from "@/components/goal-dialog";
import { OpenInGraphButton } from "@/components/knowledge-graph/open-in-graph-button";
import { NoteMarkdown } from "@/components/notes/note-markdown";
import { ProjectDialog } from "@/components/project-dialog";
import { EntityNotesSurface } from "@/components/notes/entity-notes-surface";
import { PreferenceEntityHandoffButton } from "@/components/preferences/preference-entity-handoff-button";
import { ProjectCollectionFilters } from "@/components/projects/project-collection-filters";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { EmptyState } from "@/components/ui/page-state";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { UserBadge } from "@/components/ui/user-badge";
import { deleteGoal } from "@/lib/api";
import {
  getReadableActivityDescription,
  getReadableActivityTitle
} from "@/lib/activity-copy";
import { getActivityEventHref } from "@/lib/entity-links";
import { useI18n } from "@/lib/i18n";
import {
  buildProjectCollectionCounts,
  filterProjectsByCollectionStatus,
  type ProjectCollectionStatusFilter
} from "@/lib/project-collections";
import { useForgeShell } from "@/components/shell/app-shell";
import { getSingleSelectedUserId } from "@/lib/user-ownership";
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";

export function GoalDetailPage() {
  const { t } = useI18n();
  const shell = useForgeShell();
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectFilter, setProjectFilter] =
    useState<ProjectCollectionStatusFilter>("active");
  const defaultUserId = getSingleSelectedUserId(shell.selectedUserIds);
  const [pendingRestartProjectId, setPendingRestartProjectId] = useState<
    string | null
  >(null);
  const deleteGoalMutation = useMutation({
    mutationFn: () => deleteGoal(params.goalId!),
    onSuccess: async () => {
      await Promise.all([
        invalidateForgeSnapshot(queryClient),
        queryClient.invalidateQueries({ queryKey: ["project-board"] }),
        queryClient.invalidateQueries({ queryKey: ["task-context"] })
      ]);
      navigate("/goals");
    }
  });

  const goal =
    shell.snapshot.dashboard.goals.find(
      (entry) => entry.id === params.goalId
    ) ?? null;

  const allProjects = useMemo(
    () =>
      shell.snapshot.dashboard.projects.filter(
        (project) => project.goalId === params.goalId
      ),
    [params.goalId, shell.snapshot.dashboard.projects]
  );
  const projectCounts = useMemo(
    () => buildProjectCollectionCounts(allProjects),
    [allProjects]
  );
  const projects = useMemo(
    () => filterProjectsByCollectionStatus(allProjects, projectFilter),
    [allProjects, projectFilter]
  );

  const projectIds = new Set(allProjects.map((project) => project.id));
  const taskIds = new Set(
    shell.snapshot.tasks
      .filter((task) => projectIds.has(task.projectId ?? ""))
      .map((task) => task.id)
  );
  const evidence = shell.snapshot.activity.filter(
    (event) =>
      event.entityId === params.goalId ||
      projectIds.has(event.entityId) ||
      taskIds.has(event.entityId) ||
      (event.entityType === "task_run" &&
        typeof event.metadata.taskId === "string" &&
        taskIds.has(event.metadata.taskId))
  );

  if (!goal) {
    return (
      <EmptyState
        eyebrow={t("common.goalDetail.eyebrow")}
        title={t("common.goalDetail.missingTitle")}
        description={t("common.goalDetail.missingDescription")}
        action={
          <Link
            to="/goals"
            className="inline-flex min-h-10 min-w-0 max-w-full items-center justify-center whitespace-nowrap rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium text-slate-950 transition hover:opacity-90"
          >
            {t("common.goalDetail.backToGoals")}
          </Link>
        }
      />
    );
  }

  const nextProject =
    projects.find((project) => project.nextTaskTitle) ?? projects[0] ?? null;
  const weakSpot =
    shell.snapshot.overview.neglectedGoals.find(
      (entry) => entry.goalId === goal.id
    ) ?? null;
  const latestEvidence = evidence[0] ?? null;

  const restartProject = async (projectId: string) => {
    setPendingRestartProjectId(projectId);
    try {
      await shell.patchProject(projectId, { status: "active" });
    } finally {
      setPendingRestartProjectId(null);
    }
  };

  const handleDeleteGoal = async () => {
    const confirmed = window.confirm(
      t("common.goalDetail.deleteGoalConfirm", {
        title: goal.title
      })
    );
    if (!confirmed) {
      return;
    }
    await deleteGoalMutation.mutateAsync();
  };

  return (
    <div className="grid min-w-0 gap-5">
      <PageHero
        entityKind="goal"
        title={
          <EntityName
            kind="goal"
            label={goal.title}
            variant="heading"
            size="lg"
          />
        }
        titleText={goal.title}
        description={
          goal.description ? (
            <NoteMarkdown
              markdown={goal.description}
              className="[&>p]:text-[13px] [&>p]:leading-6 [&>blockquote]:text-[13px] [&>ul]:text-[13px] [&>ol]:text-[13px]"
            />
          ) : (
            "No strategic description yet."
          )
        }
        badge={t(
          projects.length === 1
            ? "common.goalDetail.heroBadgeOne"
            : "common.goalDetail.heroBadgeOther",
          { count: projects.length }
        )}
        actions={
          <div className="flex flex-wrap gap-2">
            <PreferenceEntityHandoffButton
              userId={defaultUserId}
              domain="projects"
              entityType="goal"
              entityId={goal.id}
              label={goal.title}
              description={goal.description}
            />
            <OpenInGraphButton entityType="goal" entityId={goal.id} />
          </div>
        }
      />

      {goal.user ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-white/62">
          <span className="text-white/42">Owned by</span>
          <UserBadge user={goal.user} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setGoalDialogOpen(true)}>
          {t("common.goalDetail.edit")}
        </Button>
        <Button variant="secondary" onClick={() => setProjectDialogOpen(true)}>
          {t("common.goalDetail.addProject")}
        </Button>
        <Button
          variant="ghost"
          className="text-rose-200 hover:bg-rose-500/10"
          pending={deleteGoalMutation.isPending}
          pendingLabel={t("common.goalDetail.deleting")}
          onClick={() => void handleDeleteGoal()}
        >
          {t("common.goalDetail.deleteGoal")}
        </Button>
      </div>

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              {t("common.goalDetail.sectionProjects")}
            </div>
            <ProjectCollectionFilters
              value={projectFilter}
              counts={projectCounts}
              onChange={setProjectFilter}
              className="justify-end"
            />
          </div>
          {projects.length === 0 ? (
            <div className="mt-4 rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/58">
              {projectFilter === "active"
                ? t("common.goalDetail.noProjects")
                : "No projects match this lifecycle filter yet. Switch filters or restart one to make it active again."}
            </div>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="rounded-[22px] bg-white/[0.04] p-5 transition hover:bg-white/[0.08]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <EntityBadge kind="project" compact gradient={false} />
                      {project.user ? <UserBadge user={project.user} compact /> : null}
                    </div>
                    <Badge>{project.status}</Badge>
                  </div>
                  <div className="mt-4">
                    <Link
                      to={`/projects/${project.id}`}
                      className="transition hover:opacity-90"
                    >
                      <EntityName
                        kind="project"
                        label={project.title}
                        variant="heading"
                        size="lg"
                      />
                    </Link>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/58">
                    {project.description}
                  </p>
                  <div className="mt-4">
                    <ProgressMeter value={project.progress} />
                  </div>
                  <div className="mt-4 text-[11px] uppercase tracking-[0.16em] text-white/40">
                    {project.nextTaskTitle
                      ? t("common.goalDetail.nextMove", {
                          value: project.nextTaskTitle
                        })
                      : t("common.goalDetail.addNextTask")}
                  </div>
                  <div className="mt-4 flex flex-wrap justify-between gap-3">
                    <Link to={`/projects/${project.id}`}>
                      <Button variant="ghost">Open project</Button>
                    </Link>
                    {projectFilter !== "active" &&
                    project.status !== "active" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        pending={pendingRestartProjectId === project.id}
                        pendingLabel="Restarting…"
                        onClick={() => void restartProject(project.id)}
                      >
                        Restart
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="grid min-w-0 gap-5">
          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              {t("common.goalDetail.sectionHealth")}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <EntityBadge kind="goal" compact gradient={false} />
              <Badge className="bg-white/[0.08] text-white/72">
                {t("common.goalDetail.progressTitle", {
                  progress: goal.progress,
                  count: goal.completedTasks
                })}
              </Badge>
              <Badge className="bg-white/[0.08] text-white/72">
                {t("common.goalDetail.progressDetail", {
                  xp: goal.earnedPoints
                })}
              </Badge>
              <Badge className="bg-white/[0.08] text-white/72">
                {t(
                  projects.length === 1
                    ? "common.goalDetail.heroBadgeOne"
                    : "common.goalDetail.heroBadgeOther",
                  { count: projects.length }
                )}
              </Badge>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  {t("common.goalDetail.fieldProgress")}
                </div>
                <div className="mt-2 font-display text-xl text-white">
                  {goal.progress}%
                </div>
              </div>
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  {t("common.goalDetail.fieldCompletedTasks")}
                </div>
                <div className="mt-2 font-display text-xl text-white">
                  {goal.completedTasks}
                </div>
              </div>
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  {t("common.goalDetail.fieldXpBanked")}
                </div>
                <div className="mt-2 font-display text-xl text-white">
                  {goal.earnedPoints}
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              <div className="rounded-[18px] bg-white/[0.04] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                    {t("common.goalDetail.signalNext")}
                  </div>
                  {nextProject ? (
                    <EntityBadge kind="project" compact gradient={false} />
                  ) : null}
                </div>
                <div className="mt-2 font-medium text-white">
                  {nextProject?.title ?? t("common.goalDetail.noProject")}
                </div>
                <div className="mt-2 text-sm leading-6 text-white/58">
                  {nextProject?.nextTaskTitle
                    ? t("common.goalDetail.nextMove", {
                        value: nextProject.nextTaskTitle
                      })
                    : nextProject?.description ||
                      t("common.goalDetail.noProjectDetail")}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[18px] bg-white/[0.04] p-4">
                  <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                    {t("common.goalDetail.signalRisk")}
                  </div>
                  <div className="mt-2 font-medium text-white">
                    {weakSpot?.title ?? t("common.goalDetail.noRisk")}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-white/58">
                    {weakSpot?.summary || t("common.goalDetail.noRiskDetail")}
                  </div>
                </div>
                <div className="rounded-[18px] bg-white/[0.04] p-4">
                  <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                    {t("common.goalDetail.signalEvidence")}
                  </div>
                  <div className="mt-2 font-medium text-white">
                    {latestEvidence?.title ?? t("common.goalDetail.noEvidence")}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-white/58">
                    {latestEvidence?.description ||
                      t("common.goalDetail.noEvidenceDetail")}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <EntityNotesSurface
        entityType="goal"
        entityId={goal.id}
        title="Goal notes"
        description="Use notes to capture strategy changes, meaning shifts, and progress context that belongs at the goal level."
      />

      <Card>
        <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
          {t("common.goalDetail.sectionEvidence")}
        </div>
        {evidence.length === 0 ? (
          <div className="mt-4 rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/58">
            {t("common.goalDetail.noEvidenceLogged")}
          </div>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {evidence.slice(0, 6).map((event) => (
              <Link
                key={event.id}
                to={
                  getActivityEventHref(event) ?? `/activity?eventId=${event.id}`
                }
                className="rounded-[18px] bg-white/[0.04] p-4 transition hover:bg-white/[0.08]"
              >
                <div className="font-medium text-white">
                  {getReadableActivityTitle(event)}
                </div>
                <div className="mt-2 text-sm leading-6 text-white/58">
                  {getReadableActivityDescription(event)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <GoalDialog
        open={goalDialogOpen}
        editingGoal={goal}
        tags={shell.snapshot.tags}
        users={shell.snapshot.users}
        defaultUserId={goal.userId ?? defaultUserId}
        onOpenChange={setGoalDialogOpen}
        onSubmit={async (input, goalId) => {
          if (goalId) {
            await shell.patchGoal(goalId, input);
          }
        }}
      />

      <ProjectDialog
        open={projectDialogOpen}
        goals={shell.snapshot.goals}
        users={shell.snapshot.users}
        editingProject={null}
        initialGoalId={goal.id}
        defaultUserId={goal.userId ?? defaultUserId}
        onOpenChange={setProjectDialogOpen}
        onSubmit={async (input) => {
          await shell.createProject(input);
        }}
      />
    </div>
  );
}
