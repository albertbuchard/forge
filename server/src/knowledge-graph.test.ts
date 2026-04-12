import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

test("knowledge graph route applies filters before limiting and returns matching facets", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-knowledge-graph-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-graph?entityKind=goal&limit=40"
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json() as {
      graph: {
        nodes: Array<{ entityKind: string }>;
        counts: { limited: boolean; filteredNodeCount: number; nodeCount: number };
        facets: { entityKinds: Array<{ value: string; count: number }> };
      };
    };

    assert.ok(payload.graph.nodes.length > 0);
    assert.ok(payload.graph.nodes.every((node) => node.entityKind === "goal"));
    assert.equal(payload.graph.counts.limited, false);
    assert.equal(payload.graph.counts.filteredNodeCount, payload.graph.counts.nodeCount);
    assert.deepEqual(payload.graph.facets.entityKinds, [
      { value: "goal", label: "Goal", count: payload.graph.counts.nodeCount }
    ]);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("knowledge graph route keeps deterministic visible-node ordering across repeated requests", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-knowledge-graph-stability-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const firstResponse = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-graph?limit=8&focusNodeId=goal%3Agoal_build_forge"
    });
    const secondResponse = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-graph?limit=8&focusNodeId=goal%3Agoal_build_forge"
    });

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 200);

    const firstPayload = firstResponse.json() as {
      graph: {
        nodes: Array<{ id: string }>;
        counts: { limited: boolean; nodeCount: number };
      };
    };
    const secondPayload = secondResponse.json() as {
      graph: {
        nodes: Array<{ id: string }>;
        counts: { limited: boolean; nodeCount: number };
      };
    };

    assert.equal(firstPayload.graph.counts.limited, true);
    assert.equal(secondPayload.graph.counts.limited, true);
    assert.equal(firstPayload.graph.counts.nodeCount, firstPayload.graph.nodes.length);
    assert.equal(
      secondPayload.graph.counts.nodeCount,
      secondPayload.graph.nodes.length
    );
    assert.ok(firstPayload.graph.counts.nodeCount > 0);
    assert.ok(firstPayload.graph.counts.nodeCount <= 8);
    assert.equal(
      secondPayload.graph.counts.nodeCount,
      firstPayload.graph.counts.nodeCount
    );
    assert.deepEqual(
      secondPayload.graph.nodes.map((node) => node.id),
      firstPayload.graph.nodes.map((node) => node.id)
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
