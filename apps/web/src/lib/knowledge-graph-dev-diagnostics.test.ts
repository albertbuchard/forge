import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGraphBoundsCenter,
  buildKnowledgeGraphCentroid,
  buildKnowledgeGraphDriftMetrics,
  KNOWLEDGE_GRAPH_PERIODIC_SNAPSHOT_INTERVAL_MS,
  evaluateKnowledgeGraphStartupInvariant,
  recenterKnowledgeGraphPointsAroundOrigin
} from "@/lib/knowledge-graph-dev-diagnostics";

describe("knowledge graph dev diagnostics helpers", () => {
  it("computes centroid and bounds-center independently", () => {
    const positions = [
      { x: -4, y: 2 },
      { x: 8, y: -2 },
      { x: 2, y: 6 }
    ];

    expect(buildKnowledgeGraphCentroid(positions)).toEqual({
      x: 2,
      y: 2
    });
    expect(buildKnowledgeGraphBoundsCenter(positions)).toEqual({
      x: 2,
      y: 2
    });
  });

  it("detects startup invariant failures when the camera and centroid drift from origin", () => {
    const driftMetrics = buildKnowledgeGraphDriftMetrics({
      centroid: { x: 0.9, y: 0 },
      boundsCenter: { x: 0.8, y: 0.1 },
      camera: { x: 1.1, y: 0, ratio: 1, angle: 0 }
    });

    expect(driftMetrics.centroidDistanceFromOrigin).toBeGreaterThan(0.45);
    expect(driftMetrics.cameraDistanceFromOrigin).toBeGreaterThan(0.45);
    expect(evaluateKnowledgeGraphStartupInvariant(driftMetrics)).toBe(false);
  });

  it("accepts startup invariants when camera and graph stay near origin", () => {
    const driftMetrics = buildKnowledgeGraphDriftMetrics({
      centroid: { x: 0.12, y: -0.16 },
      boundsCenter: { x: 0.08, y: -0.12 },
      camera: { x: 0.05, y: -0.03, ratio: 1, angle: 0 }
    });

    expect(evaluateKnowledgeGraphStartupInvariant(driftMetrics)).toBe(true);
  });

  it("uses a 5-second periodic diagnostics snapshot interval", () => {
    expect(KNOWLEDGE_GRAPH_PERIODIC_SNAPSHOT_INTERVAL_MS).toBe(5_000);
  });

  it("recenters point sets back around graph-space origin", () => {
    const recentered = recenterKnowledgeGraphPointsAroundOrigin([
      { x: 4, y: 3 },
      { x: 8, y: 5 },
      { x: 10, y: 7 }
    ]);

    expect(recentered.changed).toBe(true);
    expect(recentered.offset).toEqual({ x: 7.3333, y: 5 });
    expect(buildKnowledgeGraphCentroid(recentered.positions)).toEqual({
      x: 0,
      y: 0
    });
  });
});
