import { Link } from "react-router-dom";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { useForgeShell } from "@/components/shell/app-shell";

export function CampaignsPage() {
  const { snapshot } = useForgeShell();
  const goals = snapshot.dashboard.goals;
  const projects = snapshot.dashboard.projects;
  const activeGoals = goals.filter((goal) => goal.status === "active");

  const goalCampaigns = activeGoals
    .map((goal) => {
      const relatedProjects = projects.filter((project) => project.goalId === goal.id);
      const focusProjectCount = relatedProjects.filter((project) => project.nextTaskTitle).length;
      const blockedTaskCount = snapshot.tasks.filter((task) => task.goalId === goal.id && task.status === "blocked").length;
      const focusTaskCount = snapshot.tasks.filter((task) => task.goalId === goal.id && (task.status === "focus" || task.status === "in_progress")).length;
      const totalTrackedMinutes = relatedProjects.reduce((sum, project) => sum + Math.floor(project.time.totalCreditedSeconds / 60), 0);

      return {
        goal,
        relatedProjects,
        focusProjectCount,
        blockedTaskCount,
        focusTaskCount,
        totalTrackedMinutes
      };
    })
    .sort((left, right) => right.relatedProjects.length - left.relatedProjects.length || right.goal.progress - left.goal.progress);

  const hasCampaigns = goalCampaigns.some((entry) => entry.relatedProjects.length > 0);

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="goal"
        title="Campaigns"
        titleText="Campaigns"
        description="Campaigns are the planning view across each life goal and the projects carrying it. Use this surface to see where strategic effort is concentrated, where it is blocked, and which project board to open next."
        badge={`${goalCampaigns.length} strategic arc${goalCampaigns.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/goals">
              <Button variant="secondary">Open goals</Button>
            </Link>
            <Link to="/projects">
              <Button variant="ghost">Open projects</Button>
            </Link>
          </div>
        }
      />

      {!hasCampaigns ? (
        <EmptyState
          eyebrow="Campaigns"
          title={goals.length === 0 ? "No strategic arcs yet" : "No campaign lanes yet"}
          description={
            goals.length === 0
              ? "Create a life goal first. Campaigns appear when Forge has a real direction to plan against."
              : "Create the first project under a life goal. Campaigns group those projects into one planning surface per goal."
          }
          action={
            <Link to={goals.length === 0 ? "/goals" : "/projects"} className="inline-flex min-h-10 min-w-max shrink-0 items-center justify-center rounded-full bg-white/[0.08] px-4 py-3 text-sm whitespace-nowrap text-white transition hover:bg-white/[0.12]">
              {goals.length === 0 ? "Open goals" : "Open projects"}
            </Link>
          }
        />
      ) : (
        <div className="grid gap-5">
          {goalCampaigns.map(({ goal, relatedProjects, blockedTaskCount, focusProjectCount, focusTaskCount, totalTrackedMinutes }) => (
            <Card key={goal.id} className="overflow-hidden">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <EntityBadge kind="goal" label={goal.horizon} compact gradient={false} />
                    <Badge className="bg-white/[0.08] text-white/72">{relatedProjects.length} project{relatedProjects.length === 1 ? "" : "s"}</Badge>
                    <Badge className="bg-white/[0.08] text-white/72">{focusTaskCount} live task{focusTaskCount === 1 ? "" : "s"}</Badge>
                  </div>
                  <div className="mt-4">
                    <EntityName kind="goal" label={goal.title} variant="heading" size="xl" />
                  </div>
                  <p className="mt-3 text-sm leading-7 text-white/60">{goal.description}</p>
                  <div className="mt-4">
                    <ProgressMeter value={goal.progress} />
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">Progress</div>
                      <div className="mt-2 text-xl text-white">{goal.progress}%</div>
                    </div>
                    <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">Focused projects</div>
                      <div className="mt-2 text-xl text-white">{focusProjectCount}</div>
                    </div>
                    <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">Blocked tasks</div>
                      <div className="mt-2 text-xl text-white">{blockedTaskCount}</div>
                    </div>
                    <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">Tracked time</div>
                      <div className="mt-2 text-xl text-white">{totalTrackedMinutes} min</div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link to={`/goals/${goal.id}`}>
                      <Button variant="secondary">Open goal</Button>
                    </Link>
                    <Link to="/projects">
                      <Button variant="ghost">Open project index</Button>
                    </Link>
                  </div>
                </div>

                <div className="min-w-0 rounded-[24px] bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Campaign lanes</div>
                      <h2 className="mt-2 font-display text-[clamp(1.2rem,1.8vw,1.55rem)] text-white">Projects carrying this goal</h2>
                    </div>
                    <div className="text-sm text-white/45">{relatedProjects.length}</div>
                  </div>

                  {relatedProjects.length === 0 ? (
                    <div className="mt-4 rounded-[18px] bg-white/[0.04] p-4 text-sm leading-6 text-white/58">
                      This goal has direction but no live project lane yet. Open goals or projects and create the first concrete initiative.
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3">
                      {relatedProjects.map((project) => (
                        <Link key={project.id} to={`/projects/${project.id}`} className="rounded-[20px] bg-white/[0.05] p-4 transition hover:bg-white/[0.09]">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <EntityBadge kind="project" compact gradient={false} />
                                <EntityName kind="project" label={project.title} showIcon={false} className="min-w-0" />
                              </div>
                              <p className="mt-2 text-sm leading-6 text-white/58">{project.description}</p>
                            </div>
                            <Badge className="bg-white/[0.08] text-white/72">{project.status}</Badge>
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-4">
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">Progress</div>
                              <div className="mt-1 text-white">{project.progress}%</div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">Active</div>
                              <div className="mt-1 text-white">{project.activeTaskCount}</div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">Completed</div>
                              <div className="mt-1 text-white">{project.completedTaskCount}</div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">Next move</div>
                              <div className="mt-1 text-sm text-white/62">{project.nextTaskTitle ?? "Define the next task"}</div>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
