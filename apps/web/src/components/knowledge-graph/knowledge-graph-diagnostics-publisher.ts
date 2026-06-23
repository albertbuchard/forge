import type Graph from "graphology";
import type Sigma from "sigma";
import type { CameraState } from "sigma/types";
import {
  buildKnowledgeGraphBoundsCenter,
  buildKnowledgeGraphDriftMetrics,
  type KnowledgeGraphDiagnosticsPayload,
  type KnowledgeGraphStartupPhase
} from "@/lib/knowledge-graph-dev-diagnostics";
import type { KnowledgeGraphNode } from "@/lib/knowledge-graph-types";
import {
  projectFallbackNode,
  type FallbackGraphSnapshot,
  type SigmaEdgeAttributes,
  type SigmaNodeAttributes
} from "@/components/knowledge-graph/knowledge-graph-renderer-model";

declare global {
  interface Window {
    __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean;
    __FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__?: KnowledgeGraphDiagnosticsPayload;
    __FORGE_KNOWLEDGE_GRAPH_TEST_API__?: {
      selectNode: (nodeId: string | null) => void;
      moveNodeBy: (nodeId: string, deltaX: number, deltaY: number) => void;
      nudgeCameraBy?: (deltaX: number, deltaY: number) => void;
    };
  }
}

type KnowledgeGraphDiagnosticsBaseInput = {
  datasetSignature: string;
  focusNodeId: string | null;
  primaryFocusedNodeId: string | null;
  draggedNodeId: string | null;
  layoutGeneration: number;
  startupPhase: KnowledgeGraphStartupPhase;
  startupInvariantSatisfied: boolean;
  simulationPhase: KnowledgeGraphDiagnosticsPayload["simulationPhase"];
  focusSources: KnowledgeGraphDiagnosticsPayload["focusSources"];
  focusPressure: Float32Array;
  centroid: KnowledgeGraphDiagnosticsPayload["graphCentroid"];
  cameraTarget: KnowledgeGraphDiagnosticsPayload["cameraTarget"];
  latestSnapshotAt: string | null;
  latestSnapshotNodeCount: number | null;
};

function assignKnowledgeGraphDiagnosticsPayload({
  input,
  rendererMode,
  visibleNodeIds,
  focusPressureByNodeId,
  boundsCenter,
  focusedNodePosition,
  camera,
  nodeScreenPositions
}: {
  input: KnowledgeGraphDiagnosticsBaseInput;
  rendererMode: "sigma" | "fallback";
  visibleNodeIds: string[];
  focusPressureByNodeId: KnowledgeGraphDiagnosticsPayload["focusPressureByNodeId"];
  boundsCenter: KnowledgeGraphDiagnosticsPayload["boundsCenter"];
  focusedNodePosition: KnowledgeGraphDiagnosticsPayload["focusedNodePosition"];
  camera: CameraState;
  nodeScreenPositions: KnowledgeGraphDiagnosticsPayload["nodeScreenPositions"];
}) {
  const driftMetrics = buildKnowledgeGraphDriftMetrics({
    centroid: input.centroid,
    boundsCenter,
    camera
  });

  window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__ = {
    datasetSignature: input.datasetSignature,
    visibleNodeIds,
    visibleNodeCount: visibleNodeIds.length,
    focusedNodeId: input.focusNodeId,
    primaryFocusedNodeId: input.primaryFocusedNodeId,
    draggedNodeId: input.draggedNodeId,
    layoutGeneration: input.layoutGeneration,
    rendererMode,
    startupPhase: input.startupPhase,
    startupInvariantSatisfied: input.startupInvariantSatisfied,
    simulationPhase: input.simulationPhase,
    focusSources: input.focusSources,
    focusPressureByNodeId,
    graphCentroid: input.centroid,
    boundsCenter,
    focusedNodePosition,
    cameraTarget: input.cameraTarget,
    cameraFollowError: input.cameraTarget
      ? {
          x: Number((camera.x - input.cameraTarget.x).toFixed(4)),
          y: Number((camera.y - input.cameraTarget.y).toFixed(4)),
          ratio: Number((camera.ratio - input.cameraTarget.ratio).toFixed(4))
        }
      : null,
    camera,
    nodeScreenPositions,
    centroidDistanceFromOrigin: driftMetrics.centroidDistanceFromOrigin,
    boundsCenterDistanceFromOrigin: driftMetrics.boundsCenterDistanceFromOrigin,
    cameraDistanceFromOrigin: driftMetrics.cameraDistanceFromOrigin,
    cameraToCentroidDistance: driftMetrics.cameraToCentroidDistance,
    latestSnapshotAt: input.latestSnapshotAt,
    latestSnapshotNodeCount: input.latestSnapshotNodeCount
  };
}

