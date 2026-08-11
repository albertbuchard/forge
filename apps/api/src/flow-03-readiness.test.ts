import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { MAX_AI_CONNECTOR_GRAPH_NODES } from "./repositories/ai-connectors.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import type { AiConnectorNode } from "./types.js";

function valueNode(index: number): AiConnectorNode {
  return {
    id: `node_value_${index}`,
    type: "value",
    position: { x: index * 10, y: 100 },
    data: {
      label: `Value ${index}`,
      description: "Bounded graph validation fixture.",
      enabledToolKeys: [],
      valueType: "string",
      valueLiteral: String(index)
    }
  };
}

function buildLinearGraph(nodeCount: number) {
  const values = Array.from({ length: nodeCount - 1 }, (_, index) =>
    valueNode(index)
  );
  const output: AiConnectorNode = {
    id: "node_output",
    type: "output",
    position: { x: nodeCount * 10, y: 100 },
    data: {
      label: "Output",
      description: "Publishes the terminal value.",
      outputKey: "value",
      enabledToolKeys: []
    }
  };
  return {
    nodes: [...values, output],
    edges: Array.from({ length: nodeCount - 1 }, (_, index) => ({
      id: `edge_${index}`,
      source: `node_value_${index}`,
      target:
        index === nodeCount - 2 ? "node_output" : `node_value_${index + 1}`,
      sourceHandle: "value",
      targetHandle: index === nodeCount - 2 ? "result" : null,
      label: null
    }))
  };
}

test("FLOW-03 enforces bounded acyclic graph and exact port contracts without creating rejected revisions", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-flow-03-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const headers = { cookie: issueTestOperatorSessionCookie(app) };
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/workbench/flows",
      headers,
      payload: {
        title: "Bounded graph contract",
        description: "FLOW-03 readiness fixture",
        kind: "functor"
      }
    });
    assert.equal(createdResponse.statusCode, 201, createdResponse.body);
    const flowId = createdResponse.json().flow.id as string;

    const acceptedGraph = buildLinearGraph(MAX_AI_CONNECTOR_GRAPH_NODES);
    const acceptedResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/workbench/flows/${flowId}`,
      headers,
      payload: { expectedRevision: 1, graph: acceptedGraph }
    });
    assert.equal(acceptedResponse.statusCode, 200, acceptedResponse.body);
    assert.equal(acceptedResponse.json().flow.revision, 2);
    assert.equal(
      acceptedResponse.json().flow.graph.nodes.length,
      MAX_AI_CONNECTOR_GRAPH_NODES
    );

    const rejectedGraphs = [
      {
        label: "oversized",
        graph: buildLinearGraph(MAX_AI_CONNECTOR_GRAPH_NODES + 1),
        message: `at most ${MAX_AI_CONNECTOR_GRAPH_NODES} nodes`
      },
      {
        label: "missing output handle",
        graph: {
          ...acceptedGraph,
          edges: acceptedGraph.edges.map((edge, index) =>
            index === 0 ? { ...edge, sourceHandle: "invented" } : edge
          )
        },
        message: "references missing output"
      },
      {
        label: "ambiguous output handle",
        graph: {
          ...acceptedGraph,
          nodes: acceptedGraph.nodes.map((node, index) =>
            index === 0
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    outputs: [
                      { key: "left", label: "Left", kind: "text" as const },
                      { key: "right", label: "Right", kind: "text" as const }
                    ]
                  }
                }
              : node
          ),
          edges: acceptedGraph.edges.map((edge, index) =>
            index === 0 ? { ...edge, sourceHandle: null } : edge
          )
        },
        message: "must name one output"
      },
      {
        label: "duplicate output keys",
        graph: {
          ...acceptedGraph,
          nodes: acceptedGraph.nodes.map((node, index) =>
            index === 0
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    outputs: [
                      { key: "value", label: "First", kind: "text" as const },
                      { key: "value", label: "Second", kind: "text" as const }
                    ]
                  }
                }
              : node
          )
        },
        message: "output keys must be unique"
      },
      {
        label: "cyclic",
        graph: {
          ...acceptedGraph,
          edges: [
            ...acceptedGraph.edges,
            {
              id: "edge_cycle",
              source: "node_output",
              target: "node_value_0",
              sourceHandle: "value",
              targetHandle: null,
              label: null
            }
          ]
        },
        message: "cannot contain cycles"
      },
      {
        label: "duplicate identifiers",
        graph: {
          ...acceptedGraph,
          nodes: [acceptedGraph.nodes[0]!, acceptedGraph.nodes[0]!]
        },
        message: "node ids must be unique"
      }
    ];

    for (const fixture of rejectedGraphs) {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/workbench/flows/${flowId}`,
        headers,
        payload: { expectedRevision: 2, graph: fixture.graph }
      });
      assert.equal(
        response.statusCode,
        400,
        `${fixture.label}: ${response.body}`
      );
      assert.equal(response.json().code, "workbench_graph_invalid");
      assert.match(response.json().error, new RegExp(fixture.message, "i"));
    }

    const ambiguousCreate = await app.inject({
      method: "POST",
      url: "/api/v1/workbench/flows",
      headers,
      payload: {
        title: "Rejected ambiguous create",
        graph: rejectedGraphs[2]!.graph
      }
    });
    assert.equal(ambiguousCreate.statusCode, 400, ambiguousCreate.body);
    assert.equal(ambiguousCreate.json().code, "workbench_graph_invalid");

    const stored = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${flowId}`,
      headers
    });
    assert.equal(stored.statusCode, 200, stored.body);
    assert.equal(stored.json().flow.revision, 2);
    assert.equal(
      stored.json().flow.graph.nodes.length,
      MAX_AI_CONNECTOR_GRAPH_NODES
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM ai_connector_versions
             WHERE connector_id = ?`
          )
          .get(flowId) as { count: number }
      ).count,
      2
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
