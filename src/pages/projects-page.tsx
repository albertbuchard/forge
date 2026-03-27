import { Link } from "react-router-dom";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { EmptyState } from "@/components/ui/page-state";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { InteractiveCard } from "@/components/ui/interactive-card";
import { useForgeShell } from "@/components/shell/app-shell";

export function ProjectsPage() {
  const { snapshot } = useForgeShell();

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="project"
        title={<EntityName kind="project" label="Projects" variant="heading" size="lg" />}
        titleText="Projects"
        description="Projects are the concrete paths that move a life goal forward. Each project owns its own tasks, its own board, and its own evidence of progress."
        badge={`${snapshot.dashboard.projects.length} projects`}
      />

      {snapshot.dashboard.projects.length === 0 ? (
        <EmptyState
          eyebrow="Projects"
          title="No projects in flight"
          description="Create the first practical path under a life goal so execution, kanban, and evidence all have a concrete home."
          action={
            <Link to="/goals" className="inline-flex min-h-10 min-w-max shrink-0 items-center justify-center rounded-full bg-white/[0.08] px-4 py-3 text-sm whitespace-nowrap text-white transition hover:bg-white/[0.12]">
              Open goals
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {snapshot.dashboard.projects.map((project) => (
            <InteractiveCard key={project.id} to={`/projects/${project.id}`} className="transition">
              <div className="flex items-center justify-between gap-3">
                <EntityBadge kind="goal" label={project.goalTitle} compact />
                <Badge className={project.status === "completed" ? "text-emerald-300" : project.status === "paused" ? "text-amber-300" : "text-[var(--primary)]"}>
                  {project.status}
                </Badge>
              </div>
              <div className="mt-4">
                <EntityName kind="project" label={project.title} variant="heading" size="xl" />
              </div>
              <p className="mt-3 text-sm leading-6 text-white/58">{project.description}</p>
              <div className="mt-4">
                <ProgressMeter value={project.progress} tone={project.status === "completed" ? "secondary" : "primary"} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div>
                  <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">Active</div>
                  <div className="mt-2 text-white">{project.activeTaskCount}</div>
                </div>
                <div>
                  <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">Completed</div>
                  <div className="mt-2 text-white">{project.completedTaskCount}</div>
                </div>
                <div>
                  <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">XP</div>
                  <div className="mt-2 text-white">{project.earnedPoints}</div>
                </div>
              </div>
              <div className="mt-5 text-[11px] uppercase tracking-[0.16em] text-white/40">
                {project.nextTaskTitle ? `Next move: ${project.nextTaskTitle}` : "Ready for the next task"}
              </div>
            </InteractiveCard>
          ))}
        </div>
      )}
    </div>
  );
}