export function shouldPublishKnowledgeGraphDiagnostics() {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.__FORGE_ENABLE_GRAPH_DIAGNOSTICS__) {
    return true;
  }
  try {
    return new URLSearchParams(window.location.search).get("graphDiagnostics") === "1";
  } catch {
    return false;
  }
}

export function clearKnowledgeGraphDiagnostics() {
  if (typeof window === "undefined") {
    return;
  }
  delete window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__;
  delete window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__;
}

export function publishKnowledgeGraphDiagnostics(
  input: KnowledgeGraphDiagnosticsBaseInput & {
    graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>;
    sigma: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>;
  }
) {
  const visibleNodeIds: string[] = [];
  const nodeScreenPositions: KnowledgeGraphDiagnosticsPayload["nodeScreenPositions"] = {};
  const focusPressureByNodeId: KnowledgeGraphDiagnosticsPayload["focusPressureByNodeId"] = {};
  let focusedNodePosition: KnowledgeGraphDiagnosticsPayload["focusedNodePosition"] = null;

  input.graph.forEachNode((nodeId) => {
    visibleNodeIds.push(nodeId);
    const displayData = input.sigma.getNodeDisplayData(nodeId);
    const attributes = input.graph.getNodeAttributes(nodeId);
    const viewport = input.sigma.graphToViewport({
      x: attributes.x,
      y: attributes.y
    });
    nodeScreenPositions[nodeId] = {
      x: viewport.x,
      y: viewport.y,
      size: displayData?.size ?? attributes.size
    };
    focusPressureByNodeId[nodeId] = Number(
      (input.focusPressure[visibleNodeIds.length - 1] ?? 0).toFixed(4)
    );
    if (nodeId === input.primaryFocusedNodeId) {
      focusedNodePosition = {
        x: attributes.x,
        y: attributes.y
      };
    }
  });

  const boundsCenter = buildKnowledgeGraphBoundsCenter(
    visibleNodeIds.map((nodeId) => {
      const attributes = input.graph.getNodeAttributes(nodeId);
      return {
        x: attributes.x,
        y: attributes.y
      };
    })
  );

  assignKnowledgeGraphDiagnosticsPayload({
    input,
    rendererMode: "sigma",
    visibleNodeIds,
    focusPressureByNodeId,
    boundsCenter,
    focusedNodePosition,
    camera: input.sigma.getCamera().getState(),
    nodeScreenPositions
  });
}

export function publishFallbackKnowledgeGraphDiagnostics(
  input: KnowledgeGraphDiagnosticsBaseInput & {
    camera: CameraState;
    snapshot: FallbackGraphSnapshot;
    width: number;
    height: number;
  }
) {
  const visibleNodeIds = input.snapshot.nodes.map((node) => node.id);
  const nodeScreenPositions: KnowledgeGraphDiagnosticsPayload["nodeScreenPositions"] = {};
  const focusPressureByNodeId: KnowledgeGraphDiagnosticsPayload["focusPressureByNodeId"] = {};
  let focusedNodePosition: KnowledgeGraphDiagnosticsPayload["focusedNodePosition"] = null;

  input.snapshot.nodes.forEach((node, index) => {
    nodeScreenPositions[node.id] = projectFallbackNode({
      node,
      snapshot: input.snapshot,
      camera: input.camera,
      width: input.width,
      height: input.height
    });
    focusPressureByNodeId[node.id] = Number(
      (input.focusPressure[index] ?? 0).toFixed(4)
    );
    if (node.id === input.primaryFocusedNodeId) {
      focusedNodePosition = {
        x: node.x,
        y: node.y
      };
    }
  });

  assignKnowledgeGraphDiagnosticsPayload({
    input,
    rendererMode: "fallback",
    visibleNodeIds,
    focusPressureByNodeId,
    boundsCenter: buildKnowledgeGraphBoundsCenter(
      input.snapshot.nodes.map((node) => ({
        x: node.x,
        y: node.y
      }))
    ),
    focusedNodePosition,
    camera: input.camera,
    nodeScreenPositions
  });
}
