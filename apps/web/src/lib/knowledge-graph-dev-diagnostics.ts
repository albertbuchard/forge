import { createUiDiagnosticLogger } from "@/lib/diagnostics";
import type {
  DiagnosticLogLevel
} from "@/lib/types";
import type { KnowledgeGraphFocusPayload } from "@/lib/knowledge-graph-types";

export type KnowledgeGraphStartupPhase =
  | "boot"
  | "graph_built"
  | "worker_started"
  | "first_frame"
  | "startup_verified"
  | "startup_corrected";

export type KnowledgeGraphRendererMode = "sigma" | "fallback";

export type KnowledgeGraphGraphPoint = {
  x: number;
  y: number;
};

export type KnowledgeGraphCameraSnapshot = {
  x: number;
  y: number;
  ratio: number;
  angle: number;
};

export type KnowledgeGraphCameraTargetSnapshot = {
  x: number;
  y: number;
  ratio: number;
};

export type KnowledgeGraphNodePositionSnapshot = {
  id: string;
  x: number;
  y: number;
};

export type KnowledgeGraphDriftMetrics = {
  centroidDistanceFromOrigin: number;
  boundsCenterDistanceFromOrigin: number;
  cameraDistanceFromOrigin: number;
  cameraToCentroidDistance: number;
};

export type KnowledgeGraphDiagnosticsStatus = {
  datasetSignature: string;
  route: string;
  rendererMode: KnowledgeGraphRendererMode;
  startupPhase: KnowledgeGraphStartupPhase;
  startupInvariantSatisfied: boolean;
  visibleNodeCount: number;
  focusedNodeId: string | null;
  primaryFocusedNodeId: string | null;
  graphCentroid: KnowledgeGraphGraphPoint;
  boundsCenter: KnowledgeGraphGraphPoint;
  camera: KnowledgeGraphCameraSnapshot;
  cameraTarget: KnowledgeGraphCameraTargetSnapshot | null;
  driftMetrics: KnowledgeGraphDriftMetrics;
  latestSnapshotAt: string | null;
  lastVerifiedAt: string;
};

export type KnowledgeGraphDiagnosticsEvent = {
  id: string;
  createdAt: string;
  level: DiagnosticLogLevel;
  eventKey: string;
  message: string;
  route: string;
  details: Record<string, unknown>;
};

export type KnowledgeGraphDiagnosticsSnapshot = {
  id: string;
  capturedAt: string;
  datasetSignature: string;
  route: string;
  rendererMode: KnowledgeGraphRendererMode;
  startupPhase: KnowledgeGraphStartupPhase;
  startupInvariantSatisfied: boolean;
  focusedNodeId: string | null;
  primaryFocusedNodeId: string | null;
  graphCentroid: KnowledgeGraphGraphPoint;
  boundsCenter: KnowledgeGraphGraphPoint;
  camera: KnowledgeGraphCameraSnapshot;
  cameraTarget: KnowledgeGraphCameraTargetSnapshot | null;
  driftMetrics: KnowledgeGraphDriftMetrics;
  nodeCount: number;
  viewportSize: {
    width: number;
    height: number;
  };
  nodePositions: KnowledgeGraphNodePositionSnapshot[];
};

export type KnowledgeGraphDiagnosticsPayload = {
  datasetSignature: string;
  visibleNodeIds: string[];
  visibleNodeCount: number;
  focusedNodeId: string | null;
  primaryFocusedNodeId: string | null;
  draggedNodeId: string | null;
  layoutGeneration: number;
  rendererMode: KnowledgeGraphRendererMode;
  startupPhase: KnowledgeGraphStartupPhase;
  startupInvariantSatisfied: boolean;
  simulationPhase: "global" | "focus-enter" | "focused" | "focus-exit" | "dragging";
  focusSources: Array<{
    nodeId: string;
    strength: number;
    targetStrength: number;
    state: "entering" | "active" | "exiting";
  }>;
  focusPressureByNodeId: Record<string, number>;
  graphCentroid: KnowledgeGraphGraphPoint;
  boundsCenter: KnowledgeGraphGraphPoint;
  focusedNodePosition: KnowledgeGraphGraphPoint | null;
  cameraTarget: KnowledgeGraphCameraTargetSnapshot | null;
  cameraFollowError: {
    x: number;
    y: number;
    ratio: number;
  } | null;
  camera: KnowledgeGraphCameraSnapshot;
  nodeScreenPositions: Record<
    string,
    {
      x: number;
      y: number;
      size: number;
    }
  >;
  centroidDistanceFromOrigin: number;
  boundsCenterDistanceFromOrigin: number;
  cameraDistanceFromOrigin: number;
  cameraToCentroidDistance: number;
  latestSnapshotAt: string | null;
  latestSnapshotNodeCount: number | null;
};

