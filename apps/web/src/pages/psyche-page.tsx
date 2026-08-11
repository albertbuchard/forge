import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { type SurfaceWidgetDefinition } from "@/components/customization/editable-surface";
import { AiSurfaceWorkspace } from "@/components/customization/ai-surface-workspace";
import { buildGoalGravityScene } from "@/components/psyche/goal-gravity-scene";
import { GamificationMiniHud } from "@/components/gamification/gamification-widgets";
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
import { getPsycheOverview, listQuestionnaires } from "@/lib/api";
import type { DevrageMetricPayload } from "@/lib/psyche-types";

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat().format(Math.round(value));
}

const psycheSecondaryActionClassName =
  "inline-flex min-h-10 min-w-0 max-w-full items-center justify-center rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-2 text-sm font-medium whitespace-nowrap text-[var(--ui-ink-medium)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]";

const psycheFallbackCtaClassName =
  "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_34%,var(--ui-surface-2)_66%),color-mix(in_srgb,var(--primary)_18%,var(--ui-surface-1)_82%))] text-[var(--ui-ink-strong)]";

function DevrageMetricCard({ metric }: { metric: DevrageMetricPayload }) {
  const latestHistory = metric.history.slice(0, 7).reverse();
  const maxSwears = Math.max(
    1,
    ...latestHistory.map((day) => day.rawSwearCount)
  );

  return (
    <Card className="min-w-0 border border-[color-mix(in_srgb,var(--warning)_24%,var(--ui-border-subtle)_76%)] bg-[color-mix(in_srgb,var(--ui-warning-soft)_48%,var(--ui-surface-1)_52%)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--warning)]">
            Devrage metric
          </div>
          <div className="mt-2 break-words font-display text-[clamp(1.4rem,2.5vw,2.15rem)] leading-none text-[var(--ui-ink-strong)]">
            {formatCount(metric.rawSwearCount)} swears
          </div>
        </div>
        <Badge className="bg-[var(--ui-warning-soft)] text-[var(--warning)]">
          {metric.latestDateKey ?? "No history"}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="min-w-0 rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3">
          <div className="text-xs text-[var(--ui-ink-faint)]">
            Swearing messages
          </div>
          <div className="mt-1 break-words text-2xl font-semibold text-[var(--ui-ink-strong)]">
            {formatPercent(metric.swearingMessagePercent)}
          </div>
        </div>
        <div className="min-w-0 rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3">
          <div className="text-xs text-[var(--ui-ink-faint)]">Rage peak</div>
          <div className="mt-1 break-words text-2xl font-semibold text-[var(--ui-ink-strong)]">
            {formatCount(metric.maxCumulativeRage)}
          </div>
        </div>
        <div className="min-w-0 rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3">
          <div className="text-xs text-[var(--ui-ink-faint)]">
            Avg thread peak
          </div>
          <div className="mt-1 break-words text-2xl font-semibold text-[var(--ui-ink-strong)]">
            {formatCount(metric.averageMaxCumulativeRage)}
          </div>
        </div>
      </div>

      <div className="mt-4 flex h-16 items-end gap-1.5">
        {latestHistory.length > 0 ? (
          latestHistory.map((day) => (
            <div
              key={day.dateKey}
              className="min-w-0 flex-1 rounded-t-[6px] bg-[var(--warning)]/50"
              style={{
                height: `${Math.max(8, (day.rawSwearCount / maxSwears) * 64)}px`
              }}
              title={`${day.dateKey}: ${formatCount(day.rawSwearCount)} swears, ${formatPercent(day.swearingMessagePercent)} swearing messages, ${formatCount(day.maxCumulativeRage)} max cumulative rage`}
            />
          ))
        ) : (
          <div className="self-center text-sm text-[var(--ui-ink-faint)]">
            History will appear after the first local backfill.
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--ui-ink-soft)]">
        <span>{formatCount(metric.conversationsScanned)} conversations</span>
        <span>{formatCount(metric.messagesScanned)} messages</span>
        <span>{formatCount(metric.messagesWithSwears)} flagged</span>
        <span>{formatCount(metric.maxSwearingStreak)} max streak</span>
      </div>

      <Link
        to="/psyche/metrics"
        className="mt-4 inline-flex min-h-10 items-center justify-center rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--warning)_24%,transparent)] bg-[var(--ui-warning-soft)] px-4 py-2 text-sm font-medium text-[var(--warning)] transition hover:bg-[color-mix(in_srgb,var(--warning)_20%,transparent)]"
      >
        Open metrics
      </Link>
    </Card>
  );
}

