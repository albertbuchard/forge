import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useNavigate } from "react-router-dom";
import { ApplyInsightDialog, type ApplyInsightSubmission } from "@/components/insights/apply-insight-dialog";
import { getInsightSourceLink } from "@/components/insights/insight-apply-helpers";
import { InsightFlowDialog, type InsightEntityCandidate } from "@/components/insights/insight-flow-dialog";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { UserBadge } from "@/components/ui/user-badge";
import { createGoal, createInsight, createNote, createProject, createTask, deleteInsight, getInsights, submitInsightFeedback } from "@/lib/api";
import { getEntityNotesHref } from "@/lib/note-helpers";
import type { Insight, InsightsPayload } from "@/lib/types";
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";

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
  const insightsQuery = useQuery({
    queryKey: ["forge-insights", ...selectedUserIds],
    queryFn: () => getInsights(selectedUserIds)
  });

  const createMutation = useMutation({
    mutationFn: createInsight,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-insights"] });
    }
  });

  const feedbackMutation = useMutation({
    mutationFn: ({ insightId, feedbackType }: { insightId: string; feedbackType: "accepted" | "dismissed" | "applied" | "snoozed" }) =>
      submitInsightFeedback(insightId, feedbackType),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-insights"] });
    }
  });

  const dismissMutation = useMutation({
    mutationFn: ({ insightId }: { insightId: string }) => deleteInsight(insightId),
    onMutate: async ({ insightId }) => {
      await queryClient.cancelQueries({ queryKey: ["forge-insights"] });
      const previous = queryClient.getQueryData<{ insights: InsightsPayload }>(["forge-insights"]);

      if (previous) {
        const removedInsight = previous.insights.feed.find((insight) => insight.id === insightId);
        queryClient.setQueryData<{ insights: InsightsPayload }>(["forge-insights"], {
          insights: {
            ...previous.insights,
            feed: previous.insights.feed.filter((insight) => insight.id !== insightId),
            openCount: removedInsight?.status === "open" ? Math.max(0, previous.insights.openCount - 1) : previous.insights.openCount
          }
        });
      }

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["forge-insights"], context.previous);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-insights"] });
    }
  });

  const applyMutation = useMutation({
    mutationFn: async ({ insight, submission }: { insight: Insight; submission: ApplyInsightSubmission }) => {
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
          throw new Error("This insight is not linked to a concrete entity yet, so Forge cannot attach a linked note to it.");
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
    }
  });

  const insights = insightsQuery.data?.insights;
  const entityCandidates = useMemo<InsightEntityCandidate[]>(
    () => [
      ...snapshot.goals.slice(0, 8).map((goal) => ({
        entityType: "goal" as const,
        entityId: goal.id,
        kind: "goal" as const,
        label: goal.title,
        description: goal.description
      })),
      ...snapshot.projects.slice(0, 8).map((project) => ({
        entityType: "project" as const,
        entityId: project.id,
        kind: "project" as const,
        label: project.title,
        description: project.goalTitle
      })),
      ...snapshot.tasks.slice(0, 10).map((task) => ({
        entityType: "task" as const,
        entityId: task.id,
        kind: "task" as const,
        label: task.title,
        description: task.status.replaceAll("_", " ")
      }))
    ],
    [snapshot.goals, snapshot.projects, snapshot.tasks]
  );
  const feedbackPendingInsightId = feedbackMutation.isPending ? feedbackMutation.variables?.insightId ?? null : null;
  const dismissPendingInsightId = dismissMutation.isPending ? dismissMutation.variables?.insightId ?? null : null;
  const applyPendingInsightId = applyMutation.isPending ? applyMutation.variables?.insight.id ?? null : null;
  const coachingGoal = snapshot.metrics.topGoalId ? snapshot.goals.find((goal) => goal.id === snapshot.metrics.topGoalId) ?? null : null;

  if (insightsQuery.isLoading) {
    return <LoadingState eyebrow="Insights" title="Loading the insight feed" description="Pulling coaching, momentum analysis, and stored recommendations." />;
  }

  if (insightsQuery.isError || !insights) {
    return <ErrorState eyebrow="Insights" error={insightsQuery.error} onRetry={() => void queryClient.invalidateQueries({ queryKey: ["forge-insights"] })} />;
  }

  return (
    <div className="grid gap-5">
      <PageHero
        title="Insights"
        description="Save useful advice from you or your agent, review what seems worth acting on, and turn the good ones into real work when the timing is right."
        badge={`${insights.openCount} open`}
        actions={
          <Button onClick={() => setFlowOpen(true)}>
            Store insight
          </Button>
        }
      />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="grid gap-5">
          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Momentum analysis</div>
            <div className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-10">
              {insights.momentumHeatmap.map((cell) => (
                <div key={cell.id} className="rounded-[16px] bg-white/[0.04] p-3">
                  <div
                    className="h-12 rounded-[12px]"
                    style={{
                      background:
                        cell.intensity >= 4
                          ? "rgba(192,193,255,0.95)"
                          : cell.intensity === 3
                            ? "rgba(192,193,255,0.7)"
                            : cell.intensity === 2
                              ? "rgba(192,193,255,0.45)"
                              : cell.intensity === 1
                                ? "rgba(192,193,255,0.2)"
                                : "rgba(255,255,255,0.05)"
                    }}
                  />
                  <div className="mt-2 text-[10px] uppercase tracking-[0.16em] text-white/40">{cell.label}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              <span>Execution trends</span>
              <InfoTooltip
                content="The lavender series tracks completed XP by time window. The green series tracks execution pressure from focused and completed work. Read them together to see whether visible output and active work are moving in sync."
                label="Explain execution trends"
              />
            </div>
            <div className="mt-4 h-72 min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={288}>
                <AreaChart data={insights.executionTrends}>
                  <defs>
                    <linearGradient id="insight-xp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c0c1ff" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="#c0c1ff" stopOpacity="0.08" />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.42)", fontSize: 11 }} />
                  <YAxis hide />
                  <Area dataKey="xp" stroke="#c0c1ff" fill="url(#insight-xp)" strokeWidth={2} />
                  <Area dataKey="focusScore" stroke="#4edea3" fill="rgba(78,222,163,0.06)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-2 text-sm text-white/64">
                <span className="size-2.5 rounded-full bg-[#c0c1ff]" />
                <span>Completed XP</span>
                <InfoTooltip
                  content="Completed XP is the reward Forge logged for finished work in each time window. It helps you see whether things are actually getting finished, not just started."
                  label="Explain completed XP"
                />
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-2 text-sm text-white/64">
                <span className="size-2.5 rounded-full bg-[#4edea3]" />
                <span>Focus score</span>
                <InfoTooltip
                  content="Focus score is Forge's rough read of how much active execution pressure was present in each window, based on focused and completed work."
                  label="Explain focus score"
                />
              </div>
            </div>
            <div className="mt-3 text-sm leading-6 text-white/54">
              Use this chart to spot whether finished output and active deep-work pressure are rising together or starting to drift apart.
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <Badge className="bg-white/[0.08] text-white/60">Deterministic coaching</Badge>
              <InfoTooltip
                content="This is Forge's built-in coaching read. It looks at your overdue work, blocked work, current goal pressure, and recent evidence to produce one grounded recommendation from the actual operating record."
                label="Explain deterministic coaching"
              />
            </div>
            <h2 className="mt-4 font-display text-4xl text-white">{insights.coaching.title}</h2>
            <p className="mt-4 text-sm leading-7 text-white/60">
              Forge turns the current state of your goals, projects, tasks, and recent evidence into one focused operating read instead of a vague motivational hint.
            </p>
            <div className="mt-4 rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">Current read</div>
              <div className="mt-2 text-sm leading-7 text-white/72">{insights.coaching.summary}</div>
            </div>
            <div className="mt-4 rounded-[22px] bg-[radial-gradient(circle_at_top_left,rgba(192,193,255,0.14),transparent_45%),rgba(255,255,255,0.03)] p-5">
              <div className="font-medium text-white">Recommendation</div>
              <div className="mt-2 text-sm leading-7 text-white/60">{insights.coaching.recommendation}</div>
              {coachingGoal ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="rounded-full bg-white/[0.06] px-3 py-2 text-sm text-white/64">
                    Connected goal: <span className="font-medium text-white">{coachingGoal.title}</span>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => navigate(`/goals/${coachingGoal.id}`)}>
                    Open goal
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="grid gap-5">
          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Store insight</div>
            <div className="mt-4 rounded-[22px] bg-white/[0.04] p-5">
              <div className="font-medium text-white">Capture advice without forcing it into a task too early</div>
              <div className="mt-2 text-sm leading-7 text-white/60">
                Insights are saved suggestions from you or your agent. Use them when something feels worth remembering, but it is not ready to become a goal, project, or task yet.
              </div>
              <div className="mt-4">
                <Button onClick={() => setFlowOpen(true)}>
                  Store insight
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Stored insights</div>
            <div className="mt-4 grid gap-3">
              {insights.feed.length === 0 ? (
                <div className="rounded-[18px] bg-white/[0.04] p-4 text-sm text-white/55">No stored insights yet.</div>
              ) : (
                insights.feed.map((insight) => (
                  <div key={insight.id} className="rounded-[18px] bg-white/[0.04] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-white">{insight.title}</div>
                        <div className="mt-1 text-sm text-white/56">{insight.summary}</div>
                        {insight.user ? (
                          <div className="mt-3">
                            <UserBadge user={insight.user} compact />
                          </div>
                        ) : null}
                      </div>
                      <Badge className="text-white/70">{insight.status}</Badge>
                    </div>
                    <div className="mt-3 text-sm text-white/58">{insight.recommendation}</div>
                    <div className="mt-3 text-xs uppercase tracking-[0.16em] text-white/38">
                      {insight.originLabel ?? insight.originType} · confidence {Math.round(insight.confidence * 100)}%
                    </div>
                    {insight.status === "applied" ? (
                      <div className="mt-4 rounded-[16px] border border-emerald-400/18 bg-emerald-400/8 px-4 py-3 text-sm text-emerald-100/88">
                        This insight has already been turned into a real Forge record, so it stays here as a trace of what happened.
                      </div>
                    ) : (
                      <>
                        <div className="mt-4 text-sm text-white/52">
                          {insight.status === "accepted"
                            ? "Accepted means this feels useful and worth keeping in view. Apply turns it into a real goal, project, task, or note when you are ready."
                            : "Accept keeps this advice on the board. Apply turns it into a real Forge record now. Dismiss deletes it from the list."}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {insight.status !== "accepted" ? (
                            <Button
                              variant="secondary"
                              pending={feedbackPendingInsightId === insight.id}
                              onClick={() => void feedbackMutation.mutateAsync({ insightId: insight.id, feedbackType: "accepted" })}
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
                            onClick={() => void dismissMutation.mutateAsync({ insightId: insight.id })}
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
            await applyMutation.mutateAsync({ insight: applyingInsight, submission });
          }}
        />
      ) : null}
    </div>
  );
}
