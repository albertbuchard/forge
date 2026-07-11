import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ApplyInsightDialog,
  type ApplyInsightSubmission
} from "@/components/insights/apply-insight-dialog";
import { getInsightSourceLink } from "@/components/insights/insight-apply-helpers";
import {
  InsightFlowDialog,
  type InsightEntityCandidate
} from "@/components/insights/insight-flow-dialog";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { UserBadge } from "@/components/ui/user-badge";
import {
  createGoal,
  createInsight,
  createNote,
  createProject,
  createTask,
  deleteInsight,
  getInsights,
  submitInsightFeedback
} from "@/lib/api";
import { getEntityNotesHref } from "@/lib/note-helpers";
import type { Insight, InsightsPayload } from "@/lib/types";
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";

const insightEyebrowClass =
  "font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const insightSoftTextClass = "text-sm leading-7 text-[var(--ui-ink-soft)]";
const insightPanelClass =
  "rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]";
const insightPillClass =
  "inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2 text-sm text-[var(--ui-ink-medium)]";

function heatmapBackground(intensity: number) {
  const strength =
    intensity >= 4
      ? 68
      : intensity === 3
        ? 52
        : intensity === 2
          ? 34
          : intensity === 1
            ? 18
            : 0;
  return strength > 0
    ? `color-mix(in srgb, var(--primary) ${strength}%, var(--ui-surface-2))`
    : "var(--ui-surface-3)";
}

