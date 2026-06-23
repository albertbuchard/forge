import type { Strategy } from "./types";

type StrategyContractShape = Pick<
  Strategy,
  | "title"
  | "overview"
  | "endStateDescription"
  | "targetGoalIds"
  | "targetProjectIds"
  | "graph"
>;

export type StrategyContractCheck = {
  id: string;
  label: string;
  satisfied: boolean;
};

export function buildStrategyContractChecks(
  strategy: StrategyContractShape
): StrategyContractCheck[] {
  return [
    {
      id: "title",
      label: "Strategy title is set",
      satisfied: strategy.title.trim().length > 0
    },
    {
      id: "graph",
      label: "Graph contains at least one linked project or task",
      satisfied: strategy.graph.nodes.length > 0
    },
    {
      id: "targets",
      label: "At least one target goal or project is selected",
      satisfied:
        strategy.targetGoalIds.length > 0 ||
        strategy.targetProjectIds.length > 0
    },
    {
      id: "narrative",
      label: "The plan already names an overview or end state",
      satisfied:
        strategy.overview.trim().length > 0 ||
        strategy.endStateDescription.trim().length > 0
    }
  ];
}

export function isStrategyContractReady(strategy: StrategyContractShape) {
  return buildStrategyContractChecks(strategy).every(
    (check) => check.satisfied
  );
}
