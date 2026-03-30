import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { buildGoalGravityScene } from "@/components/psyche/goal-gravity-scene";
import { PsycheGraphCanvas } from "@/components/psyche/psyche-graph";
import { ReflectFlowDialog } from "@/components/psyche/reflect-flow-dialog";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { InteractiveCard } from "@/components/ui/interactive-card";
import { ErrorState } from "@/components/ui/page-state";
import { getEntityButtonClassName } from "@/lib/entity-visuals";
import { cn } from "@/lib/utils";
import { getPsycheOverview } from "@/lib/api";

export function PsychePage() {
  const shell = useForgeShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reflectOpen, setReflectOpen] = useState(searchParams.get("reflect") === "1");
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

    return shell.snapshot.goals.slice(0, 3).map((goal) => {
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

  const scene = useMemo(() => buildGoalGravityScene(clusters, { compact: true }), [clusters]);

  useEffect(() => {
    setSelectedNodeId(scene.defaultSelectedId);
  }, [scene.defaultSelectedId]);

  if (overviewQuery.isLoading) {
    return <SurfaceSkeleton />;
  }

  if (overviewQuery.isError || !overview) {
    return <ErrorState eyebrow="Psyche" error={overviewQuery.error} onRetry={() => void overviewQuery.refetch()} />;
  }

  const inspector = scene.inspectors[selectedNodeId ?? scene.defaultSelectedId] ?? scene.inspectors[scene.defaultSelectedId];
  const hotPattern = overview.patterns[0] ?? null;
  const nextReport = overview.reports[0] ?? null;

  return (
    <div className="grid min-w-0 gap-4 overflow-x-clip">
      <PageHero
        title="Psyche"
        titleText="Psyche"
        description="See your goals, values, habits, beliefs, behaviors, projects, and reports together, then open the goal map when you want the full structure."
        badge={`${overview.domain.title} active`}
        actions={
          <>
            <Link to="/psyche/goal-map" className="inline-flex min-h-10 min-w-0 max-w-full items-center justify-center rounded-full bg-white/[0.08] px-4 py-2 text-sm whitespace-nowrap text-white transition hover:bg-white/[0.12]">
              Open goal map
            </Link>
          </>
        }
      />

      <PsycheSectionNav />

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <PsycheGraphCanvas
          testId="psyche-hub-graph"
          compact
          title="Reflective pulse and live entity field"
          hint="This is the live field. Select any goal, value, habit, belief, behavior, project, or report, then open the full goal map when you want the wider structure."
          nodes={scene.nodes}
          edges={scene.edges}
          fields={scene.fields}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          minHeightClassName="min-h-[20rem] sm:min-h-[24rem] lg:min-h-[34rem]"
          legend={[
            { label: "Goals", kind: "goal" },
            { label: "Values", kind: "value" },
            { label: "Habits", kind: "habit" },
            { label: "Behaviors", kind: "behavior" }
          ]}
          action={
            <>
              <Link to="/psyche/goal-map" className="inline-flex min-h-10 min-w-0 max-w-full items-center justify-center rounded-[var(--radius-control)] bg-white/8 px-4 py-2 text-sm font-medium whitespace-nowrap text-white transition hover:bg-white/12">
                Open goal map
              </Link>
              <Button size="sm" className="min-w-0 sm:min-w-[6.5rem]" onClick={() => setReflectOpen(true)}>Reflect</Button>
            </>
          }
        />

        <Card className="h-fit min-w-0 xl:sticky xl:top-24">
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
              <h2 className="font-display text-[clamp(1.25rem,2.2vw,1.8rem)] leading-none text-white">{inspector.title}</h2>
            )}
          </div>
          <p className="mt-3 text-sm leading-6 text-white/60">{inspector.summary}</p>
          {inspector.chips.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {inspector.chips.map((chip) => (
                <Badge key={chip} className="bg-white/[0.08] text-white/74">
                  {chip}
                </Badge>
              ))}
            </div>
          ) : null}
          {inspector.stats.length > 0 ? (
            <div className="mt-4 grid gap-2">
              {inspector.stats.map((stat) => (
                <div key={stat} className="rounded-[18px] bg-white/[0.04] px-3 py-3 text-sm text-white/68">
                  {stat}
                </div>
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

      <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <InteractiveCard to="/psyche/behaviors" className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(17,29,32,0.96),rgba(11,21,23,0.94))] p-5">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[rgba(110,231,183,0.82)]">Best next reflective move</div>
          <div className="mt-3 font-display text-[clamp(1.45rem,2.2vw,2rem)] leading-none text-white">
            {hotPattern?.preferredResponse || "Map the active loop, then name the committed move that brings you back."}
          </div>
          <p className="mt-3 text-sm leading-6 text-white/58">
            {hotPattern?.targetBehavior || "When the loop is explicit, the return path stops feeling abstract."}
          </p>
        </InteractiveCard>

        <InteractiveCard to={nextReport ? `/psyche/reports/${nextReport.id}` : "/psyche/reports"} className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(24,19,37,0.96),rgba(13,12,22,0.94))] p-5">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-violet-100/72">Open threads</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-[22px] bg-white/[0.04] px-4 py-4">
              <div className="text-sm text-white/58">Insights</div>
              <div className="mt-2 font-display text-4xl text-white">{overview.openInsights}</div>
            </div>
            <div className="rounded-[22px] bg-white/[0.04] px-4 py-4">
              <div className="text-sm text-white/58">Notes</div>
              <div className="mt-2 font-display text-4xl text-white">{overview.openNotes}</div>
            </div>
          </div>
          <div className="mt-4 text-sm text-white/60">
            {nextReport?.title || "Open the next chain and keep the report field live without adding more dashboard noise."}
          </div>
        </InteractiveCard>
      </section>

      <ReflectFlowDialog
        open={reflectOpen}
        onOpenChange={(open) => {
          setReflectOpen(open);
          const next = new URLSearchParams(searchParams);
          next.delete("reflect");
          setSearchParams(next, { replace: true });
        }}
      />
    </div>
  );
}