function buildTrendPoints(
  data: InsightsPayload["executionTrends"],
  key: "xp" | "focusScore"
) {
  if (data.length === 0) {
    return "";
  }
  const max = Math.max(1, ...data.map((entry) => Number(entry[key]) || 0));
  const step = data.length > 1 ? 320 / (data.length - 1) : 0;
  return data
    .map((entry, index) => {
      const x = 20 + index * step;
      const y = 170 - ((Number(entry[key]) || 0) / max) * 130;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function ExecutionTrendChart({
  data
}: {
  data: InsightsPayload["executionTrends"];
}) {
  const xpPoints = useMemo(() => buildTrendPoints(data, "xp"), [data]);
  const focusPoints = useMemo(
    () => buildTrendPoints(data, "focusScore"),
    [data]
  );
  const labelStep = data.length > 1 ? 320 / (data.length - 1) : 0;
  const labels = data.filter(
    (_entry, index) =>
      index === 0 || index === data.length - 1 || index % 5 === 0
  );

  return (
    <div className="mt-4 aspect-[16/9] min-h-56 w-full min-w-0 overflow-hidden rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
      <svg
        viewBox="0 0 360 200"
        role="img"
        aria-label="Execution trend chart"
        className="h-full w-full"
      >
        <g stroke="var(--ui-border-subtle)" strokeWidth="1">
          {[40, 80, 120, 160].map((y) => (
            <line key={y} x1="20" x2="340" y1={y} y2={y} />
          ))}
        </g>
        {xpPoints ? (
          <polyline
            fill="none"
            points={xpPoints}
            stroke="var(--primary)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          />
        ) : null}
        {focusPoints ? (
          <polyline
            fill="none"
            points={focusPoints}
            stroke="var(--success)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          />
        ) : null}
        {labels.map((entry) => {
          const index = data.indexOf(entry);
          return (
            <text
              key={`${entry.label}-${index}`}
              x={20 + index * labelStep}
              y="194"
              fill="var(--ui-ink-faint)"
              fontSize="10"
              textAnchor={index === 0 ? "start" : "middle"}
            >
              {entry.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export function InsightsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const shell = useForgeShell();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const { snapshot } = shell;
  const [flowOpen, setFlowOpen] = useState(false);
  const [applyingInsight, setApplyingInsight] = useState<Insight | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const insightsQueryKey = ["forge-insights", ...selectedUserIds] as const;
  const insightsQuery = useQuery({
    queryKey: insightsQueryKey,
    queryFn: () => getInsights(selectedUserIds)
  });

  const createMutation = useMutation({
    mutationFn: createInsight,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-insights"] });
    }
  });

  const feedbackMutation = useMutation({
    mutationFn: ({
      insightId,
      feedbackType
    }: {
      insightId: string;
      feedbackType: "accepted" | "dismissed" | "applied" | "snoozed";
    }) => submitInsightFeedback(insightId, feedbackType),
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-insights"] });
    },
    onError: (error) => {
      setActionError(
        error instanceof Error
          ? error.message
          : "Forge could not update that insight."
      );
    }
  });

  const dismissMutation = useMutation({
    mutationFn: ({ insightId }: { insightId: string }) =>
      deleteInsight(insightId),
    onMutate: async ({ insightId }) => {
      setActionError(null);
      await queryClient.cancelQueries({ queryKey: ["forge-insights"] });
      const previous = queryClient.getQueryData<{ insights: InsightsPayload }>(
        insightsQueryKey
      );

      if (previous) {
        const removedInsight = previous.insights.feed.find(
          (insight) => insight.id === insightId
        );
        queryClient.setQueryData<{ insights: InsightsPayload }>(
          insightsQueryKey,
          {
            insights: {
              ...previous.insights,
              feed: previous.insights.feed.filter(
                (insight) => insight.id !== insightId
              ),
              openCount:
                removedInsight?.status === "open"
                  ? Math.max(0, previous.insights.openCount - 1)
                  : previous.insights.openCount
            }
          }
        );
      }

      return { previous };
    },
    onError: (_error, _variables, context) => {
      setActionError(
        _error instanceof Error
          ? _error.message
          : "Forge could not dismiss that insight."
      );
      if (context?.previous) {
        queryClient.setQueryData(insightsQueryKey, context.previous);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-insights"] });
    }
  });

  const applyMutation = useMutation({
    mutationFn: async ({
      insight,
      submission
    }: {
      insight: Insight;
      submission: ApplyInsightSubmission;
    }) => {
      let href: string | null = null;
      let feedbackNote = "Applied the insight.";

      if (submission.kind === "task") {
        const response = await createTask(submission.input);
        href = `/tasks/${response.task.id}`;
        feedbackNote = `Created task: ${response.task.title}`;
      } else if (submission.kind === "project") {
        const response = await createProject(submission.input);
        href = `/projects/${response.project.id}`;
        feedbackNote = `Created project: ${response.project.title}`;
      } else if (submission.kind === "goal") {
        const response = await createGoal(submission.input);
        href = `/goals/${response.goal.id}`;
        feedbackNote = `Created goal: ${response.goal.title}`;
      } else {
        const sourceLink = getInsightSourceLink(insight);
        if (!sourceLink) {
          throw new Error(
            "This insight is not linked to a concrete entity yet, so Forge cannot attach a linked note to it."
          );
        }
        await createNote({
          contentMarkdown: submission.input.contentMarkdown,
          links: [sourceLink]
        });
        href = getEntityNotesHref(sourceLink.entityType, sourceLink.entityId);
        feedbackNote = "Created a linked note from the insight.";
      }

      await submitInsightFeedback(insight.id, "applied", feedbackNote);
      return { href };
    },
    onMutate: () => setActionError(null),
    onSuccess: async ({ href }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-insights"] }),
        invalidateForgeSnapshot(queryClient),
        queryClient.invalidateQueries({ queryKey: ["forge-xp-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-reward-ledger"] }),
        queryClient.invalidateQueries({ queryKey: ["notes-index"] })
      ]);
      setApplyingInsight(null);
      if (href) {
        navigate(href);
      }
    },
    onError: (error) => {
      setActionError(
        error instanceof Error
          ? error.message
          : "Forge could not apply that insight."
      );
    }
  });

  const insights = insightsQuery.data?.insights;
  const entityCandidates = useMemo<InsightEntityCandidate[]>(
    () => [
      ...snapshot.goals.map((goal) => ({
        entityType: "goal" as const,
        entityId: goal.id,
        kind: "goal" as const,
        label: goal.title,
        description: goal.description
      })),
      ...snapshot.projects.map((project) => ({
        entityType: "project" as const,
        entityId: project.id,
        kind: "project" as const,
        label: project.title,
        description: project.goalTitle
      })),
      ...snapshot.tasks.map((task) => ({
        entityType: "task" as const,
        entityId: task.id,
        kind: "task" as const,
        label: task.title,
        description: task.status.replaceAll("_", " ")
      }))
    ],
    [snapshot.goals, snapshot.projects, snapshot.tasks]
  );
  const feedbackPendingInsightId = feedbackMutation.isPending
    ? (feedbackMutation.variables?.insightId ?? null)
    : null;
  const dismissPendingInsightId = dismissMutation.isPending
    ? (dismissMutation.variables?.insightId ?? null)
    : null;
  const applyPendingInsightId = applyMutation.isPending
    ? (applyMutation.variables?.insight.id ?? null)
    : null;
  const coachingGoal = snapshot.metrics.topGoalId
    ? (snapshot.goals.find((goal) => goal.id === snapshot.metrics.topGoalId) ??
      null)
    : null;

  if (insightsQuery.isLoading) {
    return (
      <LoadingState
        eyebrow="Insights"
        title="Loading the insight feed"
        description="Pulling coaching, momentum analysis, and stored recommendations."
      />
    );
  }

  if (insightsQuery.isError || !insights) {
    return (
      <ErrorState
        eyebrow="Insights"
        error={insightsQuery.error}
        onRetry={() =>
          void queryClient.invalidateQueries({ queryKey: ["forge-insights"] })
        }
      />
    );
  }

  return (
    <div className="grid gap-5">
      <PageHero
        title="Insights"
        description="Save useful advice from you or your agent, review what seems worth acting on, and turn the good ones into real work when the timing is right."
        badge={`${insights.openCount} open`}
        actions={
          <Button onClick={() => setFlowOpen(true)}>Store insight</Button>
        }
      />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="grid gap-5">
          <Card>
            <div className={insightEyebrowClass}>Momentum analysis</div>
            <div className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-10">
              {insights.momentumHeatmap.map((cell) => (
                <div
                  key={cell.id}
                  className={`${insightPanelClass} min-w-0 p-3`}
                >
                  <div
                    className="h-12 rounded-[12px]"
                    style={{ background: heatmapBackground(cell.intensity) }}
                  />
                  <div className="mt-2 truncate text-[10px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                    {cell.label}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className={`flex items-center gap-2 ${insightEyebrowClass}`}>
              <span>Execution trends</span>
              <InfoTooltip
                content="The lavender series tracks completed XP by time window. The green series tracks execution pressure from focused and completed work. Read them together to see whether visible output and active work are moving in sync."
                label="Explain execution trends"
              />
            </div>
            <ExecutionTrendChart data={insights.executionTrends} />
            <div className="mt-4 flex flex-wrap gap-3">
              <div className={insightPillClass}>
                <span className="size-2.5 rounded-full bg-[var(--primary)]" />
                <span>Completed XP</span>
                <InfoTooltip
                  content="Completed XP is the reward Forge logged for finished work in each time window. It helps you see whether things are actually getting finished, not just started."
                  label="Explain completed XP"
                />
              </div>
              <div className={insightPillClass}>
                <span className="size-2.5 rounded-full bg-[var(--success)]" />
                <span>Focus score</span>
                <InfoTooltip
                  content="Focus score is Forge's rough read of how much active execution pressure was present in each window, based on focused and completed work."
                  label="Explain focus score"
                />
              </div>
            </div>
            <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
              Use this chart to spot whether finished output and active
              deep-work pressure are rising together or starting to drift apart.
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <Badge tone="meta">Deterministic coaching</Badge>
              <InfoTooltip
                content="This is Forge's built-in coaching read. It looks at your overdue work, blocked work, current goal pressure, and recent evidence to produce one grounded recommendation from the actual operating record."
                label="Explain deterministic coaching"
              />
            </div>
            <h2 className="mt-4 break-words font-display text-4xl text-[var(--ui-ink-strong)]">
              {insights.coaching.title}
            </h2>
            <p className={`mt-4 ${insightSoftTextClass}`}>
              Forge turns the current state of your goals, projects, tasks, and
              recent evidence into one focused operating read instead of a vague
              motivational hint.
            </p>
            <div className={`mt-4 ${insightPanelClass} px-4 py-4`}>
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Current read
              </div>
              <div className="mt-2 text-sm leading-7 text-[var(--ui-ink-medium)]">
                {insights.coaching.summary}
              </div>
            </div>
            <div className="mt-4 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-accent-soft)] p-5">
              <div className="font-medium text-[var(--ui-ink-strong)]">
                Recommendation
              </div>
              <div className={`mt-2 ${insightSoftTextClass}`}>
                {insights.coaching.recommendation}
              </div>
              {coachingGoal ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className={insightPillClass}>
                    Connected goal:{" "}
                    <span className="min-w-0 break-words font-medium text-[var(--ui-ink-strong)]">
                      {coachingGoal.title}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(`/goals/${coachingGoal.id}`)}
                  >
                    Open goal
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="grid gap-5">
          <Card>
            <div className={insightEyebrowClass}>Store insight</div>
            <div className={`mt-4 ${insightPanelClass} p-5`}>
              <div className="font-medium text-[var(--ui-ink-strong)]">
                Capture advice without forcing it into a task too early
              </div>
              <div className={`mt-2 ${insightSoftTextClass}`}>
                Insights are saved suggestions from you or your agent. Use them
                when something feels worth remembering, but it is not ready to
                become a goal, project, or task yet.
              </div>
              <div className="mt-4">
                <Button onClick={() => setFlowOpen(true)}>Store insight</Button>
              </div>
            </div>
          </Card>

          <Card>
            <div className={insightEyebrowClass}>Stored insights</div>
            {actionError ? (
              <div
                role="alert"
                className="mt-4 rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
              >
                {actionError}
              </div>
            ) : null}
            <div className="mt-4 grid gap-3">
              {insights.feed.length === 0 ? (
                <div
                  className={`${insightPanelClass} p-4 text-sm text-[var(--ui-ink-soft)]`}
                >
                  No stored insights yet.
                </div>
              ) : (
                insights.feed.map((insight) => (
                  <div
                    key={insight.id}
                    className={`${insightPanelClass} min-w-0 p-4`}
                  >
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="break-words font-medium text-[var(--ui-ink-strong)]">
                          {insight.title}
                        </div>
                        <div className="mt-1 break-words text-sm text-[var(--ui-ink-soft)]">
                          {insight.summary}
                        </div>
                        {insight.user ? (
                          <div className="mt-3">
                            <UserBadge user={insight.user} compact />
                          </div>
                        ) : null}
                      </div>
                      <Badge tone="meta">{insight.status}</Badge>
                    </div>
                    <div className="mt-3 break-words text-sm text-[var(--ui-ink-soft)]">
                      {insight.recommendation}
                    </div>
                    <div className="mt-3 break-words text-xs uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      {insight.originLabel ?? insight.originType} · confidence{" "}
                      {Math.round(insight.confidence * 100)}%
                    </div>
                    {insight.status === "applied" ? (
                      <div className="mt-4 rounded-[16px] border border-[var(--ui-success-border)] bg-[var(--ui-success-soft)] px-4 py-3 text-sm text-[color-mix(in_srgb,var(--success)_72%,var(--ui-ink-strong)_28%)]">
                        This insight has already been turned into a real Forge
                        record, so it stays here as a trace of what happened.
                      </div>
                    ) : (
                      <>
                        <div className="mt-4 text-sm text-[var(--ui-ink-soft)]">
                          {insight.status === "accepted"
                            ? "Accepted means this feels useful and worth keeping in view. Apply turns it into a real goal, project, task, or note when you are ready."
                            : "Accept keeps this advice on the board. Apply turns it into a real Forge record now. Dismiss deletes it from the list."}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {insight.status !== "accepted" ? (
                            <Button
                              variant="secondary"
                              pending={feedbackPendingInsightId === insight.id}
                              onClick={() =>
                                feedbackMutation.mutate({
                                  insightId: insight.id,
                                  feedbackType: "accepted"
                                })
                              }
                            >
                              Accept
                            </Button>
                          ) : null}
                          <Button
                            pending={applyPendingInsightId === insight.id}
                            onClick={() => setApplyingInsight(insight)}
                          >
                            Apply
                          </Button>
                          <Button
                            variant="ghost"
                            pending={dismissPendingInsightId === insight.id}
                            onClick={() =>
                              dismissMutation.mutate({
                                insightId: insight.id
                              })
                            }
                          >
                            Dismiss
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </section>

      <InsightFlowDialog
        open={flowOpen}
        onOpenChange={setFlowOpen}
        entityCandidates={entityCandidates}
        existingInsights={insights.feed}
        pending={createMutation.isPending}
        onSubmit={async (value) => {
          await createMutation.mutateAsync(value);
        }}
      />
      {applyingInsight ? (
        <ApplyInsightDialog
          open={Boolean(applyingInsight)}
          onOpenChange={(open) => {
            if (!open) {
              setApplyingInsight(null);
            }
          }}
          insight={applyingInsight}
          goals={snapshot.goals}
          projects={snapshot.projects}
          tasks={snapshot.tasks}
          tags={snapshot.tags}
          pending={applyMutation.isPending}
          onSubmit={async (submission) => {
            await applyMutation.mutateAsync({
              insight: applyingInsight,
              submission
            });
          }}
        />
      ) : null}
    </div>
  );
}
