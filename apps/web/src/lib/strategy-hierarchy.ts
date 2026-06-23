import type { Strategy } from "@/lib/types";

export type StrategyPhase = {
  level: number;
  nodeIds: string[];
};

export function buildStrategyLevels(
  graph: Pick<Strategy, "graph">["graph"]
): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) {
    incoming.set(node.id, []);
  }
  for (const edge of graph.edges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }

  const levelById = new Map<string, number>();
  const visit = (nodeId: string): number => {
    const existing = levelById.get(nodeId);
    if (existing !== undefined) {
      return existing;
    }
    const predecessors = incoming.get(nodeId) ?? [];
    const level =
      predecessors.length === 0
        ? 0
        : Math.max(
            ...predecessors.map((predecessorId) => visit(predecessorId))
          ) + 1;
    levelById.set(nodeId, level);
    return level;
  };

  for (const node of graph.nodes) {
    visit(node.id);
  }

  return levelById;
}

export function buildStrategyPhases(
  graph: Pick<Strategy, "graph">["graph"]
): StrategyPhase[] {
  const levelById = buildStrategyLevels(graph);
  const phases = new Map<number, string[]>();

  for (const node of graph.nodes) {
    const level = levelById.get(node.id) ?? 0;
    phases.set(level, [...(phases.get(level) ?? []), node.id]);
  }

  return Array.from(phases.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([level, nodeIds]) => ({
      level,
      nodeIds
    }));
}
