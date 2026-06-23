import { describe, expect, it } from "vitest";
import {
  buildStrategyLevels,
  buildStrategyPhases
} from "@/lib/strategy-hierarchy";

describe("strategy hierarchy helpers", () => {
  const graph = {
    nodes: [
      {
        id: "root",
        entityType: "project" as const,
        entityId: "project_root",
        title: "Root",
        branchLabel: "",
        notes: ""
      },
      {
        id: "parallel-a",
        entityType: "task" as const,
        entityId: "task_parallel_a",
        title: "Parallel A",
        branchLabel: "",
        notes: ""
      },
      {
        id: "parallel-b",
        entityType: "task" as const,
        entityId: "task_parallel_b",
        title: "Parallel B",
        branchLabel: "",
        notes: ""
      },
      {
        id: "merge",
        entityType: "project" as const,
        entityId: "project_merge",
        title: "Merge",
        branchLabel: "",
        notes: ""
      }
    ],
    edges: [
      {
        from: "root",
        to: "parallel-a",
        label: "",
        condition: ""
      },
      {
        from: "root",
        to: "parallel-b",
        label: "",
        condition: ""
      },
      {
        from: "parallel-a",
        to: "merge",
        label: "",
        condition: ""
      },
      {
        from: "parallel-b",
        to: "merge",
        label: "",
        condition: ""
      }
    ]
  };

  it("builds stable levels from predecessor depth", () => {
    const levels = buildStrategyLevels(graph);

    expect(levels.get("root")).toBe(0);
    expect(levels.get("parallel-a")).toBe(1);
    expect(levels.get("parallel-b")).toBe(1);
    expect(levels.get("merge")).toBe(2);
  });

  it("groups nodes into sequential phases with parallel siblings", () => {
    expect(buildStrategyPhases(graph)).toEqual([
      {
        level: 0,
        nodeIds: ["root"]
      },
      {
        level: 1,
        nodeIds: ["parallel-a", "parallel-b"]
      },
      {
        level: 2,
        nodeIds: ["merge"]
      }
    ]);
  });
});
