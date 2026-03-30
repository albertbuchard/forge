import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { buildGoalGravityScene } from "@/components/psyche/goal-gravity-scene";
import { PsycheGraphCanvas } from "@/components/psyche/psyche-graph";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { getPsycheOverview } from "@/lib/api";
import { getEntityButtonClassName } from "@/lib/entity-visuals";
import { cn } from "@/lib/utils";

export function PsycheGoalMapPage() {
  const shell = useForgeShell();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const overviewQuery = useQuery({
    queryKey: ["forge-psyche-overview"],
    queryFn: getPsycheOverview
  });

  const overview = overviewQuery.data?.overview;
  const clusters = useMemo(() => {
    if (!overview) {
      return [];
    }

    return shell.snapshot.goals.map((goal) => {
      const linkedValues = overview.values.filter((value) => value.linkedGoalIds.includes(goal.id));
      const linkedProjects = shell.snapshot.dashboard.projects.filter((project) => project.goalId === goal.id);
      const linkedHabits = shell.snapshot.habits.filter((habit) =>
        habit.linkedGoalIds.includes(goal.id) ||
        habit.linkedValueIds.some((valueId) => linkedValues.some((value) => value.id === valueId))
      );
      const linkedReports = overview.reports.filter((report) => report.linkedGoalIds.includes(goal.id));
      const linkedBehaviors = overview.behaviors.filter((behavior) =>
        behavior.linkedValueIds.some((valueId) => linkedValues.some((value) => value.id === valueId))
      );
      const linkedBeliefs = overview.beliefs.filter((belief) =>
        belief.linkedValueIds.some((valueId) => linkedValues.some((value) => value.id === valueId))
      );

      return {
        goal,
        linkedValues,
        linkedProjects,
        linkedHabits,
        linkedReports,
        linkedBehaviors,
        linkedBeliefs
      };
    });
  }, [overview, shell.snapshot.dashboard.projects, shell.snapshot.goals, shell.snapshot.habits]);

  const scene = useMemo(() => buildGoalGravityScene(clusters), [clusters]);

  useEffect(() => {
    setSelectedNodeId(scene.defaultSelectedId);
  }, [scene.defaultSelectedId]);

  if (overviewQuery.isLoading) {
    return (
      <LoadingState
        eyebrow="Goal map"
        title="Loading the gravity well"
        description="Linking goals, values, reports, beliefs, behaviors, and projects back into execution."
      />
    );
  }

  if (overviewQuery.isError || !overview) {
    return <ErrorState eyebrow="Goal map" error={overviewQuery.error ?? new Error("Forge returned an empty Psyche overview payload.")} onRetry={() => void overviewQuery.refetch()} />;
  }

  const inspector = scene.inspectors[selectedNodeId ?? scene.defaultSelectedId] ?? scene.inspectors[scene.defaultSelectedId];

  return (
    <div className="grid min-w-0 gap-4">
      <PageHero
        title="Goal Map"
        titleText="Goal Map"
        description="Values orbit each goal. Habits, reports, beliefs, behaviors, and projects reveal where the orbit gets disrupted and how execution reconnects."
        badge={`${clusters.length} goal${clusters.length === 1 ? "" : "s"}`}
        actions={
          <>
            <Link to="/goals" className="inline-flex min-h-10 min-w-max shrink-0 items-center justify-center rounded-full bg-white/[0.08] px-4 py-2 text-sm whitespace-nowrap text-white transition hover:bg-white/[0.12]">
              Open goals
            </Link>
            <Link to="/psyche/reports?create=1" className="inline-flex min-h-10 min-w-max shrink-0 items-center justify-center rounded-full bg-[rgba(125,211,252,0.16)] px-4 py-2 text-sm whitespace-nowrap text-white transition hover:bg-[rgba(125,211,252,0.22)]">
              Reflect
            </Link>
          </>
        }
      />

      <PsycheSectionNav />

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <PsycheGraphCanvas
          testId="goal-gravity-graph"
          title="Life direction, value orbit, and execution field"
          hint="Drag to inspect the whole field. Select any goal, value, belief, behavior, project, or report to see what it means and where to act next."
          nodes={scene.nodes}
          edges={scene.edges}
          fields={scene.fields}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          minHeightClassName="min-h-[25rem] sm:min-h-[34rem] lg:min-h-[56rem]"
          legend={[
            { label: "Goals", kind: "goal" },
            { label: "Values", kind: "value" },
            { label: "Beliefs", kind: "belief" },
            { label: "Behaviors", kind: "behavior" },
            { label: "Habits", kind: "habit" },
            { label: "Projects", kind: "project" },
            { label: "Reports", kind: "report" }
          ]}
          action={
            clusters.length === 0 ? (
              <Link to="/goals" className="inline-flex min-h-10 min-w-max shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[linear-gradient(135deg,rgba(192,193,255,0.36),rgba(192,193,255,0.22))] px-4 py-2 text-sm font-medium whitespace-nowrap text-white">
                Add first goal
              </Link>
            ) : (
              <Link to="/goals" className="inline-flex min-h-10 min-w-max shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-white/8 px-4 py-2 text-sm font-medium whitespace-nowrap text-white transition hover:bg-white/12">
                Open goals
              </Link>
            )
          }
        />

        <Card className="min-w-0 h-fit xl:sticky xl:top-24">
          <div className="flex flex-wrap items-center gap-2">
            {inspector.entityKind ? (
              <EntityBadge kind={inspector.entityKind} compact gradient={false} iconOnly />
            ) : (
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">{inspector.eyebrow}</div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {inspector.entityKind ? (
              <EntityName kind={inspector.entityKind} label={inspector.title} variant="heading" size="lg" showKind={false} />
            ) : (
              <h2 className="font-display text-[clamp(1.35rem,2.2vw,2rem)] leading-none text-white">{inspector.title}</h2>
            )}
            {!inspector.entityKind ? (
              <Badge className="bg-white/[0.08]" style={{ color: "white" }}>
                {inspector.tone}
              </Badge>
            ) : null}
          </div>
          <p className="mt-3 text-sm leading-6 text-white/60">{inspector.summary}</p>

          {inspector.stats.length > 0 ? (
            <div className="mt-4 grid gap-2">
              {inspector.stats.map((stat) => (
                <div key={stat} className="rounded-[18px] bg-white/[0.04] px-3 py-3 text-sm text-white/68">
                  {stat}
                </div>
              ))}
            </div>
          ) : null}

          {inspector.chips.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {inspector.chips.map((chip) => (
                <Badge key={chip} className="bg-white/[0.08] text-white/74">
                  {chip}
                </Badge>
              ))}
            </div>
          ) : null}

          <div className="mt-5">
            <Link
              to={inspector.href}
              className={cn(
                "inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-medium whitespace-nowrap shadow-[0_12px_30px_rgba(192,193,255,0.08)]",
                inspector.entityKind
                  ? getEntityButtonClassName(inspector.entityKind, true)
                  : "bg-[linear-gradient(135deg,rgba(192,193,255,0.36),rgba(192,193,255,0.22))] text-white"
              )}
            >
              {inspector.ctaLabel}
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