export const KNOWLEDGE_GRAPH_DIAGNOSTIC_SCOPE = "knowledge_graph";
export const KNOWLEDGE_GRAPH_EVENT_RING_LIMIT = 220;
export const KNOWLEDGE_GRAPH_SNAPSHOT_RING_LIMIT = 24;
export const KNOWLEDGE_GRAPH_PERIODIC_SNAPSHOT_INTERVAL_MS = 5_000;
export const KNOWLEDGE_GRAPH_STARTUP_ORIGIN_TOLERANCE = 0.45;
export const KNOWLEDGE_GRAPH_STARTUP_CENTROID_CAMERA_TOLERANCE = 0.8;

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function distance(point: KnowledgeGraphGraphPoint) {
  return Math.hypot(point.x, point.y);
}

export function isKnowledgeGraphDevDiagnosticsEnabled() {
  return import.meta.env.DEV;
}

export function buildKnowledgeGraphBoundsCenter(
  positions: Iterable<KnowledgeGraphGraphPoint>
) {
  let count = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const position of positions) {
    count += 1;
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x);
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y);
  }

  if (count === 0) {
    return {
      x: 0,
      y: 0
    } satisfies KnowledgeGraphGraphPoint;
  }

  return {
    x: round((minX + maxX) / 2),
    y: round((minY + maxY) / 2)
  } satisfies KnowledgeGraphGraphPoint;
}

export function buildKnowledgeGraphCentroid(
  positions: Iterable<KnowledgeGraphGraphPoint>
) {
  let count = 0;
  let sumX = 0;
  let sumY = 0;

  for (const position of positions) {
    count += 1;
    sumX += position.x;
    sumY += position.y;
  }

  if (count === 0) {
    return {
      x: 0,
      y: 0
    } satisfies KnowledgeGraphGraphPoint;
  }

  return {
    x: round(sumX / count),
    y: round(sumY / count)
  } satisfies KnowledgeGraphGraphPoint;
}

export function recenterKnowledgeGraphPointsAroundOrigin<
  T extends KnowledgeGraphGraphPoint
>(positions: readonly T[]) {
  const centroid = buildKnowledgeGraphCentroid(positions);
  const changed =
    Math.abs(centroid.x) >= 0.0001 || Math.abs(centroid.y) >= 0.0001;

  return {
    changed,
    offset: centroid,
    positions: positions.map((position) => ({
      x: round(position.x - centroid.x),
      y: round(position.y - centroid.y)
    }))
  };
}

export function buildKnowledgeGraphDriftMetrics({
  centroid,
  boundsCenter,
  camera
}: {
  centroid: KnowledgeGraphGraphPoint;
  boundsCenter: KnowledgeGraphGraphPoint;
  camera: KnowledgeGraphCameraSnapshot;
}) {
  return {
    centroidDistanceFromOrigin: round(distance(centroid)),
    boundsCenterDistanceFromOrigin: round(distance(boundsCenter)),
    cameraDistanceFromOrigin: round(
      distance({
        x: camera.x,
        y: camera.y
      })
    ),
    cameraToCentroidDistance: round(
      Math.hypot(camera.x - centroid.x, camera.y - centroid.y)
    )
  } satisfies KnowledgeGraphDriftMetrics;
}

export function evaluateKnowledgeGraphStartupInvariant(
  driftMetrics: KnowledgeGraphDriftMetrics
) {
  return (
    driftMetrics.centroidDistanceFromOrigin <=
      KNOWLEDGE_GRAPH_STARTUP_ORIGIN_TOLERANCE &&
    driftMetrics.cameraDistanceFromOrigin <=
      KNOWLEDGE_GRAPH_STARTUP_ORIGIN_TOLERANCE &&
    driftMetrics.cameraToCentroidDistance <=
      KNOWLEDGE_GRAPH_STARTUP_CENTROID_CAMERA_TOLERANCE
  );
}

