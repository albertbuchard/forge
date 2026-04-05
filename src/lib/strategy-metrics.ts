import type { StrategyMetrics } from "./types";

export type StrategyMetricCard = {
  id: string;
  label: string;
  value: number;
  detail: string;
};

export function buildStrategyAlignmentBreakdown(
  metrics: StrategyMetrics
): StrategyMetricCard[] {
  return [
    {
      id: "coverage",
      label: "Agreed work moving",
      value: metrics.planCoverageScore,
      detail: `${metrics.startedNodeCount}/${metrics.totalNodeCount} agreed steps have started or finished.`
    },
    {
      id: "order",
      label: "Order respected",
      value: metrics.sequencingScore,
      detail: `${metrics.outOfOrderNodeIds.length} step${metrics.outOfOrderNodeIds.length === 1 ? "" : "s"} started before prerequisites were complete.`
    },
    {
      id: "scope",
      label: "Scope held",
      value: metrics.scopeDisciplineScore,
      detail: `${metrics.offPlanEntityCount} unagreed item${metrics.offPlanEntityCount === 1 ? "" : "s"} are inside the strategy scope, ${metrics.offPlanActiveEntityCount} still active.`
    },
    {
      id: "satisfaction",
      label: "End-state satisfaction",
      value: metrics.qualityScore,
      detail: `${metrics.targetProgressScore}% target progress with ${metrics.blockedNodeIds.length} blocked step${metrics.blockedNodeIds.length === 1 ? "" : "s"}.`
    }
  ];
}