export function PsychePage() {
  const shell = useForgeShell();
  const mode = "custom" as const;
  const [searchParams, setSearchParams] = useSearchParams();
  const [reflectOpen, setReflectOpen] = useState(
    searchParams.get("reflect") === "1"
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const overviewQuery = useQuery({
    queryKey: ["forge-psyche-overview"],
    queryFn: getPsycheOverview
  });
  const questionnairesQuery = useQuery({
    queryKey: ["forge-psyche-questionnaires-hub"],
    queryFn: () => listQuestionnaires()
  });

  const overview = overviewQuery.data?.overview;

  const clusters = useMemo(() => {
    if (!overview) {
      return [];
    }

    return shell.snapshot.goals.slice(0, 3).map((goal) => {
      const linkedValues = overview.values.filter((value) =>
        value.linkedGoalIds.includes(goal.id)
      );
      const linkedProjects = shell.snapshot.dashboard.projects.filter(
        (project) => project.goalId === goal.id
      );
      const linkedHabits = shell.snapshot.habits.filter(
        (habit) =>
          habit.linkedGoalIds.includes(goal.id) ||
          habit.linkedValueIds.some((valueId) =>
            linkedValues.some((value) => value.id === valueId)
          )
      );
      const linkedReports = overview.reports.filter((report) =>
        report.linkedGoalIds.includes(goal.id)
      );
      const linkedBehaviors = overview.behaviors.filter((behavior) =>
        behavior.linkedValueIds.some((valueId) =>
          linkedValues.some((value) => value.id === valueId)
        )
      );
      const linkedBeliefs = overview.beliefs.filter((belief) =>
        belief.linkedValueIds.some((valueId) =>
          linkedValues.some((value) => value.id === valueId)
        )
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
  }, [
    overview,
    shell.snapshot.dashboard.projects,
    shell.snapshot.goals,
    shell.snapshot.habits
  ]);

  const scene = useMemo(
    () => buildGoalGravityScene(clusters, { compact: true }),
    [clusters]
  );

  useEffect(() => {
    setSelectedNodeId(scene.defaultSelectedId);
  }, [scene.defaultSelectedId]);

  if (overviewQuery.isLoading) {
    return <SurfaceSkeleton />;
  }

  if (overviewQuery.isError || !overview) {
    return (
      <ErrorState
        eyebrow="Psyche"
        error={overviewQuery.error}
        onRetry={() => void overviewQuery.refetch()}
      />
    );
  }

  const inspector =
    scene.inspectors[selectedNodeId ?? scene.defaultSelectedId] ??
    scene.inspectors[scene.defaultSelectedId];
  const hotPattern = overview.patterns[0] ?? null;
  const nextReport = overview.reports[0] ?? null;
  const latestQuestionnaire =
    [...(questionnairesQuery.data?.instruments ?? [])].sort((left, right) => {
      const leftTime = left.latestRunAt
        ? new Date(left.latestRunAt).getTime()
        : 0;
      const rightTime = right.latestRunAt
        ? new Date(right.latestRunAt).getTime()
        : 0;
      return rightTime - leftTime;
    })[0] ?? null;
  const reflectiveDestinations = [
    { label: "Values", count: overview.values.length, href: "/psyche/values" },
    {
      label: "Patterns",
      count: overview.patterns.length,
      href: "/psyche/patterns"
    },
    {
      label: "Behaviors",
      count: overview.behaviors.length,
      href: "/psyche/behaviors"
    },
    {
      label: "Beliefs",
      count: overview.beliefs.length,
      href: "/psyche/schemas-beliefs"
    },
    { label: "Modes", count: overview.modes.length, href: "/psyche/modes" },
    {
      label: "Reports",
      count: overview.reports.length,
      href: "/psyche/reports"
    },
    {
      label: "Flashcards",
      count: overview.flashcards.length,
      href: "/psyche/flashcards"
    }
  ] as const;
  const storedReflectiveRecordCount = reflectiveDestinations.reduce(
    (total, destination) => total + destination.count,
    0
  );
  const questionnaireCount = questionnairesQuery.data?.instruments?.length ?? 0;
  const questionnaireContextPending =
    questionnairesQuery.isLoading || questionnairesQuery.isPending;
  const questionnaireContextUnavailable = questionnairesQuery.isError;
  const questionnaireCountLabel = questionnaireContextPending
    ? "Loading"
    : questionnaireContextUnavailable
      ? "Unavailable"
      : `${questionnaireCount} available`;
  const isFirstVisit =
    !questionnaireContextPending &&
    !questionnaireContextUnavailable &&
    storedReflectiveRecordCount === 0 &&
    overview.openInsights === 0 &&
    overview.openNotes === 0 &&
    !latestQuestionnaire?.latestRunId;
  const heroDescription =
    "Values, patterns, behaviors, beliefs, habits, and reports in one live field.";
  const devrageAvailable =
    overview.devrageMetric.hasData ||
    overview.devrageMetric.conversationsScanned > 0 ||
    overview.devrageMetric.history.length > 0;
  const heroActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <GamificationMiniHud metrics={shell.snapshot.metrics} />
      <Link to="/psyche/goal-map" className={psycheSecondaryActionClassName}>
        Open goal map
      </Link>
    </div>
  );

  const customWidgets: SurfaceWidgetDefinition[] = [
    {
      id: "hero",
      title: "Psyche",
      description: "Top route composition",
      defaultWidth: 12,
      defaultHeight: 1,
      removable: false,
      surfaceChrome: "none",
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () => (
        <PageHero
          title="Psyche"
          titleText="Psyche"
          description={heroDescription}
          actions={heroActions}
        />
      )
    },
    {
      id: "sections",
      title: "Psyche sections",
      description: "Section switcher",
      defaultWidth: 12,
      defaultHeight: 1,
      surfaceChrome: "none",
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () => <PsycheSectionNav />
    },
    {
      id: "orientation",
      title: "Reflective record guide",
      description: "Private first-use guidance and a live record inventory.",
      defaultWidth: 12,
      defaultHeight: 3,
      removable: false,
      surfaceChrome: "none",
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () => (
        <Card
          aria-labelledby="psyche-orientation-title"
          className="min-w-0 border border-[color-mix(in_srgb,var(--tertiary)_24%,var(--ui-border-subtle)_76%)] bg-[color-mix(in_srgb,var(--tertiary)_8%,var(--ui-surface-1)_92%)] p-5 sm:p-6"
        >
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--tertiary)]">
            {isFirstVisit ? "First visit" : "Reflective record guide"}
          </div>
          <div className="mt-2 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
            <div className="min-w-0">
              <h2
                id="psyche-orientation-title"
                className="break-words font-display text-[clamp(1.45rem,2.8vw,2.2rem)] leading-none text-[var(--ui-ink-strong)]"
              >
                {isFirstVisit
                  ? "Start with a private reflection"
                  : "Your reflective records and recent context"}
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
                Psyche shows records available in your current Forge scope.
                These tools support self-observation; they do not provide a
                diagnosis. Opening this guide writes nothing. A record is saved
                only when you submit a form or complete a guided action.
              </p>

              <div
                className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
                role="list"
                aria-label="Reflective record destinations"
              >
                {reflectiveDestinations.map((destination) => (
                  <div key={destination.href} role="listitem">
                    <Link
                      to={destination.href}
                      aria-label={`Open ${destination.label}: ${destination.count} stored`}
                      className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3.5 py-2.5 text-sm transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
                    >
                      <span className="truncate font-medium text-[var(--ui-ink-strong)]">
                        {destination.label}
                      </span>
                      <Badge className="shrink-0 bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                        {destination.count}
                      </Badge>
                    </Link>
                  </div>
                ))}
                <div role="listitem">
                  <Link
                    to="/psyche/questionnaires"
                    aria-label={`Open Questionnaires: ${questionnaireCountLabel}`}
                    className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3.5 py-2.5 text-sm transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
                  >
                    <span className="truncate font-medium text-[var(--ui-ink-strong)]">
                      Questionnaires
                    </span>
                    <Badge className="shrink-0 bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                      {questionnaireCountLabel}
                    </Badge>
                  </Link>
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                Recent context
              </div>
              <div className="mt-3 grid gap-2 text-sm text-[var(--ui-ink-soft)]">
                {nextReport ? (
                  <Link
                    to={`/psyche/reports/${nextReport.id}`}
                    className="min-h-11 rounded-[16px] bg-[var(--ui-surface-2)] px-3.5 py-3 font-medium text-[var(--ui-ink-strong)] transition hover:bg-[var(--ui-surface-hover)]"
                  >
                    Latest report: {nextReport.title}
                  </Link>
                ) : (
                  <div className="rounded-[16px] bg-[var(--ui-surface-2)] px-3.5 py-3">
                    No stored report yet.
                  </div>
                )}
                {questionnaireContextPending ? (
                  <div
                    aria-live="polite"
                    className="rounded-[16px] bg-[var(--ui-surface-2)] px-3.5 py-3"
                  >
                    Loading questionnaire context…
                  </div>
                ) : questionnaireContextUnavailable ? (
                  <div
                    role="status"
                    className="rounded-[16px] bg-[var(--ui-surface-2)] px-3.5 py-3"
                  >
                    Questionnaire context is temporarily unavailable.
                  </div>
                ) : latestQuestionnaire?.latestRunId ? (
                  <Link
                    to={`/psyche/questionnaire-runs/${latestQuestionnaire.latestRunId}`}
                    className="min-h-11 rounded-[16px] bg-[var(--ui-surface-2)] px-3.5 py-3 font-medium text-[var(--ui-ink-strong)] transition hover:bg-[var(--ui-surface-hover)]"
                  >
                    Latest questionnaire: {latestQuestionnaire.title}
                  </Link>
                ) : (
                  <div className="rounded-[16px] bg-[var(--ui-surface-2)] px-3.5 py-3">
                    No questionnaire run yet.
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-[var(--ui-accent-soft)] text-[var(--primary)]">
                    {overview.openInsights} linked insights
                  </Badge>
                  <Badge className="bg-[var(--ui-accent-soft)] text-[var(--primary)]">
                    {overview.openNotes} linked notes
                  </Badge>
                </div>
              </div>
              <Button
                className="mt-4 min-h-11 w-full"
                onClick={() => setReflectOpen(true)}
              >
                {isFirstVisit ? "Start a reflection" : "Add reflection"}
              </Button>
            </div>
          </div>
        </Card>
      )
    },
    {
      id: "field",
      title: "Live field",
      description: "Graph and inspector stay as movable widgets.",
      defaultWidth: 8,
      defaultHeight: 5,
      minWidth: 6,
      render: () => (
        <PsycheGraphCanvas
          testId="psyche-hub-graph"
          compact
          title="Reflective pulse and live entity field"
          hint="Select any goal, value, habit, belief, behavior, project, or report."
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
              <Link
                to="/psyche/goal-map"
                className={psycheSecondaryActionClassName}
              >
                Open goal map
              </Link>
              <Button
                size="sm"
                className="min-w-0 sm:min-w-[6.5rem]"
                onClick={() => setReflectOpen(true)}
              >
                Reflect
              </Button>
            </>
          }
        />
      )
    },
    {
      id: "inspector",
      title: "Inspector",
      description: "Selected-node inspector widget.",
      defaultWidth: 4,
      defaultHeight: 5,
      minWidth: 4,
      render: () => (
        <Card className="h-full min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {inspector.entityKind ? (
              <EntityBadge
                kind={inspector.entityKind}
                compact
                gradient={false}
                iconOnly
              />
            ) : (
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                {inspector.eyebrow}
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {inspector.entityKind ? (
              <EntityName
                kind={inspector.entityKind}
                label={inspector.title}
                variant="heading"
                size="lg"
                showKind={false}
              />
            ) : (
              <h2 className="break-words font-display text-[clamp(1.25rem,2.2vw,1.8rem)] leading-none text-[var(--ui-ink-strong)]">
                {inspector.title}
              </h2>
            )}
          </div>
          <p className="mt-3 break-words text-sm leading-6 text-[var(--ui-ink-soft)]">
            {inspector.summary}
          </p>
          {inspector.chips.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {inspector.chips.map((chip) => (
                <Badge
                  key={chip}
                  className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                >
                  {chip}
                </Badge>
              ))}
            </div>
          ) : null}
          {inspector.stats.length > 0 ? (
            <div className="mt-4 grid gap-2">
              {inspector.stats.map((stat) => (
                <div
                  key={stat}
                  className="min-w-0 rounded-[18px] bg-[var(--ui-surface-1)] px-3 py-3 text-sm text-[var(--ui-ink-medium)] break-words"
                >
                  {stat}
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-5">
            <Link
              to={inspector.href}
              className={cn(
                "inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-medium whitespace-nowrap shadow-[var(--ui-shadow-soft)]",
                inspector.entityKind
                  ? getEntityButtonClassName(inspector.entityKind, true)
                  : psycheFallbackCtaClassName
              )}
            >
              {inspector.ctaLabel}
            </Link>
          </div>
        </Card>
      )
    },
    ...(devrageAvailable
      ? [
          {
            id: "devrage",
            title: "Devrage metric",
            description: "Daily user-message frustration metric.",
            defaultWidth: 4,
            defaultHeight: 3,
            minWidth: 4,
            render: () => <DevrageMetricCard metric={overview.devrageMetric} />
          }
        ]
      : []),
    {
      id: "actions",
      title: "Open threads",
      description: "Action and pulse cards.",
      defaultWidth: 8,
      defaultHeight: 3,
      render: () => (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <InteractiveCard
            to="/psyche/behaviors"
            className="rounded-[28px] border border-[color-mix(in_srgb,var(--success)_22%,var(--ui-border-subtle)_78%)] bg-[color-mix(in_srgb,var(--ui-success-soft)_44%,var(--ui-surface-1)_56%)] p-5"
          >
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--success)]">
              Best next reflective move
            </div>
            <div className="mt-3 break-words font-display text-[clamp(1.45rem,2.2vw,2rem)] leading-none text-[var(--ui-ink-strong)]">
              {hotPattern?.preferredResponse ||
                "Map the active loop, then name the committed move that brings you back."}
            </div>
            <p className="mt-3 break-words text-sm leading-6 text-[var(--ui-ink-soft)]">
              {hotPattern?.targetBehavior ||
                "When the loop is explicit, the return path stops feeling abstract."}
            </p>
          </InteractiveCard>

          <InteractiveCard
            to={
              nextReport
                ? `/psyche/reports/${nextReport.id}`
                : "/psyche/reports"
            }
            className="rounded-[28px] border border-[color-mix(in_srgb,var(--primary)_22%,var(--ui-border-subtle)_78%)] bg-[color-mix(in_srgb,var(--ui-accent-soft)_46%,var(--ui-surface-1)_54%)] p-5"
          >
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--primary)]">
              Open threads
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="min-w-0 rounded-[22px] bg-[var(--ui-surface-1)] px-4 py-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Insights
                </div>
                <div className="mt-2 break-words font-display text-4xl text-[var(--ui-ink-strong)]">
                  {overview.openInsights}
                </div>
              </div>
              <div className="min-w-0 rounded-[22px] bg-[var(--ui-surface-1)] px-4 py-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">Notes</div>
                <div className="mt-2 break-words font-display text-4xl text-[var(--ui-ink-strong)]">
                  {overview.openNotes}
                </div>
              </div>
            </div>
          </InteractiveCard>
        </div>
      )
    },
    {
      id: "questionnaires",
      title: "Questionnaire pulse",
      description: "Recent questionnaire state.",
      defaultWidth: 12,
      defaultHeight: 2,
      render: () => (
        <InteractiveCard
          to={
            latestQuestionnaire?.latestRunId
              ? `/psyche/questionnaire-runs/${latestQuestionnaire.latestRunId}`
              : "/psyche/questionnaires"
          }
          className="rounded-[28px] border border-[color-mix(in_srgb,var(--info)_22%,var(--ui-border-subtle)_78%)] bg-[color-mix(in_srgb,var(--ui-info-soft)_42%,var(--ui-surface-1)_58%)] p-5"
        >
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--info)]">
            Questionnaire pulse
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 break-words font-display text-[clamp(1.4rem,2.2vw,2rem)] leading-none text-[var(--ui-ink-strong)]">
              {latestQuestionnaire?.title ?? "Questionnaire library ready"}
            </div>
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {(questionnairesQuery.data?.instruments ?? []).length} available
            </Badge>
          </div>
        </InteractiveCard>
      )
    }
  ];

  return (
    <div className="grid min-w-0 gap-4 overflow-x-clip">
      {mode === "custom" ? (
        <AiSurfaceWorkspace surfaceId="psyche" baseWidgets={customWidgets} />
      ) : (
        <>
          <PageHero
            title="Psyche"
            titleText="Psyche"
            description={heroDescription}
            actions={heroActions}
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
                  <Link
                    to="/psyche/goal-map"
                    className={psycheSecondaryActionClassName}
                  >
                    Open goal map
                  </Link>
                  <Button
                    size="sm"
                    className="min-w-0 sm:min-w-[6.5rem]"
                    onClick={() => setReflectOpen(true)}
                  >
                    Reflect
                  </Button>
                </>
              }
            />

            <Card className="h-fit min-w-0 xl:sticky xl:top-24">
              <div className="flex flex-wrap items-center gap-2">
                {inspector.entityKind ? (
                  <EntityBadge
                    kind={inspector.entityKind}
                    compact
                    gradient={false}
                    iconOnly
                  />
                ) : (
                  <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                    {inspector.eyebrow}
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {inspector.entityKind ? (
                  <EntityName
                    kind={inspector.entityKind}
                    label={inspector.title}
                    variant="heading"
                    size="lg"
                    showKind={false}
                  />
                ) : (
                  <h2 className="break-words font-display text-[clamp(1.25rem,2.2vw,1.8rem)] leading-none text-[var(--ui-ink-strong)]">
                    {inspector.title}
                  </h2>
                )}
              </div>
              <p className="mt-3 break-words text-sm leading-6 text-[var(--ui-ink-soft)]">
                {inspector.summary}
              </p>
              {inspector.chips.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {inspector.chips.map((chip) => (
                    <Badge
                      key={chip}
                      className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                    >
                      {chip}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {inspector.stats.length > 0 ? (
                <div className="mt-4 grid gap-2">
                  {inspector.stats.map((stat) => (
                    <div
                      key={stat}
                      className="min-w-0 rounded-[18px] bg-[var(--ui-surface-1)] px-3 py-3 text-sm text-[var(--ui-ink-medium)] break-words"
                    >
                      {stat}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-5">
                <Link
                  to={inspector.href}
                  className={cn(
                    "inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-medium whitespace-nowrap shadow-[var(--ui-shadow-soft)]",
                    inspector.entityKind
                      ? getEntityButtonClassName(inspector.entityKind, true)
                      : psycheFallbackCtaClassName
                  )}
                >
                  {inspector.ctaLabel}
                </Link>
              </div>
            </Card>
          </section>

          <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <InteractiveCard
              to="/psyche/behaviors"
              className="rounded-[28px] border border-[color-mix(in_srgb,var(--success)_22%,var(--ui-border-subtle)_78%)] bg-[color-mix(in_srgb,var(--ui-success-soft)_44%,var(--ui-surface-1)_56%)] p-5"
            >
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--success)]">
                Best next reflective move
              </div>
              <div className="mt-3 break-words font-display text-[clamp(1.45rem,2.2vw,2rem)] leading-none text-[var(--ui-ink-strong)]">
                {hotPattern?.preferredResponse ||
                  "Map the active loop, then name the committed move that brings you back."}
              </div>
              <p className="mt-3 break-words text-sm leading-6 text-[var(--ui-ink-soft)]">
                {hotPattern?.targetBehavior ||
                  "When the loop is explicit, the return path stops feeling abstract."}
              </p>
            </InteractiveCard>

            <InteractiveCard
              to={
                nextReport
                  ? `/psyche/reports/${nextReport.id}`
                  : "/psyche/reports"
              }
              className="rounded-[28px] border border-[color-mix(in_srgb,var(--primary)_22%,var(--ui-border-subtle)_78%)] bg-[color-mix(in_srgb,var(--ui-accent-soft)_46%,var(--ui-surface-1)_54%)] p-5"
            >
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--primary)]">
                Open threads
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="min-w-0 rounded-[22px] bg-[var(--ui-surface-1)] px-4 py-4">
                  <div className="text-sm text-[var(--ui-ink-soft)]">
                    Insights
                  </div>
                  <div className="mt-2 break-words font-display text-4xl text-[var(--ui-ink-strong)]">
                    {overview.openInsights}
                  </div>
                </div>
                <div className="min-w-0 rounded-[22px] bg-[var(--ui-surface-1)] px-4 py-4">
                  <div className="text-sm text-[var(--ui-ink-soft)]">Notes</div>
                  <div className="mt-2 break-words font-display text-4xl text-[var(--ui-ink-strong)]">
                    {overview.openNotes}
                  </div>
                </div>
              </div>
            </InteractiveCard>
          </section>

          <InteractiveCard
            to={
              latestQuestionnaire?.latestRunId
                ? `/psyche/questionnaire-runs/${latestQuestionnaire.latestRunId}`
                : "/psyche/questionnaires"
            }
            className="rounded-[28px] border border-[color-mix(in_srgb,var(--info)_22%,var(--ui-border-subtle)_78%)] bg-[color-mix(in_srgb,var(--ui-info-soft)_42%,var(--ui-surface-1)_58%)] p-5"
          >
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--info)]">
              Questionnaire pulse
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 break-words font-display text-[clamp(1.4rem,2.2vw,2rem)] leading-none text-[var(--ui-ink-strong)]">
                {latestQuestionnaire?.title ?? "Questionnaire library ready"}
              </div>
              <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                {(questionnairesQuery.data?.instruments ?? []).length} available
              </Badge>
            </div>
          </InteractiveCard>
        </>
      )}

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