export function buildKnowledgeGraphDiagnosticsEventId() {
  return `kg-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildKnowledgeGraphDiagnosticsSnapshotId() {
  return `kg-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createKnowledgeGraphUiLogger(route = "/knowledge-graph") {
  const publish = createUiDiagnosticLogger({
    scope: KNOWLEDGE_GRAPH_DIAGNOSTIC_SCOPE,
    route,
    source: "ui"
  });

  return async ({
    level,
    eventKey,
    message,
    functionName,
    details,
    entityType,
    entityId
  }: {
    level: DiagnosticLogLevel;
    eventKey: string;
    message: string;
    functionName?: string | null;
    details?: Record<string, unknown>;
    entityType?: string | null;
    entityId?: string | null;
  }) =>
    publish({
      level,
      eventKey,
      message,
      functionName: functionName ?? null,
      details,
      entityType: entityType ?? null,
      entityId: entityId ?? null
    });
}

function resolveConsoleMethod(level: DiagnosticLogLevel) {
  switch (level) {
    case "error":
      return console.error;
    case "warning":
      return console.warn;
    case "info":
      return console.info;
    default:
      return console.debug;
  }
}

export function mirrorKnowledgeGraphDiagnosticsEventToConsole(
  event: KnowledgeGraphDiagnosticsEvent
) {
  if (!isKnowledgeGraphDevDiagnosticsEnabled() || typeof console === "undefined") {
    return;
  }
  const log = resolveConsoleMethod(event.level);
  console.groupCollapsed(
    `[knowledge-graph][${event.level}] ${event.eventKey} ${event.createdAt}`
  );
  log(event.message);
  console.log("route", event.route);
  console.log("details", event.details);
  console.groupEnd();
}

export function mirrorKnowledgeGraphDiagnosticsStatusToConsole(
  status: KnowledgeGraphDiagnosticsStatus | null,
  reason = "status_update"
) {
  if (
    !status ||
    !isKnowledgeGraphDevDiagnosticsEnabled() ||
    typeof console === "undefined"
  ) {
    return;
  }
  console.groupCollapsed(
    `[knowledge-graph][status] ${reason} ${status.lastVerifiedAt}`
  );
  console.info(
    `phase=${status.startupPhase} invariant=${status.startupInvariantSatisfied ? "pass" : "fail"} renderer=${status.rendererMode}`
  );
  console.log("camera", status.camera);
  console.log("cameraTarget", status.cameraTarget);
  console.log("graphCentroid", status.graphCentroid);
  console.log("boundsCenter", status.boundsCenter);
  console.log("driftMetrics", status.driftMetrics);
  console.log("focusedNodeId", status.focusedNodeId);
  console.log("primaryFocusedNodeId", status.primaryFocusedNodeId);
  console.log("visibleNodeCount", status.visibleNodeCount);
  console.groupEnd();
}

export function mirrorKnowledgeGraphDiagnosticsSnapshotToConsole(
  snapshot: KnowledgeGraphDiagnosticsSnapshot
) {
  if (!isKnowledgeGraphDevDiagnosticsEnabled() || typeof console === "undefined") {
    return;
  }
  console.group(
    `[knowledge-graph][snapshot] ${snapshot.capturedAt} nodes=${snapshot.nodeCount} invariant=${snapshot.startupInvariantSatisfied ? "pass" : "fail"}`
  );
  console.info(
    `phase=${snapshot.startupPhase} renderer=${snapshot.rendererMode} focused=${snapshot.focusedNodeId ?? "none"} primary=${snapshot.primaryFocusedNodeId ?? "none"}`
  );
  console.info(
    `[knowledge-graph][snapshot][camera] x=${snapshot.camera.x} y=${snapshot.camera.y} ratio=${snapshot.camera.ratio} angle=${snapshot.camera.angle}`
  );
  console.info(
    `[knowledge-graph][snapshot][centroid] x=${snapshot.graphCentroid.x} y=${snapshot.graphCentroid.y}`
  );
  console.info(
    `[knowledge-graph][snapshot][bounds-center] x=${snapshot.boundsCenter.x} y=${snapshot.boundsCenter.y}`
  );
  console.info(
    `[knowledge-graph][snapshot][drift] centroid=${snapshot.driftMetrics.centroidDistanceFromOrigin} bounds=${snapshot.driftMetrics.boundsCenterDistanceFromOrigin} camera=${snapshot.driftMetrics.cameraDistanceFromOrigin} cameraToCentroid=${snapshot.driftMetrics.cameraToCentroidDistance}`
  );
  console.info(
    `[knowledge-graph][snapshot][viewport-size] width=${snapshot.viewportSize.width} height=${snapshot.viewportSize.height}`
  );
  console.log("camera", snapshot.camera);
  console.log("cameraTarget", snapshot.cameraTarget);
  console.log("graphCentroid", snapshot.graphCentroid);
  console.log("boundsCenter", snapshot.boundsCenter);
  console.log("viewportSize", snapshot.viewportSize);
  console.log("driftMetrics", snapshot.driftMetrics);
  console.log("[knowledge-graph][snapshot][node-positions]", snapshot.nodePositions);
  console.log("allNodePositions", snapshot.nodePositions);
  if (typeof console.table === "function") {
    console.table(snapshot.nodePositions);
  }
  console.groupEnd();
}

export function buildKnowledgeGraphOverlayFocusEventDetails(
  focus: KnowledgeGraphFocusPayload | null
) {
  return {
    focusNodeId: focus?.focusNode?.id ?? null,
    focusNodeTitle: focus?.focusNode?.title ?? null,
    firstRingCount: focus?.firstRingNodes.length ?? 0,
    relationCounts: focus?.relationCounts ?? null
  };
}
