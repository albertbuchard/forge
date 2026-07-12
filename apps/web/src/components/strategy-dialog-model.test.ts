import { describe, expect, it } from "vitest";

import {
  buildDraftGraph,
  createDraftNode,
  hasGraphCycle,
  resolveDraftPredecessors,
  strategyToDraft
} from "@/components/strategy-dialog-model";
import type { ProjectSummary, Strategy, Task } from "@/lib/types";

function node(id: string, predecessorIds: string[] = []) {
  return createDraftNode("task", {
    id,
    entityId: `task_${id}`,
    dependencyMode: predecessorIds.length === 0 ? "start" : "custom",
    customPredecessorIds: predecessorIds
  });
}

describe("strategy dialog graph model", () => {
  it("preserves a custom dependency when its prerequisite is later in display order", () => {
    const nodes = [node("dependent", ["prerequisite"]), node("prerequisite")];

    expect(resolveDraftPredecessors(nodes).get("dependent")).toEqual([
      "prerequisite"
    ]);
  });

  it("detects custom dependency cycles", () => {
    expect(hasGraphCycle([node("a", ["b"]), node("b", ["a"])])).toBe(true);
  });

  it("validates a large linear graph without recursive traversal", () => {
    const nodes = Array.from({ length: 5_000 }, (_, index) =>
      node(`node_${index}`, index === 0 ? [] : [`node_${index - 1}`])
    );

    expect(hasGraphCycle(nodes)).toBe(false);
  });

  it("round-trips persisted graph edges through the editor draft", () => {
    const strategy = {
      title: "Persisted graph",
      overview: "",
      endStateDescription: "",
      status: "active",
      userId: null,
      targetGoalIds: [],
      targetProjectIds: [],
      linkedEntities: [],
      graph: {
        nodes: [
          {
            id: "a",
            entityType: "task",
            entityId: "task_a",
            title: "A",
            branchLabel: "",
            notes: ""
          },
          {
            id: "b",
            entityType: "task",
            entityId: "task_b",
            title: "B",
            branchLabel: "",
            notes: ""
          },
          {
            id: "c",
            entityType: "task",
            entityId: "task_c",
            title: "C",
            branchLabel: "",
            notes: ""
          }
        ],
        edges: [
          { from: "a", to: "c", label: "", condition: "" },
          { from: "b", to: "c", label: "", condition: "" }
        ]
      }
    } as unknown as Strategy;
    const tasksById = new Map(
      strategy.graph.nodes.map((graphNode) => [
        graphNode.entityId,
        { id: graphNode.entityId, title: graphNode.title } as Task
      ])
    );

    const rebuilt = buildDraftGraph(
      strategyToDraft(strategy),
      new Map<string, ProjectSummary>(),
      tasksById
    );

    expect(rebuilt.edges).toEqual(strategy.graph.edges);
  });
});
