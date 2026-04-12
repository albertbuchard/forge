import { describe, expect, it } from "vitest";
import {
  knowledgeGraphDiagnosticsReducer,
  recordKnowledgeGraphDiagnosticsEvent,
  recordKnowledgeGraphDiagnosticsSnapshot,
  resetKnowledgeGraphDiagnostics,
  setKnowledgeGraphDiagnosticsPanelOpen,
  setKnowledgeGraphDiagnosticsStatus
} from "@/store/slices/knowledge-graph-diagnostics-slice";

describe("knowledge graph diagnostics slice", () => {
  it("stores the latest status, events, snapshots, and panel visibility", () => {
    const withPanel = knowledgeGraphDiagnosticsReducer(
      undefined,
      setKnowledgeGraphDiagnosticsPanelOpen(true)
    );

    const withStatus = knowledgeGraphDiagnosticsReducer(
      withPanel,
      setKnowledgeGraphDiagnosticsStatus({
        datasetSignature: "graph-a",
        route: "/knowledge-graph",
        rendererMode: "sigma",
        startupPhase: "startup_verified",
        startupInvariantSatisfied: true,
        visibleNodeCount: 12,
        focusedNodeId: null,
        primaryFocusedNodeId: null,
        graphCentroid: { x: 0, y: 0 },
        boundsCenter: { x: 0, y: 0 },
        camera: { x: 0, y: 0, ratio: 1, angle: 0 },
        cameraTarget: null,
        driftMetrics: {
          centroidDistanceFromOrigin: 0,
          boundsCenterDistanceFromOrigin: 0,
          cameraDistanceFromOrigin: 0,
          cameraToCentroidDistance: 0
        },
        latestSnapshotAt: null,
        lastVerifiedAt: "2026-04-12T14:00:00.000Z"
      })
    );

    const withEvent = knowledgeGraphDiagnosticsReducer(
      withStatus,
      recordKnowledgeGraphDiagnosticsEvent({
        id: "event-1",
        createdAt: "2026-04-12T14:00:01.000Z",
        level: "info",
        eventKey: "startup_verified",
        message: "Startup verified",
        route: "/knowledge-graph",
        details: {}
      })
    );

    const withSnapshot = knowledgeGraphDiagnosticsReducer(
      withEvent,
      recordKnowledgeGraphDiagnosticsSnapshot({
        id: "snapshot-1",
        capturedAt: "2026-04-12T14:00:05.000Z",
        datasetSignature: "graph-a",
        route: "/knowledge-graph",
        rendererMode: "sigma",
        startupPhase: "startup_verified",
        startupInvariantSatisfied: true,
        focusedNodeId: null,
        primaryFocusedNodeId: null,
        graphCentroid: { x: 0, y: 0 },
        boundsCenter: { x: 0, y: 0 },
        camera: { x: 0, y: 0, ratio: 1, angle: 0 },
        cameraTarget: null,
        driftMetrics: {
          centroidDistanceFromOrigin: 0,
          boundsCenterDistanceFromOrigin: 0,
          cameraDistanceFromOrigin: 0,
          cameraToCentroidDistance: 0
        },
        nodeCount: 2,
        viewportSize: {
          width: 1280,
          height: 720
        },
        nodePositions: [
          { id: "a", x: -1, y: 0.5 },
          { id: "b", x: 1, y: -0.5 }
        ]
      })
    );

    expect(withSnapshot.panelOpen).toBe(true);
    expect(withSnapshot.latestStatus?.datasetSignature).toBe("graph-a");
    expect(withSnapshot.recentEvents).toHaveLength(1);
    expect(withSnapshot.recentSnapshots).toHaveLength(1);

    const reset = knowledgeGraphDiagnosticsReducer(
      withSnapshot,
      resetKnowledgeGraphDiagnostics()
    );

    expect(reset.panelOpen).toBe(false);
    expect(reset.latestStatus).toBeNull();
    expect(reset.recentEvents).toHaveLength(0);
    expect(reset.recentSnapshots).toHaveLength(0);
  });
});
