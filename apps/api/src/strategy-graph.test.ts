import assert from "node:assert/strict";
import test from "node:test";

import { strategyGraphSchema } from "./types.js";

function graphNode(id: string) {
  return {
    id,
    entityType: "task" as const,
    entityId: `task_${id}`,
    title: id,
    branchLabel: "",
    notes: ""
  };
}

test("strategy graph schema rejects cycles even when another start node exists", () => {
  const result = strategyGraphSchema.safeParse({
    nodes: [graphNode("start"), graphNode("a"), graphNode("b")],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "a" }
    ]
  });

  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error?.issues), /directed and acyclic/i);
});

test("strategy graph schema rejects duplicate directed edges", () => {
  const result = strategyGraphSchema.safeParse({
    nodes: [graphNode("a"), graphNode("b")],
    edges: [
      { from: "a", to: "b" },
      { from: "a", to: "b" }
    ]
  });

  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error?.issues), /duplicated/i);
});

test("strategy graph schema validates a large linear DAG iteratively", () => {
  const nodes = Array.from({ length: 5_000 }, (_, index) =>
    graphNode(`node_${index}`)
  );
  const edges = nodes.slice(1).map((node, index) => ({
    from: nodes[index]!.id,
    to: node.id
  }));

  assert.equal(strategyGraphSchema.safeParse({ nodes, edges }).success, true);
});
