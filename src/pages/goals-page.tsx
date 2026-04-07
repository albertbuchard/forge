import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHero } from "@/components/shell/page-hero";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { GoalStudio } from "@/components/goal-studio";
import { ProjectCollectionFilters } from "@/components/projects/project-collection-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { EmptyState } from "@/components/ui/page-state";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { UserBadge } from "@/components/ui/user-badge";
import { useForgeShell } from "@/components/shell/app-shell";
import { getEntityNotesSummary } from "@/lib/note-helpers";
import {
  buildProjectCollectionCounts,
  filterProjectsByCollectionStatus,
  type ProjectCollectionStatusFilter
} from "@/lib/project-collections";
import { getSingleSelectedUserId } from "@/lib/user-ownership";

export function GoalsPage() {
  const shell = useForgeShell();
  const [projectFilter, setProjectFilter] =
    useState<ProjectCollectionStatusFilter>("active");
  const [pendingRestartProjectId, setPendingRestartProjectId] = useState<
    string | null
  >(null);
  const hasGoals = shell.snapshot.dashboard.goals.length > 0;
  const projectCounts = buildProjectCollectionCounts(
    shell.snapshot.dashboard.projects
  );
  const visibleProjects = filterProjectsByCollectionStatus(
    shell.snapshot.dashboard.projects,
    projectFilter
  );
  const defaultUserId = getSingleSelectedUserId(shell.selectedUserIds);
  const projectsByGoal = new Map(
    shell.snapshot.dashboard.goals.map((goal) => [
      goal.id,
      visibleProjects.filter((project) => project.goalId === goal.id)
    ])
  );

  const restartProject = async (projectId: string) => {
    setPendingRestartProjectId(projectId);
    try {
      await shell.patchProject(projectId, { status: "active" });
    } finally {
      setPendingRestartProjectId(null);
    }
  };

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="goal"
        title={
          <EntityName
            kind="goal"
            label="Life Goals"
            variant="heading"
            size="lg"
          />
        }
        titleText="Life Goals"
        description="Life goals are the destinations you care about over the long run. Each one can hold several projects, and those projects turn direction into real work."
        badge={`${shell.snapshot.dashboard.goals.length} active goals`}
        actions={
          hasGoals ? (
            <div className="inline-flex min-h-10 items-center rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-sm whitespace-nowrap text-white/68">
              {shell.snapshot.dashboard.projects.length} live project
              {shell.snapshot.dashboard.projects.length === 1 ? "" : "s"}{" "}
              attached
            </div>
          ) : null
        }
      />

      <GoalStudio
        goals={shell.snapshot.dashboard.goals}
        tags={shell.snapshot.tags}
        users={shell.snapshot.users}
        defaultUserId={defaultUserId}
        onCreate={shell.createGoal}
        onUpdate={shell.patchGoal}
      />

      {hasGoals ? (
        <ProjectCollectionFilters
          value={projectFilter}
          counts={projectCounts}
          onChange={setProjectFilter}
        />
      ) : null}

      {!hasGoals ? (
        <EmptyState
          eyebrow="Life goals"
          title="No life goals yet"
          description="Define the first long-horizon direction above so Forge can attach projects, tasks, momentum, and evidence to something meaningful."
        />
      ) : null}

      {hasGoals ? (
        <div className="grid gap-4">
          {shell.snapshot.dashboard.goals.map((goal) => {
            const linkedProjects = projectsByGoal.get(goal.id) ?? [];
            const goalNotes = getEntityNotesSummary(
              shell.snapshot.dashboard.notesSummaryByEntity,
              "goal",
              goal.id
            );
            return (
              <Link
                key={goal.id}
                to={`/goals/${goal.id}`}
                className="min-w-0 overflow-hidden rounded-[28px] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))] p-4 transition hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))] sm:p-5"
              >
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] xl:gap-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {goal.tags.slice(0, 3).map((tag) => (
                        <Badge
                          key={tag.id}
                          className="bg-white/[0.08]"
                          style={{ color: tag.color }}
                        >
                          {tag.name}
                        </Badge>
                      ))}
                      <Badge className="bg-white/[0.08] text-white/72">
                        {goal.horizon}
                      </Badge>
                      <UserBadge user={goal.user} compact />
                    </div>
                    <div className="mt-4">
                      <EntityName
                        kind="goal"
                        label={goal.title}
                        variant="heading"
                        size="xl"
                        lines={2}
                      />
                    </div>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-white/58">
                      {goal.description}
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-[18px] bg-white/[0.03] px-3.5 py-3">
                        <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">
                          Progress
                        </div>
                        <div className="mt-2 text-xl text-white">
                          {goal.progress}%
                        </div>
                      </div>
                      <div className="rounded-[18px] bg-white/[0.03] px-3.5 py-3">
                        <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">
                          Tasks done
                        </div>
                        <div className="mt-2 text-xl text-white">
                          {goal.completedTasks}/{Math.max(goal.totalTasks, 1)}
                        </div>
                      </div>
                      <div className="rounded-[18px] bg-white/[0.03] px-3.5 py-3">
                        <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">
                          XP banked
                        </div>
                        <div className="mt-2 text-xl text-white">
                          {goal.earnedPoints}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <ProgressMeter value={goal.progress} />
                    </div>
                    <div className="mt-4">
                      <EntityNoteCountLink
                        entityType="goal"
                        entityId={goal.id}
                        count={goalNotes.count}
                      />
                    </div>
                  </div>

                  <div className="min-w-0 rounded-[24px] bg-white/[0.04] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 text-sm font-medium text-white sm:text-base">
                        Projects carrying this direction
                      </div>
                      <div className="shrink-0 text-sm text-white/48">
                        {linkedProjects.length}
                      </div>
                    </div>
                    {linkedProjects.length === 0 ? (
                      <div className="mt-4 text-sm leading-6 text-white/56">
                        {projectFilter === "active"
                          ? "No active project is attached yet. Create one so this direction starts producing visible work."
                          : "No projects in this lifecycle view are attached yet. Switch filters or restart one to bring it back into active motion."}
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-3">
                        {linkedProjects.slice(0, 3).map((project) => (
                          <div
                            key={project.id}
                            className="rounded-[18px] bg-white/[0.05] px-4 py-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <EntityBadge
                                  kind="project"
                                  compact
                                  gradient={false}
                                />
                                <EntityName
                                  kind="project"
                                  label={project.title}
                                  className="min-w-0"
                                  showIcon={false}
                                  lines={2}
                                />
                              </div>
                              <Badge className="shrink-0">{project.status}</Badge>
                            </div>
                            <div className="mt-2 text-sm leading-6 text-white/58">
                              {project.description}
                            </div>
                            <div className="mt-3 text-sm text-white/42">
                              Next move:{" "}
                              {project.nextTaskTitle ??
                                "Define the first attached task"}
                            </div>
                            {projectFilter !== "active" &&
                            project.status !== "active" ? (
                              <div className="mt-4 flex justify-end">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  pending={
                                    pendingRestartProjectId === project.id
                                  }
                                  pendingLabel="Restarting…"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void restartProject(project.id);
                                  }}
                                >
                                  Restart
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <Card>
          <div className="rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/58">
            Goal cards will appear here once the first long-horizon direction is
            created.
          </div>
        </Card>
      )}
    </div>
  );
}
