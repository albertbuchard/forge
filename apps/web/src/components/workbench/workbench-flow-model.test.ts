import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";

import {
  collectWorkbenchGraphIssues,
  validateWorkbenchConnection,
  type WorkbenchGraphNodeData
} from "@/components/workbench/workbench-flow-model";

function graphNode(input: {
  id: string;
  label: string;
  nodeType?: WorkbenchGraphNodeData["nodeType"];
  inputs?: WorkbenchGraphNodeData["inputs"];
  outputs?: WorkbenchGraphNodeData["outputs"];
}): Node<WorkbenchGraphNodeData> {
  return {
    id: input.id,
    type: "workbench",
    position: { x: 0, y: 0 },
    data: {
      nodeType: input.nodeType ?? "value",
      label: input.label,
      description: "FLOW-03 model fixture",
      enabledToolKeys: [],
      inputs: input.inputs ?? [],
      outputs: input.outputs ?? [
        { key: "value", label: "Value", kind: "record" }
      ],
      outputKey: input.nodeType === "output" ? "value" : undefined
    }
  };
}

const nodes = [
  graphNode({
    id: "source",
    label: "Source",
    outputs: [
      { key: "summary", label: "Summary", kind: "summary" },
      { key: "details", label: "Details", kind: "record" }
    ]
  }),
  graphNode({
    id: "middle",
    label: "Middle",
    inputs: [{ key: "input", label: "Input", kind: "context" }]
  }),
  graphNode({
    id: "output",
    label: "Output",
    nodeType: "output",
    inputs: [{ key: "result", label: "Result", kind: "record" }],
    outputs: []
  })
];

const validEdges: Edge[] = [
  {
    id: "source-middle",
    source: "source",
    target: "middle",
    sourceHandle: "summary",
    targetHandle: "input"
  },
  {
    id: "middle-output",
    source: "middle",
    target: "output",
    sourceHandle: "value",
    targetHandle: "result"
  }
];

describe("FLOW-03 Workbench graph model", () => {
  it("reports cycles and exact port-contract defects without repeated edge scans", () => {
    const cycle = {
      id: "cycle",
      source: "output",
      target: "source"
    } satisfies Edge;
    const issues = collectWorkbenchGraphIssues(nodes, [
      { ...validEdges[0]!, sourceHandle: "missing" },
      validEdges[1]!,
      cycle
    ]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('missing output "missing"'),
        expect.stringContaining("Remove the circular connection")
      ])
    );

    const duplicatePortIssues = collectWorkbenchGraphIssues(
      [
        {
          ...nodes[0]!,
          data: {
            ...nodes[0]!.data,
            outputs: [
              { key: "same", label: "First", kind: "text" },
              { key: "same", label: "Second", kind: "text" }
            ]
          }
        },
        nodes[1]!,
        nodes[2]!
      ],
      validEdges
    );
    expect(duplicatePortIssues).toContain(
      'Give every output on "Source" a unique key.'
    );
  });

  it("blocks ambiguous, duplicate, and cyclic connections before canvas mutation", () => {
    expect(
      validateWorkbenchConnection(nodes, [], {
        source: "source",
        target: "middle",
        sourceHandle: null,
        targetHandle: "input"
      })
    ).toContain("Choose one explicit output");

    expect(
      validateWorkbenchConnection(nodes, validEdges, {
        source: "source",
        target: "middle",
        sourceHandle: "summary",
        targetHandle: "input"
      })
    ).toBe("That exact connection already exists.");

    expect(
      validateWorkbenchConnection(nodes, validEdges, {
        source: "output",
        target: "source"
      })
    ).toContain("would create a cycle");
  });
});
