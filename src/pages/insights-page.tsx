import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { InsightFlowDialog, type InsightEntityCandidate } from "@/components/insights/insight-flow-dialog";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { createInsight, getInsights, submitInsightFeedback } from "@/lib/api";

export function InsightsPage() {
  const queryClient = useQueryClient();
  const { snapshot } = useForgeShell();
  const [flowOpen, setFlowOpen] = useState(false);
  const insightsQuery = useQuery({
    queryKey: ["forge-insights"],
    queryFn: getInsights
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
        description="Track the live coaching signal, store insights through a guided flow, and decide which recommendations should actually change the system."
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
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Execution trends</div>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
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
          </Card>

          <Card>
            <Badge className="bg-white/[0.08] text-white/60">Deterministic coaching</Badge>
            <h2 className="mt-4 font-display text-4xl text-white">{insights.coaching.title}</h2>
            <p className="mt-4 text-sm leading-7 text-white/60">{insights.coaching.summary}</p>
            <div className="mt-4 rounded-[22px] bg-[radial-gradient(circle_at_top_left,rgba(192,193,255,0.14),transparent_45%),rgba(255,255,255,0.03)] p-5">
              <div className="font-medium text-white">Recommendation</div>
              <div className="mt-2 text-sm leading-7 text-white/60">{insights.coaching.recommendation}</div>
            </div>
          </Card>
        </div>

        <div className="grid gap-5">
          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Store insight</div>
            <div className="mt-4 rounded-[22px] bg-white/[0.04] p-5">
              <div className="font-medium text-white">Use the guided flow instead of a raw admin form</div>
              <div className="mt-2 text-sm leading-7 text-white/60">
                Capture the insight headline, what you are seeing, the recommendation, and where it belongs in one focused sequence.
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
                      </div>
                      <Badge className="text-white/70">{insight.status}</Badge>
                    </div>
                    <div className="mt-3 text-sm text-white/58">{insight.recommendation}</div>
                    <div className="mt-3 text-xs uppercase tracking-[0.16em] text-white/38">
                      {insight.originLabel ?? insight.originType} · confidence {Math.round(insight.confidence * 100)}%
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => void feedbackMutation.mutateAsync({ insightId: insight.id, feedbackType: "accepted" })}>
                        Accept
                      </Button>
                      <Button variant="secondary" onClick={() => void feedbackMutation.mutateAsync({ insightId: insight.id, feedbackType: "applied" })}>
                        Apply
                      </Button>
                      <Button variant="ghost" onClick={() => void feedbackMutation.mutateAsync({ insightId: insight.id, feedbackType: "dismissed" })}>
                        Dismiss
                      </Button>
                    </div>
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
    </div>
  );
}
