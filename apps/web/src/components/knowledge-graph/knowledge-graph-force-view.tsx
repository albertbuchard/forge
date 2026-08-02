import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import type Graph from "graphology";
import Sigma from "sigma";
import type { CameraState } from "sigma/types";
import {
  buildKnowledgeGraphFramedGraphPosition,
  buildKnowledgeGraphFallbackKeyboardPositions,
  buildKnowledgeGraphAdjacency,
  advanceKnowledgeGraphAdaptiveQuality,
  buildKnowledgeGraphViewportNodeIds,
  beginKnowledgeGraphPresentationRender,
  completeKnowledgeGraphPresentationRender,
  buildKnowledgeGraphFocusCameraTarget,
  buildKnowledgeGraphFocusRingsFromAdjacency,
  buildKnowledgeGraphHopLevelsFromAdjacency,
  buildKnowledgeGraphOverviewCameraTarget,
  buildKnowledgeGraphSigmaOverviewRatio,
  buildVisibleRenderedKnowledgeGraphEdgeIds,
  resolveKnowledgeGraphKeyboardTarget,
  reduceKnowledgeGraphSigmaEdgeAttributes,
  reduceKnowledgeGraphSigmaNodeAttributes,
  requestKnowledgeGraphPresentation,
  shouldRenderKnowledgeGraphEdgeAtQuality,
  type KnowledgeGraphRenderQuality
} from "@/components/knowledge-graph/knowledge-graph-force-view-model";
import type { KnowledgeGraphPhysicsSettings } from "@/components/knowledge-graph/knowledge-graph-layout-model";
import type {
  KnowledgeGraphLayoutWorkerMessage,
  KnowledgeGraphLayoutWorkerResponse
} from "@/components/knowledge-graph/knowledge-graph-layout-protocol";
import {
  clearKnowledgeGraphDiagnostics,
  publishFallbackKnowledgeGraphDiagnostics,
  publishKnowledgeGraphDiagnostics,
  shouldPublishKnowledgeGraphDiagnostics
} from "@/components/knowledge-graph/knowledge-graph-diagnostics-publisher";
import {
  buildFallbackSnapshot,
  applyKnowledgeGraphThemeColors,
  buildPositionMapFromGraph,
  canUseWebGL,
  createGraphFromData,
  findNearestViewportNode,
  getFallbackOverviewCamera,
  isContainerReady,
  isKnowledgeGraphPositionMessageCurrent,
  projectFallbackNode,
  recenterGraphAroundOrigin,
  recenterPositionArraysAroundOrigin,
  rememberGraphPositions,
  type DesiredCameraTarget,
  type DragState,
  type FallbackGraphNode,
  type FallbackGraphSnapshot,
  type PositionSnapshot,
  type SigmaEdgeAttributes,
  type SigmaNodeAttributes
} from "@/components/knowledge-graph/knowledge-graph-renderer-model";
import {
  buildKnowledgeGraphEdgeStroke,
  fadeKnowledgeGraphColor,
  resolveKnowledgeGraphThemeColor
} from "@/components/knowledge-graph/knowledge-graph-theme";
import { useForgeThemeKey } from "@/hooks/use-forge-theme-key";
import {
  buildKnowledgeGraphDatasetSignature,
  buildRenderedKnowledgeGraphEdges,
  type RenderedKnowledgeGraphEdge
} from "@/lib/knowledge-graph";
import {
  buildKnowledgeGraphBoundsCenter,
  buildKnowledgeGraphCentroid,
  buildKnowledgeGraphDiagnosticsEventId,
  buildKnowledgeGraphDiagnosticsSnapshotId,
  buildKnowledgeGraphDriftMetrics,
  createKnowledgeGraphUiLogger,
  evaluateKnowledgeGraphStartupInvariant,
  isKnowledgeGraphDevDiagnosticsEnabled,
  KNOWLEDGE_GRAPH_PERIODIC_SNAPSHOT_INTERVAL_MS,
  mirrorKnowledgeGraphDiagnosticsEventToConsole,
  mirrorKnowledgeGraphDiagnosticsSnapshotToConsole,
  mirrorKnowledgeGraphDiagnosticsStatusToConsole,
  type KnowledgeGraphCameraSnapshot,
  type KnowledgeGraphDiagnosticsPayload,
  type KnowledgeGraphDiagnosticsSnapshot,
  type KnowledgeGraphDiagnosticsStatus,
  type KnowledgeGraphStartupPhase
} from "@/lib/knowledge-graph-dev-diagnostics";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode
} from "@/lib/knowledge-graph-types";
import {
  recordKnowledgeGraphDiagnosticsEvent,
  recordKnowledgeGraphDiagnosticsSnapshot,
  setKnowledgeGraphDiagnosticsStatus
} from "@/store/slices/knowledge-graph-diagnostics-slice";
import { useAppDispatch, useAppSelector } from "@/store/typed-hooks";

type KnowledgeGraphPerformanceSnapshot = {
  workerPositionMessageCount: number;
  positionCommitCount: number;
  rendererRefreshCount: number;
  rejectedPositionMessageCount: number;
  retainedNodeCount: number;
  retainedEdgeCount: number;
  renderedNodeCount: number;
  renderedNodeIds: string[];
  forcedLabelNodeIds: string[];
  displayedLabelNodeIds: string[];
  renderedEdgeCount: number;
  minimumRenderedEdgeCount: number;
  adaptiveQuality: KnowledgeGraphRenderQuality;
  adaptiveQualityChangeCount: number;
  mostConstrainedQuality: KnowledgeGraphRenderQuality;
  observedFrameP95Ms: number | null;
  reducedMotion: boolean;
  positionPublishIntervalTicks: number;
  requestedPresentationKey: string;
  renderedPresentationKey: string | null;
  lastNormalizedRmsDisplacement: number | null;
  layoutStartedAt: number | null;
  initialLayoutSettledAt: number | null;
  stableLayoutAt: number | null;
  settledFocusNodeId: string | null;
  focusSettledAt: number | null;
  layoutGeneration: number;
  committedPositionTick: number | null;
  workerSettledGeneration: number | null;
  workerSettledTick: number | null;
  renderedSettledGeneration: number | null;
  renderedSettledTick: number | null;
  renderedSettledFocusNodeId: string | null;
  focusCameraSettledNodeId: string | null;
  lastCameraAnimationDurationMs: number | null;
  firstUsefulGraphAt: number | null;
  lastRenderAt: number | null;
  focusNodeId: string | null;
  camera: CameraState | null;
};

declare global {
  interface Window {
    __FORGE_KG_POSITION_MODE__?: "baseline" | "optimized";
    __FORGE_KG_ADAPTIVE_MODE__?: "off" | "on";
    __FORGE_KG_FORCE_FALLBACK__?: boolean;
    __FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?: KnowledgeGraphPerformanceSnapshot;
  }
}

export type KnowledgeGraphForceViewHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  recenterOnFocus: () => void;
  reflow: () => void;
};

export const KnowledgeGraphForceView = forwardRef<
  KnowledgeGraphForceViewHandle,
  {
    nodes: KnowledgeGraphNode[];
    edges: KnowledgeGraphEdge[];
    sourceNodeCount?: number;
    sourceEdgeCount?: number;
    visibleNodeIds: ReadonlySet<string>;
    visibleEdgeIds: ReadonlySet<string>;
    preserveVisibleEdges: boolean;
    presentationKey: string;
    focusNodeId: string | null;
    physicsSettings: KnowledgeGraphPhysicsSettings;
    onSelectNode: (node: KnowledgeGraphNode | null) => void;
  }
>(function KnowledgeGraphForceView(
  {
    nodes,
    edges,
    sourceNodeCount = nodes.length,
    sourceEdgeCount = edges.length,
    visibleNodeIds,
    visibleEdgeIds,
    preserveVisibleEdges,
    presentationKey,
    focusNodeId,
    physicsSettings,
    onSelectNode
  },
  ref
) {
  const dispatch = useAppDispatch();
  const [layoutRevision, setLayoutRevision] = useState(0);
  const processedLayoutRevisionRef = useRef(0);
  const diagnosticsPanelOpen = useAppSelector(
    (state) => state.knowledgeGraphDiagnostics.panelOpen
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma<
    SigmaNodeAttributes,
    SigmaEdgeAttributes
  > | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const pendingPositionMessageRef = useRef<Extract<
    KnowledgeGraphLayoutWorkerResponse,
    { type: "positions" }
  > | null>(null);
  const positionCommitFrameRef = useRef<number | null>(null);
  const lastPositionCacheAtRef = useRef(0);
  const stableCandidateSinceRef = useRef<number | null>(null);
  const performanceSnapshotRef = useRef<KnowledgeGraphPerformanceSnapshot>({
    workerPositionMessageCount: 0,
    positionCommitCount: 0,
    rendererRefreshCount: 0,
    rejectedPositionMessageCount: 0,
    retainedNodeCount: sourceNodeCount,
    retainedEdgeCount: sourceEdgeCount,
    renderedNodeCount: visibleNodeIds.size,
    renderedNodeIds: [...visibleNodeIds].sort(),
    forcedLabelNodeIds: [],
    displayedLabelNodeIds: [],
    renderedEdgeCount: visibleEdgeIds.size,
    minimumRenderedEdgeCount: visibleEdgeIds.size,
    adaptiveQuality: "full",
    adaptiveQualityChangeCount: 0,
    mostConstrainedQuality: "full",
    observedFrameP95Ms: null,
    reducedMotion: false,
    positionPublishIntervalTicks: 4,
    requestedPresentationKey: presentationKey,
    renderedPresentationKey: null,
    lastNormalizedRmsDisplacement: null,
    layoutStartedAt: null,
    initialLayoutSettledAt: null,
    stableLayoutAt: null,
    settledFocusNodeId: null,
    focusSettledAt: null,
    layoutGeneration: 0,
    committedPositionTick: null,
    workerSettledGeneration: null,
    workerSettledTick: null,
    renderedSettledGeneration: null,
    renderedSettledTick: null,
    renderedSettledFocusNodeId: null,
    focusCameraSettledNodeId: null,
    lastCameraAnimationDurationMs: null,
    firstUsefulGraphAt: null,
    lastRenderAt: null,
    focusNodeId,
    camera: null
  });
  const graphRef = useRef<Graph<
    SigmaNodeAttributes,
    SigmaEdgeAttributes
  > | null>(null);
  const positionCacheRef = useRef<Map<string, PositionSnapshot>>(new Map());
  const workerSettlementRef = useRef<{
    generation: number;
    tick: number;
    focusNodeId: string | null;
  } | null>(null);
  const pendingRenderedSettlementRef = useRef<{
    generation: number;
    tick: number;
    focusNodeId: string | null;
  } | null>(null);
  const presentationRenderStateRef = useRef({
    requestedKey: presentationKey,
    pendingKey: null as string | null,
    renderedKey: null as string | null
  });
  presentationRenderStateRef.current = requestKnowledgeGraphPresentation(
    presentationRenderStateRef.current,
    presentationKey
  );
  performanceSnapshotRef.current.requestedPresentationKey = presentationKey;
  const cameraStateCacheRef = useRef<Map<string, CameraState>>(new Map());
  const previousFocusNodeIdRef = useRef<string | null>(focusNodeId);
  const nodeMapRef = useRef<Map<string, KnowledgeGraphNode>>(new Map());
  const onSelectNodeRef = useRef(onSelectNode);
  const focusNodeIdRef = useRef<string | null>(focusNodeId);
  const datasetSignatureRef = useRef<string | null>(null);
  const layoutGenerationRef = useRef(0);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressSelectionUntilRef = useRef(0);
  const previousPanningEnabledRef = useRef(true);
  const desiredCameraRef = useRef<DesiredCameraTarget | null>(null);
  const manualRatioHoldUntilRef = useRef(0);
  const cameraInteractionUntilRef = useRef(0);
  const simulationPhaseRef =
    useRef<KnowledgeGraphDiagnosticsPayload["simulationPhase"]>("global");
  const primaryFocusedNodeIdRef = useRef<string | null>(null);
  const focusSourcesRef = useRef<
    KnowledgeGraphDiagnosticsPayload["focusSources"]
  >([]);
  const focusPressureRef = useRef<Float32Array>(new Float32Array(0));
  const centroidRef = useRef<KnowledgeGraphDiagnosticsPayload["graphCentroid"]>(
    {
      x: 0,
      y: 0
    }
  );
  const startupPhaseRef = useRef<KnowledgeGraphStartupPhase>("boot");
  const startupCorrectionAppliedRef = useRef(false);
  const startupFirstFrameHandledRef = useRef(false);
  const startupWorkerVerificationHandledRef = useRef(false);
  const latestSnapshotAtRef = useRef<string | null>(null);
  const latestSnapshotNodeCountRef = useRef<number | null>(null);
  const anomalyPublishedAtRef = useRef(0);
  const lastDiagnosticsPublishAtRef = useRef(0);
  const lastStatusMirrorAtRef = useRef(0);
  const lifecycleLoggerRef = useRef(
    createKnowledgeGraphUiLogger("/knowledge-graph")
  );
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [sigmaReadyEpoch, setSigmaReadyEpoch] = useState(0);
  const [renderQuality, setRenderQuality] =
    useState<KnowledgeGraphRenderQuality>("full");
  const renderQualityRef = useRef<KnowledgeGraphRenderQuality>("full");
  const adaptiveQualityStateRef = useRef({
    quality: "full" as KnowledgeGraphRenderQuality,
    pressuredWindows: 0,
    healthyWindows: 0
  });
  const [reducedMotion, setReducedMotion] = useState(false);
  const [viewportVisibleNodeIds, setViewportVisibleNodeIds] = useState(
    () => new Set(visibleNodeIds)
  );
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [fallbackCamera, setFallbackCamera] = useState<CameraState>({
    x: 0,
    y: 0,
    angle: 0,
    ratio: 1
  });
  const [fallbackSnapshot, setFallbackSnapshot] =
    useState<FallbackGraphSnapshot | null>(null);
  const [containerSize, setContainerSize] = useState({
    width: 0,
    height: 0
  });
  const diagnosticsAvailable = isKnowledgeGraphDevDiagnosticsEnabled();
  const themeKey = useForgeThemeKey();
  const diagnosticsEnabled = diagnosticsAvailable && diagnosticsPanelOpen;
  const buildGraphOverviewRatio = (
    currentGraph: Graph<
      SigmaNodeAttributes,
      SigmaEdgeAttributes
    > | null = graphRef.current
  ) => {
    const overview = buildKnowledgeGraphOverviewCameraTarget({
      positions: currentGraph
        ? buildPositionMapFromGraph(currentGraph)
        : new Map(),
      currentRatio: 1
    });
    return overview.ratio;
  };
  const buildSigmaOverviewCameraState = (
    currentGraph: Graph<
      SigmaNodeAttributes,
      SigmaEdgeAttributes
    > | null = graphRef.current
  ) => {
    const overviewRatio = buildGraphOverviewRatio(currentGraph);
    return {
      x: 0.5,
      y: 0.5,
      angle: 0,
      ratio: buildKnowledgeGraphSigmaOverviewRatio(overviewRatio)
    } satisfies CameraState;
  };
  const buildFallbackOverviewCameraState = (
    _currentGraph: Graph<
      SigmaNodeAttributes,
      SigmaEdgeAttributes
    > | null = graphRef.current
  ) => {
    return {
      x: 0,
      y: 0,
      angle: 0,
      ratio: 1
    } satisfies CameraState;
  };
  const getCurrentRendererMode = (): "sigma" | "fallback" =>
    sigmaRef.current ? "sigma" : "fallback";

  const renderedEdges = useMemo(
    () => buildRenderedKnowledgeGraphEdges(edges),
    [edges]
  );
  const visibleRenderedEdgeIds = useMemo(
    () =>
      buildVisibleRenderedKnowledgeGraphEdgeIds(renderedEdges, visibleEdgeIds),
    [renderedEdges, visibleEdgeIds]
  );
  const graphAdjacency = useMemo(
    () =>
      buildKnowledgeGraphAdjacency(
        nodes.map((node) => node.id),
        renderedEdges
      ),
    [nodes, renderedEdges]
  );
  const datasetSignature = useMemo(
    () => buildKnowledgeGraphDatasetSignature(nodes, edges),
    [edges, nodes]
  );
  const focusRings = useMemo(
    () =>
      focusNodeId
        ? buildKnowledgeGraphFocusRingsFromAdjacency(
            graphAdjacency,
            focusNodeId
          )
        : null,
    [focusNodeId, graphAdjacency]
  );
  const detailNodeIds = useMemo(() => {
    if (!focusNodeId) {
      return new Set<string>();
    }
    return new Set<string>([focusNodeId, ...(focusRings?.firstRing ?? [])]);
  }, [focusNodeId, focusRings]);
  const adaptiveRenderedEdgeCount = useMemo(
    () =>
      renderedEdges.filter((edge) => {
        if (!visibleRenderedEdgeIds.has(edge.id)) {
          return false;
        }
        if (
          !viewportVisibleNodeIds.has(edge.source) ||
          !viewportVisibleNodeIds.has(edge.target)
        ) {
          return false;
        }
        const preserve =
          preserveVisibleEdges ||
          (!!focusNodeId &&
            (edge.source === focusNodeId || edge.target === focusNodeId)) ||
          detailNodeIds.has(edge.source) ||
          detailNodeIds.has(edge.target);
        return shouldRenderKnowledgeGraphEdgeAtQuality({
          edge,
          quality: renderQuality,
          preserve
        });
      }).length,
    [
      detailNodeIds,
      focusNodeId,
      preserveVisibleEdges,
      renderQuality,
      renderedEdges,
      visibleRenderedEdgeIds,
      viewportVisibleNodeIds
    ]
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    if (window.__FORGE_KG_ADAPTIVE_MODE__ === "off") {
      renderQualityRef.current = "full";
      adaptiveQualityStateRef.current = {
        quality: "full",
        pressuredWindows: 0,
        healthyWindows: 0
      };
      setRenderQuality("full");
      return;
    }
    let frameId = 0;
    let lastFrameAt = performance.now();
    let interactionObserved = false;
    let frameIntervals: number[] = [];

    const observeFrame = (now: number) => {
      const interval = now - lastFrameAt;
      lastFrameAt = now;
      if (
        document.visibilityState === "visible" &&
        interval > 0 &&
        interval < 100
      ) {
        frameIntervals.push(interval);
      }
      interactionObserved ||=
        now < cameraInteractionUntilRef.current ||
        dragStateRef.current !== null;

      if (frameIntervals.length >= 60) {
        const ordered = [...frameIntervals].sort((left, right) => left - right);
        const frameP95Ms =
          ordered[
            Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))
          ] ?? 0;
        const nextState = advanceKnowledgeGraphAdaptiveQuality(
          adaptiveQualityStateRef.current,
          {
            frameP95Ms,
            interactionActive: interactionObserved,
            visibleEdgeCount: visibleRenderedEdgeIds.size
          }
        );
        adaptiveQualityStateRef.current = nextState;
        const nextQuality = nextState.quality;
        performanceSnapshotRef.current.observedFrameP95Ms = frameP95Ms;
        performanceSnapshotRef.current.adaptiveQuality = nextQuality;
        window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__ = {
          ...performanceSnapshotRef.current
        };
        if (nextQuality !== renderQualityRef.current) {
          performanceSnapshotRef.current.adaptiveQualityChangeCount += 1;
          if (
            nextQuality === "reduced" ||
            (nextQuality === "balanced" &&
              performanceSnapshotRef.current.mostConstrainedQuality === "full")
          ) {
            performanceSnapshotRef.current.mostConstrainedQuality = nextQuality;
          }
          renderQualityRef.current = nextQuality;
          setRenderQuality(nextQuality);
        }
        frameIntervals = [];
        interactionObserved = false;
      }
      frameId = window.requestAnimationFrame(observeFrame);
    };

    frameId = window.requestAnimationFrame(observeFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, [visibleRenderedEdgeIds.size]);

  useEffect(() => {
    const positionPublishIntervalTicks =
      window.__FORGE_KG_POSITION_MODE__ === "baseline"
        ? 1
        : reducedMotion
          ? 10
          : renderQuality === "full"
            ? 4
            : renderQuality === "balanced"
              ? 6
              : 10;
    workerRef.current?.postMessage({
      type: "update-presentation",
      positionPublishIntervalTicks,
      reducedMotion
    } satisfies KnowledgeGraphLayoutWorkerMessage);
    performanceSnapshotRef.current.reducedMotion = reducedMotion;
    performanceSnapshotRef.current.positionPublishIntervalTicks =
      positionPublishIntervalTicks;
    window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__ = {
      ...performanceSnapshotRef.current
    };
  }, [reducedMotion, renderQuality]);
  const relatedNodeIds = useMemo(() => {
    if (!focusNodeId) {
      return new Set<string>();
    }
    return new Set<string>([
      focusNodeId,
      ...(focusRings?.firstRing ?? []),
      ...(focusRings?.secondRing ?? [])
    ]);
  }, [focusNodeId, focusRings]);

  const isSigmaContainerReady = () =>
    isContainerReady(containerRef.current, containerSize);

  const safeRefreshSigma = ({
    resize = false
  }: {
    resize?: boolean;
  } = {}) => {
    if (!sigmaRef.current || !isSigmaContainerReady()) {
      return false;
    }
    try {
      performanceSnapshotRef.current.rendererRefreshCount += 1;
      window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__ = {
        ...performanceSnapshotRef.current
      };
      if (resize) {
        sigmaRef.current.resize();
      }
      sigmaRef.current.refresh();
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Container has no width")
      ) {
        return false;
      }
      throw error;
    }
  };

  const isSelectionSuppressedAfterDrag = () =>
    Date.now() < suppressSelectionUntilRef.current;

  const recordDiagnosticsEvent = ({
    level,
    eventKey,
    message,
    details,
    publishBackend = false
  }: {
    level: "debug" | "info" | "warning" | "error";
    eventKey: string;
    message: string;
    details?: Record<string, unknown>;
    publishBackend?: boolean;
  }) => {
    if (!diagnosticsEnabled) {
      return;
    }
    if (diagnosticsPanelOpen) {
      dispatch(
        recordKnowledgeGraphDiagnosticsEvent({
          id: buildKnowledgeGraphDiagnosticsEventId(),
          createdAt: new Date().toISOString(),
          level,
          eventKey,
          message,
          route: "/knowledge-graph",
          details: details ?? {}
        })
      );
    }
    mirrorKnowledgeGraphDiagnosticsEventToConsole({
      id: "console-mirror",
      createdAt: new Date().toISOString(),
      level,
      eventKey,
      message,
      route: "/knowledge-graph",
      details: details ?? {}
    });
    if (!publishBackend) {
      return;
    }
    void lifecycleLoggerRef.current({
      level,
      eventKey,
      message,
      functionName: "KnowledgeGraphForceView",
      details
    });
  };

  const buildCurrentCameraSnapshot = (): KnowledgeGraphCameraSnapshot =>
    sigmaRef.current
      ? {
          ...sigmaRef.current.getCamera().getState()
        }
      : {
          ...fallbackCamera
        };

  const buildCurrentStatus = ({
    rendererMode
  }: {
    rendererMode: "sigma" | "fallback";
  }): KnowledgeGraphDiagnosticsStatus | null => {
    if (!graphRef.current || !datasetSignatureRef.current) {
      return null;
    }
    const graph = graphRef.current;
    const positions = graph.nodes().map((nodeId) => {
      const attributes = graph.getNodeAttributes(nodeId);
      return {
        id: nodeId,
        x: attributes.x,
        y: attributes.y
      };
    });
    const centroid = buildKnowledgeGraphCentroid(positions);
    const boundsCenter = buildKnowledgeGraphBoundsCenter(positions);
    const camera = buildCurrentCameraSnapshot();
    const driftCamera =
      rendererMode === "sigma"
        ? {
            ...camera,
            x: Number((camera.x - 0.5).toFixed(4)),
            y: Number((camera.y - 0.5).toFixed(4))
          }
        : camera;
    const driftMetrics = buildKnowledgeGraphDriftMetrics({
      centroid,
      boundsCenter,
      camera: driftCamera
    });

    return {
      datasetSignature: datasetSignatureRef.current,
      route: "/knowledge-graph",
      rendererMode,
      startupPhase: startupPhaseRef.current,
      startupInvariantSatisfied:
        evaluateKnowledgeGraphStartupInvariant(driftMetrics),
      visibleNodeCount: positions.length,
      focusedNodeId: focusNodeIdRef.current,
      primaryFocusedNodeId: primaryFocusedNodeIdRef.current,
      graphCentroid: centroid,
      boundsCenter,
      camera,
      cameraTarget: desiredCameraRef.current
        ? {
            x: desiredCameraRef.current.x,
            y: desiredCameraRef.current.y,
            ratio: desiredCameraRef.current.ratio
          }
        : null,
      driftMetrics,
      latestSnapshotAt: latestSnapshotAtRef.current,
      lastVerifiedAt: new Date().toISOString()
    };
  };

  const publishStatusToStore = (
    status: KnowledgeGraphDiagnosticsStatus | null,
    {
      mirrorToConsole = false
    }: {
      mirrorToConsole?: boolean;
    } = {}
  ) => {
    if (!diagnosticsEnabled) {
      return;
    }
    if (diagnosticsPanelOpen) {
      dispatch(setKnowledgeGraphDiagnosticsStatus(status));
    }
    if (
      mirrorToConsole &&
      Date.now() - lastStatusMirrorAtRef.current >= 1_000
    ) {
      lastStatusMirrorAtRef.current = Date.now();
      mirrorKnowledgeGraphDiagnosticsStatusToConsole(status);
    }
  };

  const buildSnapshot = ({
    rendererMode
  }: {
    rendererMode: "sigma" | "fallback";
  }): KnowledgeGraphDiagnosticsSnapshot | null => {
    const status = buildCurrentStatus({ rendererMode });
    if (!status || !graphRef.current) {
      return null;
    }
    const nodePositions = graphRef.current.nodes().map((nodeId) => {
      const attributes = graphRef.current!.getNodeAttributes(nodeId);
      return {
        id: nodeId,
        x: Number(attributes.x.toFixed(4)),
        y: Number(attributes.y.toFixed(4))
      };
    });
    return {
      id: buildKnowledgeGraphDiagnosticsSnapshotId(),
      capturedAt: new Date().toISOString(),
      datasetSignature: status.datasetSignature,
      route: status.route,
      rendererMode: status.rendererMode,
      startupPhase: status.startupPhase,
      startupInvariantSatisfied: status.startupInvariantSatisfied,
      focusedNodeId: status.focusedNodeId,
      primaryFocusedNodeId: status.primaryFocusedNodeId,
      graphCentroid: status.graphCentroid,
      boundsCenter: status.boundsCenter,
      camera: status.camera,
      cameraTarget: status.cameraTarget,
      driftMetrics: status.driftMetrics,
      nodeCount: nodePositions.length,
      viewportSize: {
        width: containerSize.width,
        height: containerSize.height
      },
      nodePositions
    };
  };

  const recordSnapshot = ({
    rendererMode,
    publishAnomaly
  }: {
    rendererMode: "sigma" | "fallback";
    publishAnomaly?: boolean;
  }) => {
    if (!diagnosticsEnabled) {
      return;
    }
    const snapshot = buildSnapshot({ rendererMode });
    if (!snapshot) {
      return;
    }
    latestSnapshotAtRef.current = snapshot.capturedAt;
    latestSnapshotNodeCountRef.current = snapshot.nodeCount;
    if (diagnosticsPanelOpen) {
      dispatch(recordKnowledgeGraphDiagnosticsSnapshot(snapshot));
    }
    mirrorKnowledgeGraphDiagnosticsSnapshotToConsole(snapshot);
    publishStatusToStore(
      {
        ...buildCurrentStatus({ rendererMode })!,
        latestSnapshotAt: snapshot.capturedAt
      },
      {
        mirrorToConsole: true
      }
    );

    if (
      publishAnomaly &&
      !snapshot.startupInvariantSatisfied &&
      Date.now() - anomalyPublishedAtRef.current > 15_000
    ) {
      anomalyPublishedAtRef.current = Date.now();
      recordDiagnosticsEvent({
        level: "warning",
        eventKey: "snapshot_drift_detected",
        message:
          "Knowledge graph drift exceeded the startup tolerance during dev diagnostics sampling.",
        publishBackend: true,
        details: {
          datasetSignature: snapshot.datasetSignature,
          driftMetrics: snapshot.driftMetrics,
          startupPhase: snapshot.startupPhase,
          nodeCount: snapshot.nodeCount
        }
      });
    }
  };

  const resetCameraToOrigin = () => {
    const originCamera = sigmaRef.current
      ? buildSigmaOverviewCameraState()
      : buildFallbackOverviewCameraState();
    if (sigmaRef.current) {
      sigmaRef.current.getCamera().setState(originCamera);
      return;
    }
    setFallbackCamera(originCamera);
  };

  const recenterGraphStateAroundOrigin = (reason: string) => {
    if (!graphRef.current) {
      return false;
    }
    const statusBefore = buildCurrentStatus({
      rendererMode: getCurrentRendererMode()
    });
    if (!statusBefore) {
      return false;
    }
    const offsetX = statusBefore.graphCentroid.x;
    const offsetY = statusBefore.graphCentroid.y;
    if (Math.abs(offsetX) < 0.0001 && Math.abs(offsetY) < 0.0001) {
      return false;
    }

    recenterGraphAroundOrigin(graphRef.current);
    rememberGraphPositions(graphRef.current, positionCacheRef.current);
    workerRef.current?.postMessage({
      type: "recenter-graph",
      offsetX,
      offsetY
    } satisfies KnowledgeGraphLayoutWorkerMessage);
    setFallbackSnapshot(buildFallbackSnapshot(graphRef.current, renderedEdges));
    resetCameraToOrigin();
    startupPhaseRef.current = "startup_corrected";
    recordDiagnosticsEvent({
      level: "warning",
      eventKey: "startup_corrected",
      message:
        "Corrected the knowledge graph startup bias back to graph-space origin.",
      publishBackend: true,
      details: {
        reason,
        offsetX,
        offsetY,
        datasetSignature: datasetSignatureRef.current
      }
    });
    return true;
  };

  const verifyStartupInvariant = ({
    phase,
    allowCorrection,
    publishBackendOnFailure = false
  }: {
    phase: KnowledgeGraphStartupPhase;
    allowCorrection: boolean;
    publishBackendOnFailure?: boolean;
  }) => {
    if (!graphRef.current || !datasetSignatureRef.current) {
      return;
    }
    startupPhaseRef.current = phase;
    const rendererMode = sigmaRef.current ? "sigma" : "fallback";
    const status = buildCurrentStatus({ rendererMode });
    if (!status) {
      return;
    }
    publishStatusToStore(status, {
      mirrorToConsole: true
    });
    if (status.startupInvariantSatisfied) {
      startupPhaseRef.current = "startup_verified";
      publishStatusToStore(
        {
          ...status,
          startupPhase: "startup_verified"
        },
        {
          mirrorToConsole: true
        }
      );
      recordDiagnosticsEvent({
        level: "info",
        eventKey: "startup_verified",
        message: "Knowledge graph startup invariant passed.",
        details: {
          datasetSignature: status.datasetSignature,
          driftMetrics: status.driftMetrics,
          phase
        }
      });
      return;
    }

    recordDiagnosticsEvent({
      level: "warning",
      eventKey: "startup_invariant_failed",
      message: "Knowledge graph startup invariant failed before correction.",
      publishBackend: publishBackendOnFailure,
      details: {
        datasetSignature: status.datasetSignature,
        phase,
        driftMetrics: status.driftMetrics,
        centroid: status.graphCentroid,
        boundsCenter: status.boundsCenter,
        camera: status.camera
      }
    });

    if (!allowCorrection || startupCorrectionAppliedRef.current) {
      return;
    }

    startupCorrectionAppliedRef.current = true;
    const corrected = recenterGraphStateAroundOrigin(phase);
    if (!corrected) {
      return;
    }
    safeRefreshSigma();
    const correctedStatus = buildCurrentStatus({ rendererMode });
    if (!correctedStatus) {
      return;
    }
    publishStatusToStore(correctedStatus, {
      mirrorToConsole: true
    });
    if (correctedStatus.startupInvariantSatisfied) {
      startupPhaseRef.current = "startup_verified";
      publishStatusToStore(
        {
          ...correctedStatus,
          startupPhase: "startup_verified"
        },
        {
          mirrorToConsole: true
        }
      );
      recordDiagnosticsEvent({
        level: "info",
        eventKey: "startup_verified_after_correction",
        message: "Knowledge graph startup invariant passed after correction.",
        details: {
          datasetSignature: correctedStatus.datasetSignature,
          driftMetrics: correctedStatus.driftMetrics
        }
      });
      return;
    }
    recordDiagnosticsEvent({
      level: "error",
      eventKey: "startup_correction_failed",
      message:
        "Knowledge graph startup correction did not restore the origin invariant.",
      publishBackend: true,
      details: {
        datasetSignature: correctedStatus.datasetSignature,
        driftMetrics: correctedStatus.driftMetrics,
        centroid: correctedStatus.graphCentroid,
        boundsCenter: correctedStatus.boundsCenter,
        camera: correctedStatus.camera
      }
    });
  };

  const publishCurrentDiagnostics = () => {
    if (!datasetSignatureRef.current || !graphRef.current) {
      return;
    }
    const now = Date.now();
    if (now - lastDiagnosticsPublishAtRef.current < 1_500) {
      return;
    }
    lastDiagnosticsPublishAtRef.current = now;
    if (sigmaRef.current) {
      publishKnowledgeGraphDiagnostics({
        datasetSignature: datasetSignatureRef.current,
        focusNodeId: focusNodeIdRef.current,
        primaryFocusedNodeId: primaryFocusedNodeIdRef.current,
        draggedNodeId: dragStateRef.current?.nodeId ?? null,
        graph: graphRef.current,
        layoutGeneration: layoutGenerationRef.current,
        sigma: sigmaRef.current,
        startupPhase: startupPhaseRef.current,
        startupInvariantSatisfied:
          buildCurrentStatus({ rendererMode: "sigma" })
            ?.startupInvariantSatisfied ?? false,
        simulationPhase: simulationPhaseRef.current,
        focusSources: focusSourcesRef.current,
        focusPressure: focusPressureRef.current,
        centroid: centroidRef.current,
        cameraTarget: desiredCameraRef.current
          ? {
              x: desiredCameraRef.current.x,
              y: desiredCameraRef.current.y,
              ratio: desiredCameraRef.current.ratio
            }
          : null,
        latestSnapshotAt: latestSnapshotAtRef.current,
        latestSnapshotNodeCount: latestSnapshotNodeCountRef.current
      });
      return;
    }
    if (!fallbackSnapshot) {
      return;
    }
    publishFallbackKnowledgeGraphDiagnostics({
      datasetSignature: datasetSignatureRef.current,
      focusNodeId: focusNodeIdRef.current,
      primaryFocusedNodeId: primaryFocusedNodeIdRef.current,
      draggedNodeId: dragStateRef.current?.nodeId ?? null,
      layoutGeneration: layoutGenerationRef.current,
      camera: fallbackCamera,
      snapshot: fallbackSnapshot,
      width: containerSize.width,
      height: containerSize.height,
      startupPhase: startupPhaseRef.current,
      startupInvariantSatisfied:
        buildCurrentStatus({ rendererMode: "fallback" })
          ?.startupInvariantSatisfied ?? false,
      simulationPhase: simulationPhaseRef.current,
      focusSources: focusSourcesRef.current,
      focusPressure: focusPressureRef.current,
      centroid: centroidRef.current,
      cameraTarget: desiredCameraRef.current
        ? {
            x: desiredCameraRef.current.x,
            y: desiredCameraRef.current.y,
            ratio: desiredCameraRef.current.ratio
          }
        : null,
      latestSnapshotAt: latestSnapshotAtRef.current,
      latestSnapshotNodeCount: latestSnapshotNodeCountRef.current
    });
  };

  const updateDesiredCameraFromGraph = () => {
    if (!graphRef.current || !focusNodeIdRef.current) {
      desiredCameraRef.current = null;
      return;
    }
    const currentGraph = graphRef.current;
    if (!currentGraph.hasNode(focusNodeIdRef.current)) {
      desiredCameraRef.current = null;
      return;
    }
    const positions = buildPositionMapFromGraph(currentGraph);
    const rings = buildKnowledgeGraphFocusRingsFromAdjacency(
      graphAdjacency,
      focusNodeIdRef.current
    );
    const cachedCamera = datasetSignatureRef.current
      ? cameraStateCacheRef.current.get(
          `${datasetSignatureRef.current}::focus:${focusNodeIdRef.current}`
        )
      : null;
    if (cachedCamera) {
      desiredCameraRef.current = {
        ...cachedCamera,
        nodeIds: [focusNodeIdRef.current, ...rings.firstRing]
      };
      return;
    }
    const currentRatio = sigmaRef.current
      ? sigmaRef.current.getCamera().getState().ratio
      : fallbackCamera.ratio;
    const target = buildKnowledgeGraphFocusCameraTarget({
      positions,
      focusNodeId: focusNodeIdRef.current,
      firstRingNodeIds: rings.firstRing,
      secondRingNodeIds: [],
      currentRatio
    });
    const sigmaTarget =
      sigmaRef.current && target
        ? buildKnowledgeGraphFramedGraphPosition({
            positions,
            point: {
              x: target.x,
              y: target.y
            }
          })
        : null;
    desiredCameraRef.current = target
      ? {
          x: Math.min(
            1,
            Math.max(
              0,
              (sigmaTarget?.x ?? target.x) +
                (containerSize.width >= 900 ? 0.18 : 0)
            )
          ),
          y: sigmaTarget?.y ?? target.y,
          angle: 0,
          ratio: target.ratio,
          nodeIds: target.nodeIds
        }
      : null;
  };

  const animateCameraToDesired = async (duration = 220) => {
    if (!desiredCameraRef.current) {
      return;
    }
    const target = desiredCameraRef.current;
    const targetFocusNodeId = focusNodeIdRef.current;
    if (sigmaRef.current) {
      const camera = sigmaRef.current.getCamera();
      const current = camera.getState();
      const shouldRespectManualRatio =
        Date.now() < manualRatioHoldUntilRef.current;
      const cameraAnimationDurationMs = reducedMotion ? 0 : duration;
      performanceSnapshotRef.current.lastCameraAnimationDurationMs =
        cameraAnimationDurationMs;
      await camera.animate(
        {
          x: target.x,
          y: target.y,
          ratio: shouldRespectManualRatio ? current.ratio : target.ratio,
          angle: 0
        },
        { duration: cameraAnimationDurationMs }
      );
      if (focusNodeIdRef.current === targetFocusNodeId) {
        performanceSnapshotRef.current.focusCameraSettledNodeId =
          targetFocusNodeId;
        performanceSnapshotRef.current.camera = camera.getState();
        window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__ = {
          ...performanceSnapshotRef.current
        };
        lifecycleCallbacksRef.current.publishCurrentDiagnostics();
      }
      return;
    }
    setFallbackCamera((current) => ({
      ...current,
      x: target.x,
      y: target.y,
      ratio:
        Date.now() < manualRatioHoldUntilRef.current
          ? current.ratio
          : target.ratio
    }));
    performanceSnapshotRef.current.lastCameraAnimationDurationMs = 0;
    performanceSnapshotRef.current.focusCameraSettledNodeId = targetFocusNodeId;
  };

  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) {
      setViewportVisibleNodeIds(new Set(visibleNodeIds));
      return;
    }
    let frameId: number | null = null;
    const update = () => {
      frameId = null;
      const preserve = new Set<string>([
        ...(focusNodeId ? [focusNodeId] : []),
        ...detailNodeIds,
        ...(hoveredNodeId ? [hoveredNodeId] : []),
        ...(draggedNodeId ? [draggedNodeId] : [])
      ]);
      const viewportNodes = [...visibleNodeIds]
        .filter((nodeId) => graph.hasNode(nodeId))
        .map((nodeId) => {
          const point = sigma.graphToViewport({
            x: graph.getNodeAttribute(nodeId, "x"),
            y: graph.getNodeAttribute(nodeId, "y")
          });
          return { id: nodeId, viewportX: point.x, viewportY: point.y };
        });
      setViewportVisibleNodeIds(
        buildKnowledgeGraphViewportNodeIds({
          nodes: viewportNodes,
          width: containerSize.width,
          height: containerSize.height,
          padding:
            renderQuality === "full"
              ? 140
              : renderQuality === "balanced"
                ? 90
                : 48,
          preserveNodeIds: preserve,
          preserveAll: preserveVisibleEdges || Boolean(focusNodeId)
        })
      );
    };
    const schedule = () => {
      if (frameId === null) frameId = window.requestAnimationFrame(update);
    };
    sigma.getCamera().on("updated", schedule);
    schedule();
    return () => {
      sigma.getCamera().off("updated", schedule);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [
    containerSize.height,
    containerSize.width,
    detailNodeIds,
    draggedNodeId,
    focusNodeId,
    hoveredNodeId,
    renderQuality,
    preserveVisibleEdges,
    sigmaReadyEpoch,
    visibleNodeIds
  ]);

  const lifecycleCallbacksRef = useRef({
    animateCameraToDesired,
    buildCurrentStatus,
    buildFallbackOverviewCameraState,
    buildSigmaOverviewCameraState,
    publishCurrentDiagnostics,
    recordDiagnosticsEvent,
    recordSnapshot,
    resetCameraToOrigin,
    safeRefreshSigma,
    updateDesiredCameraFromGraph,
    verifyStartupInvariant
  });
  lifecycleCallbacksRef.current = {
    animateCameraToDesired,
    buildCurrentStatus,
    buildFallbackOverviewCameraState,
    buildSigmaOverviewCameraState,
    publishCurrentDiagnostics,
    recordDiagnosticsEvent,
    recordSnapshot,
    resetCameraToOrigin,
    safeRefreshSigma,
    updateDesiredCameraFromGraph,
    verifyStartupInvariant
  };

  useEffect(() => {
    onSelectNodeRef.current = onSelectNode;
  }, [onSelectNode]);

  useEffect(() => {
    focusNodeIdRef.current = focusNodeId;
    desiredCameraRef.current = null;
    pendingPositionMessageRef.current = null;
    if (positionCommitFrameRef.current !== null) {
      window.cancelAnimationFrame(positionCommitFrameRef.current);
      positionCommitFrameRef.current = null;
    }
    stableCandidateSinceRef.current = null;
    performanceSnapshotRef.current.settledFocusNodeId = null;
    performanceSnapshotRef.current.focusSettledAt = null;
    performanceSnapshotRef.current.workerSettledGeneration = null;
    performanceSnapshotRef.current.workerSettledTick = null;
    performanceSnapshotRef.current.renderedSettledGeneration = null;
    performanceSnapshotRef.current.renderedSettledTick = null;
    performanceSnapshotRef.current.renderedSettledFocusNodeId = null;
    performanceSnapshotRef.current.focusCameraSettledNodeId = null;
    performanceSnapshotRef.current.lastCameraAnimationDurationMs = null;
    workerSettlementRef.current = null;
    pendingRenderedSettlementRef.current = null;
  }, [focusNodeId]);

  useEffect(() => {
    if (!diagnosticsEnabled) {
      clearKnowledgeGraphDiagnostics();
    }
  }, [diagnosticsEnabled]);

  useEffect(() => {
    if (
      !shouldPublishKnowledgeGraphDiagnostics() ||
      typeof window === "undefined"
    ) {
      return;
    }
    window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__ = {
      selectNode: (nodeId) => {
        const nextNode = nodeId
          ? (nodeMapRef.current.get(nodeId) ??
            (graphRef.current?.hasNode(nodeId)
              ? ((graphRef.current.getNodeAttribute(nodeId, "data") as
                  | KnowledgeGraphNode
                  | undefined) ?? null)
              : null))
          : null;
        onSelectNodeRef.current(nextNode);
      },
      moveNodeBy: (nodeId, deltaX, deltaY) => {
        if (!graphRef.current?.hasNode(nodeId)) {
          return;
        }
        const attributes = graphRef.current.getNodeAttributes(nodeId);
        const nextX = attributes.x + deltaX;
        const nextY = attributes.y + deltaY;
        graphRef.current.mergeNodeAttributes(nodeId, {
          x: nextX,
          y: nextY
        });
        positionCacheRef.current.set(nodeId, {
          x: nextX,
          y: nextY
        });
        workerRef.current?.postMessage({
          type: "nudge-node",
          nodeId,
          x: nextX,
          y: nextY
        } satisfies KnowledgeGraphLayoutWorkerMessage);
        lifecycleCallbacksRef.current.safeRefreshSigma();
        if (!sigmaRef.current && graphRef.current) {
          setFallbackSnapshot(
            buildFallbackSnapshot(graphRef.current, renderedEdges)
          );
        }
      },
      nudgeCameraBy: (deltaX, deltaY) => {
        if (sigmaRef.current) {
          const camera = sigmaRef.current.getCamera();
          const current = camera.getState();
          void camera.animate(
            {
              x: current.x + deltaX,
              y: current.y + deltaY,
              ratio: current.ratio,
              angle: current.angle
            },
            { duration: reducedMotion ? 0 : 80 }
          );
          return;
        }
        setFallbackCamera((current) => ({
          ...current,
          x: current.x + deltaX,
          y: current.y + deltaY
        }));
      }
    };
    return () => {
      delete window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__;
    };
  }, [reducedMotion, renderedEdges]);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateSize = () => {
      if (!containerRef.current) {
        return;
      }
      setContainerSize({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight
      });
    };

    updateSize();
    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        manualRatioHoldUntilRef.current = Date.now() + 1200;
        if (sigmaRef.current) {
          void sigmaRef.current.getCamera().animatedZoom({
            factor: 1.25,
            duration: reducedMotion ? 0 : 160
          });
          return;
        }
        setFallbackCamera((current) => ({
          ...current,
          ratio: Math.max(0.08, current.ratio * 0.82)
        }));
      },
      zoomOut: () => {
        manualRatioHoldUntilRef.current = Date.now() + 1200;
        if (sigmaRef.current) {
          void sigmaRef.current.getCamera().animatedUnzoom({
            factor: 1.25,
            duration: reducedMotion ? 0 : 160
          });
          return;
        }
        setFallbackCamera((current) => ({
          ...current,
          ratio: Math.min(4, current.ratio * 1.22)
        }));
      },
      fit: () => {
        desiredCameraRef.current = null;
        if (sigmaRef.current) {
          void sigmaRef.current
            .getCamera()
            .animate(
              lifecycleCallbacksRef.current.buildSigmaOverviewCameraState(),
              { duration: reducedMotion ? 0 : 220 }
            );
          return;
        }
        if (fallbackSnapshot) {
          setFallbackCamera(getFallbackOverviewCamera());
        }
      },
      recenterOnFocus: () => {
        lifecycleCallbacksRef.current.updateDesiredCameraFromGraph();
        if (!desiredCameraRef.current) {
          return;
        }
        lifecycleCallbacksRef.current.animateCameraToDesired(220);
      },
      reflow: () => {
        setLayoutRevision((current) => current + 1);
      }
    }),
    [fallbackSnapshot, reducedMotion]
  );

  useEffect(() => {
    const positionCache = positionCacheRef.current;
    const cameraStateCache = cameraStateCacheRef.current;
    return () => {
      if (graphRef.current) {
        rememberGraphPositions(graphRef.current, positionCache);
      }
      if (sigmaRef.current && datasetSignatureRef.current) {
        cameraStateCache.set(
          datasetSignatureRef.current,
          sigmaRef.current.getCamera().getState()
        );
      }
      workerRef.current?.postMessage({
        type: "dispose"
      } satisfies KnowledgeGraphLayoutWorkerMessage);
      workerRef.current?.terminate();
      workerRef.current = null;
      pendingPositionMessageRef.current = null;
      if (positionCommitFrameRef.current !== null) {
        window.cancelAnimationFrame(positionCommitFrameRef.current);
        positionCommitFrameRef.current = null;
      }
      if (diagnosticsEnabled) {
        lifecycleCallbacksRef.current.recordDiagnosticsEvent({
          level: "debug",
          eventKey: "sigma_killed",
          message: "Disposed the knowledge graph renderer."
        });
      }
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      clearKnowledgeGraphDiagnostics();
    };
  }, [diagnosticsEnabled]);

  useEffect(() => {
    const {
      buildFallbackOverviewCameraState,
      buildSigmaOverviewCameraState,
      publishCurrentDiagnostics,
      recordDiagnosticsEvent,
      recordSnapshot,
      resetCameraToOrigin,
      safeRefreshSigma,
      verifyStartupInvariant
    } = lifecycleCallbacksRef.current;
    if (
      !containerRef.current ||
      !isContainerReady(containerRef.current, containerSize)
    ) {
      return;
    }

    const sameDataset =
      datasetSignatureRef.current === datasetSignature &&
      graphRef.current !== null;
    const reflowRequested =
      processedLayoutRevisionRef.current !== layoutRevision;

    if (sameDataset && !reflowRequested) {
      safeRefreshSigma({ resize: true });
      if (diagnosticsEnabled) {
        recordDiagnosticsEvent({
          level: "debug",
          eventKey: "graph_refresh",
          message:
            "Reused the current graph dataset and refreshed the renderer.",
          details: {
            datasetSignature,
            width: containerSize.width,
            height: containerSize.height,
            focusNodeId,
            physicsSettings
          }
        });
      }
      publishCurrentDiagnostics();
      return;
    }
    processedLayoutRevisionRef.current = layoutRevision;

    startupPhaseRef.current = "boot";
    startupCorrectionAppliedRef.current = false;
    startupFirstFrameHandledRef.current = false;
    startupWorkerVerificationHandledRef.current = false;
    latestSnapshotAtRef.current = null;
    latestSnapshotNodeCountRef.current = null;
    anomalyPublishedAtRef.current = 0;
    desiredCameraRef.current = null;

    recordDiagnosticsEvent({
      level: "info",
      eventKey: "graph_boot",
      message: "Bootstrapping a fresh knowledge graph dataset.",
      details: {
        datasetSignature,
        nodeCount: nodes.length,
        edgeCount: renderedEdges.length
      }
    });

    if (graphRef.current) {
      rememberGraphPositions(graphRef.current, positionCacheRef.current);
    }
    if (sigmaRef.current && datasetSignatureRef.current) {
      cameraStateCacheRef.current.set(
        datasetSignatureRef.current,
        sigmaRef.current.getCamera().getState()
      );
    }

    const nextGraph = createGraphFromData(
      nodes,
      renderedEdges,
      positionCacheRef.current
    );
    recenterGraphAroundOrigin(nextGraph);
    rememberGraphPositions(nextGraph, positionCacheRef.current);
    graphRef.current = nextGraph;
    nodeMapRef.current = new Map(nodes.map((node) => [node.id, node]));
    datasetSignatureRef.current = datasetSignature;
    layoutGenerationRef.current += 1;
    performanceSnapshotRef.current = {
      workerPositionMessageCount: 0,
      positionCommitCount: 0,
      rendererRefreshCount: 0,
      rejectedPositionMessageCount: 0,
      retainedNodeCount: sourceNodeCount,
      retainedEdgeCount: sourceEdgeCount,
      renderedNodeCount: visibleNodeIds.size,
      renderedNodeIds: [...visibleNodeIds].sort(),
      forcedLabelNodeIds: [],
      displayedLabelNodeIds: [],
      renderedEdgeCount: adaptiveRenderedEdgeCount,
      minimumRenderedEdgeCount: adaptiveRenderedEdgeCount,
      adaptiveQuality: renderQualityRef.current,
      adaptiveQualityChangeCount: 0,
      mostConstrainedQuality: renderQualityRef.current,
      observedFrameP95Ms: performanceSnapshotRef.current.observedFrameP95Ms,
      reducedMotion,
      positionPublishIntervalTicks: reducedMotion ? 10 : 4,
      requestedPresentationKey: presentationKey,
      renderedPresentationKey: null,
      lastNormalizedRmsDisplacement: null,
      layoutStartedAt: null,
      initialLayoutSettledAt: null,
      stableLayoutAt: null,
      settledFocusNodeId: null,
      focusSettledAt: null,
      layoutGeneration: layoutGenerationRef.current,
      committedPositionTick: null,
      workerSettledGeneration: null,
      workerSettledTick: null,
      renderedSettledGeneration: null,
      renderedSettledTick: null,
      renderedSettledFocusNodeId: null,
      focusCameraSettledNodeId: null,
      lastCameraAnimationDurationMs: null,
      firstUsefulGraphAt: null,
      lastRenderAt: null,
      focusNodeId,
      camera: null
    };
    window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__ = {
      ...performanceSnapshotRef.current
    };
    setFallbackSnapshot(buildFallbackSnapshot(nextGraph, renderedEdges));
    startupPhaseRef.current = "graph_built";
    recordDiagnosticsEvent({
      level: "info",
      eventKey: "graph_built",
      message: "Built and centered the knowledge graph structure.",
      details: {
        datasetSignature,
        layoutGeneration: layoutGenerationRef.current
      }
    });

    if (window.__FORGE_KG_FORCE_FALLBACK__ || !canUseWebGL()) {
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      setFallbackReason("WebGL is unavailable in this browser context.");
      setFallbackCamera(buildFallbackOverviewCameraState(nextGraph));
      verifyStartupInvariant({
        phase: "graph_built",
        allowCorrection: true,
        publishBackendOnFailure: true
      });
    } else {
      try {
        if (!sigmaRef.current) {
          sigmaRef.current = new Sigma(nextGraph, containerRef.current, {
            renderEdgeLabels: false,
            hideEdgesOnMove: true,
            hideLabelsOnMove: true,
            labelRenderedSizeThreshold: 20,
            labelDensity: 0.04,
            labelGridCellSize: 120,
            defaultNodeColor: resolveKnowledgeGraphThemeColor("--primary"),
            defaultEdgeColor: fadeKnowledgeGraphColor(
              resolveKnowledgeGraphThemeColor("--info", "rgb(125, 211, 252)"),
              0.1
            ),
            minCameraRatio: 0.08,
            maxCameraRatio: 4,
            autoRescale: true,
            autoCenter: false,
            enableEdgeEvents: false,
            enableCameraPanning: true,
            zIndex: true
          });
          sigmaRef.current.getCamera().on("updated", () => {
            cameraInteractionUntilRef.current = performance.now() + 80;
          });
          recordDiagnosticsEvent({
            level: "info",
            eventKey: "sigma_initialized",
            message: "Initialized Sigma for the knowledge graph.",
            details: {
              datasetSignature
            }
          });

          sigmaRef.current.on("clickNode", ({ node }) => {
            if (isSelectionSuppressedAfterDrag()) {
              return;
            }
            const nextNode = nodeMapRef.current.get(node) ?? null;
            onSelectNodeRef.current(nextNode);
          });
          sigmaRef.current.on("clickStage", ({ event }) => {
            if (isSelectionSuppressedAfterDrag()) {
              return;
            }
            if (!sigmaRef.current || !graphRef.current) {
              onSelectNodeRef.current(null);
              return;
            }
            const nearestNodeId = findNearestViewportNode({
              sigma: sigmaRef.current,
              graph: graphRef.current,
              viewportX: event.x,
              viewportY: event.y
            });
            if (nearestNodeId) {
              onSelectNodeRef.current(
                nodeMapRef.current.get(nearestNodeId) ?? null
              );
              return;
            }
            onSelectNodeRef.current(null);
          });
          sigmaRef.current.on(
            "downNode",
            ({ node, event, preventSigmaDefault }) => {
              if (!sigmaRef.current || !graphRef.current?.hasNode(node)) {
                return;
              }
              preventSigmaDefault();
              const graphPosition = sigmaRef.current.viewportToGraph({
                x: event.x,
                y: event.y
              });
              const current = graphRef.current.getNodeAttributes(node);
              dragStateRef.current = {
                nodeId: node,
                offsetX: current.x - graphPosition.x,
                offsetY: current.y - graphPosition.y,
                startViewportX: event.x,
                startViewportY: event.y,
                currentX: current.x,
                currentY: current.y,
                moved: false
              };
              previousPanningEnabledRef.current =
                sigmaRef.current.getSetting("enableCameraPanning") ?? true;
              sigmaRef.current.setSetting("enableCameraPanning", false);
              setDraggedNodeId(node);
              setHoveredNodeId(node);
              recordDiagnosticsEvent({
                level: "debug",
                eventKey: "drag_start",
                message: "Started dragging a knowledge graph node.",
                details: {
                  nodeId: node
                }
              });
              workerRef.current?.postMessage({
                type: "drag-start",
                nodeId: node
              } satisfies KnowledgeGraphLayoutWorkerMessage);
            }
          );
          sigmaRef.current.on("moveBody", ({ event, preventSigmaDefault }) => {
            if (
              !sigmaRef.current ||
              !graphRef.current ||
              !dragStateRef.current
            ) {
              return;
            }
            preventSigmaDefault();
            const graphPosition = sigmaRef.current.viewportToGraph({
              x: event.x,
              y: event.y
            });
            const movedDistance = Math.hypot(
              event.x - dragStateRef.current.startViewportX,
              event.y - dragStateRef.current.startViewportY
            );
            if (movedDistance > 3) {
              dragStateRef.current = {
                ...dragStateRef.current,
                moved: true
              };
            }
            const nextX = graphPosition.x + dragStateRef.current.offsetX;
            const nextY = graphPosition.y + dragStateRef.current.offsetY;
            dragStateRef.current = {
              ...dragStateRef.current,
              currentX: nextX,
              currentY: nextY
            };
            graphRef.current.mergeNodeAttributes(dragStateRef.current.nodeId, {
              x: nextX,
              y: nextY
            });
            positionCacheRef.current.set(dragStateRef.current.nodeId, {
              x: nextX,
              y: nextY
            });
            workerRef.current?.postMessage({
              type: "drag-move",
              nodeId: dragStateRef.current.nodeId,
              x: nextX,
              y: nextY
            } satisfies KnowledgeGraphLayoutWorkerMessage);
            safeRefreshSigma();
          });
          const releaseDraggedNode = () => {
            if (!sigmaRef.current || !dragStateRef.current) {
              dragStateRef.current = null;
              setDraggedNodeId(null);
              return;
            }
            const releasedNodeId = dragStateRef.current.nodeId;
            const didMove = dragStateRef.current.moved;
            sigmaRef.current.setSetting(
              "enableCameraPanning",
              previousPanningEnabledRef.current
            );
            workerRef.current?.postMessage({
              type: "drag-end",
              nodeId: releasedNodeId
            } satisfies KnowledgeGraphLayoutWorkerMessage);
            recordDiagnosticsEvent({
              level: "debug",
              eventKey: "drag_end",
              message: "Released a dragged knowledge graph node.",
              details: {
                nodeId: releasedNodeId,
                moved: didMove
              }
            });
            dragStateRef.current = null;
            setDraggedNodeId(null);
            if (didMove) {
              suppressSelectionUntilRef.current = Date.now() + 220;
              onSelectNodeRef.current(
                nodeMapRef.current.get(releasedNodeId) ?? null
              );
            }
          };
          sigmaRef.current.on("upNode", releaseDraggedNode);
          sigmaRef.current.on("upStage", releaseDraggedNode);
          sigmaRef.current.on("leaveStage", releaseDraggedNode);
          sigmaRef.current.on("enterNode", ({ node }) => {
            setHoveredNodeId(node);
          });
          sigmaRef.current.on("leaveNode", () => {
            setHoveredNodeId(null);
          });
          sigmaRef.current.on("afterRender", () => {
            const renderedSettlement = pendingRenderedSettlementRef.current;
            if (
              renderedSettlement &&
              renderedSettlement.generation === layoutGenerationRef.current &&
              renderedSettlement.tick ===
                performanceSnapshotRef.current.committedPositionTick &&
              renderedSettlement.focusNodeId === focusNodeIdRef.current
            ) {
              performanceSnapshotRef.current.renderedSettledGeneration =
                renderedSettlement.generation;
              performanceSnapshotRef.current.renderedSettledTick =
                renderedSettlement.tick;
              performanceSnapshotRef.current.renderedSettledFocusNodeId =
                renderedSettlement.focusNodeId;
              pendingRenderedSettlementRef.current = null;
              if (renderedSettlement.focusNodeId) {
                const focusToFrame = renderedSettlement.focusNodeId;
                window.requestAnimationFrame(() => {
                  if (focusNodeIdRef.current !== focusToFrame) {
                    return;
                  }
                  lifecycleCallbacksRef.current.updateDesiredCameraFromGraph();
                  void lifecycleCallbacksRef.current.animateCameraToDesired(
                    240
                  );
                });
              }
            }
            performanceSnapshotRef.current.lastRenderAt = performance.now();
            performanceSnapshotRef.current.camera =
              sigmaRef.current?.getCamera().getState() ?? null;
            performanceSnapshotRef.current.displayedLabelNodeIds = [
              ...(sigmaRef.current?.getNodeDisplayedLabels() ?? [])
            ].sort();
            presentationRenderStateRef.current =
              completeKnowledgeGraphPresentationRender(
                presentationRenderStateRef.current
              );
            performanceSnapshotRef.current.requestedPresentationKey =
              presentationRenderStateRef.current.requestedKey;
            performanceSnapshotRef.current.renderedPresentationKey =
              presentationRenderStateRef.current.renderedKey;
            window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__ = {
              ...performanceSnapshotRef.current
            };
            if (performanceSnapshotRef.current.firstUsefulGraphAt === null) {
              performanceSnapshotRef.current.firstUsefulGraphAt =
                performance.now();
              window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__ = {
                ...performanceSnapshotRef.current
              };
            }
            if (!startupFirstFrameHandledRef.current) {
              startupFirstFrameHandledRef.current = true;
              startupPhaseRef.current = "first_frame";
              recordDiagnosticsEvent({
                level: "info",
                eventKey: "first_frame",
                message: "Knowledge graph rendered its first frame.",
                details: {
                  datasetSignature: datasetSignatureRef.current
                }
              });
              verifyStartupInvariant({
                phase: "first_frame",
                allowCorrection: true,
                publishBackendOnFailure: true
              });
              recordSnapshot({
                rendererMode: "sigma",
                publishAnomaly: true
              });
            }
            publishCurrentDiagnostics();
          });
        } else {
          sigmaRef.current.setGraph(nextGraph);
          safeRefreshSigma();
        }

        setFallbackReason(null);
        setFallbackSnapshot(buildFallbackSnapshot(nextGraph, renderedEdges));
        sigmaRef.current
          .getCamera()
          .setState(buildSigmaOverviewCameraState(nextGraph));
        setSigmaReadyEpoch((epoch) => epoch + 1);
      } catch (error) {
        sigmaRef.current?.kill();
        sigmaRef.current = null;
        setFallbackReason(
          error instanceof Error ? error.message : "Graph renderer unavailable."
        );
        setFallbackSnapshot(buildFallbackSnapshot(nextGraph, renderedEdges));
        setFallbackCamera(buildFallbackOverviewCameraState(nextGraph));
        recordDiagnosticsEvent({
          level: "error",
          eventKey: "sigma_fallback",
          message: "Fell back from Sigma to the SVG renderer.",
          publishBackend: true,
          details: {
            datasetSignature,
            reason: error instanceof Error ? error.message : "unknown"
          }
        });
        verifyStartupInvariant({
          phase: "graph_built",
          allowCorrection: true,
          publishBackendOnFailure: true
        });
      }
    }

    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("./knowledge-graph-layout.worker.ts", import.meta.url),
        { type: "module" }
      );
      const applyPositionMessage = (
        pendingMessage: Extract<
          KnowledgeGraphLayoutWorkerResponse,
          { type: "positions" }
        >
      ) => {
        const currentGraph = graphRef.current;
        if (
          !currentGraph ||
          !isKnowledgeGraphPositionMessageCurrent({
            message: pendingMessage,
            generation: layoutGenerationRef.current,
            nodeCount: currentGraph.order
          })
        ) {
          performanceSnapshotRef.current.rejectedPositionMessageCount += 1;
          window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__ = {
            ...performanceSnapshotRef.current
          };
          return;
        }
        let nextX = pendingMessage.x;
        let nextY = pendingMessage.y;
        if (startupPhaseRef.current !== "startup_verified") {
          const recentered = recenterPositionArraysAroundOrigin({
            x: pendingMessage.x,
            y: pendingMessage.y
          });
          if (recentered.changed) {
            nextX = recentered.x;
            nextY = recentered.y;
            workerRef.current?.postMessage({
              type: "recenter-graph",
              offsetX: recentered.offsetX,
              offsetY: recentered.offsetY
            } satisfies KnowledgeGraphLayoutWorkerMessage);
            resetCameraToOrigin();
            recordDiagnosticsEvent({
              level: "warning",
              eventKey: "worker_startup_recenter",
              message:
                "Recentering worker positions during startup because the graph drifted away from origin.",
              details: {
                datasetSignature: datasetSignatureRef.current,
                startupPhase: startupPhaseRef.current,
                offsetX: recentered.offsetX,
                offsetY: recentered.offsetY
              }
            });
          }
        }
        let nodeIndex = 0;
        let squaredDisplacement = 0;
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        currentGraph.updateEachNodeAttributes(
          (_nodeId, attributes) => {
            const x = nextX[nodeIndex]!;
            const y = nextY[nodeIndex++]!;
            squaredDisplacement +=
              (x - attributes.x) ** 2 + (y - attributes.y) ** 2;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            return {
              ...attributes,
              x,
              y
            };
          },
          { attributes: ["x", "y"] }
        );
        if (
          dragStateRef.current &&
          currentGraph.hasNode(dragStateRef.current.nodeId)
        ) {
          const draggedNodeId = dragStateRef.current.nodeId;
          currentGraph.mergeNodeAttributes(draggedNodeId, {
            x: dragStateRef.current.currentX,
            y: dragStateRef.current.currentY
          });
        }
        const now = performance.now();
        const graphDiagonal = Math.max(Math.hypot(maxX - minX, maxY - minY), 1);
        const normalizedRms =
          Math.sqrt(squaredDisplacement / Math.max(currentGraph.order, 1)) /
          graphDiagonal;
        performanceSnapshotRef.current.positionCommitCount += 1;
        performanceSnapshotRef.current.committedPositionTick =
          pendingMessage.tick;
        performanceSnapshotRef.current.lastNormalizedRmsDisplacement =
          normalizedRms;
        if (normalizedRms <= 0.002) {
          stableCandidateSinceRef.current ??= now;
          if (
            performanceSnapshotRef.current.stableLayoutAt === null &&
            now - stableCandidateSinceRef.current >= 500
          ) {
            performanceSnapshotRef.current.stableLayoutAt = now;
            performanceSnapshotRef.current.initialLayoutSettledAt ??= now;
          }
        } else {
          stableCandidateSinceRef.current = null;
          performanceSnapshotRef.current.stableLayoutAt = null;
        }
        const baselineMode = window.__FORGE_KG_POSITION_MODE__ === "baseline";
        if (baselineMode || now - lastPositionCacheAtRef.current >= 250) {
          rememberGraphPositions(currentGraph, positionCacheRef.current);
          lastPositionCacheAtRef.current = now;
        }
        if (sigmaRef.current) {
          const settledMarker = workerSettlementRef.current;
          if (
            settledMarker?.generation === pendingMessage.generation &&
            settledMarker.tick === pendingMessage.tick &&
            settledMarker.focusNodeId === focusNodeIdRef.current
          ) {
            pendingRenderedSettlementRef.current = settledMarker;
          }
          safeRefreshSigma();
        } else {
          setFallbackSnapshot(
            buildFallbackSnapshot(currentGraph, renderedEdges)
          );
        }
        window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__ = {
          ...performanceSnapshotRef.current
        };
      };
      workerRef.current.onmessage = (
        event: MessageEvent<KnowledgeGraphLayoutWorkerResponse>
      ) => {
        if (!graphRef.current) {
          return;
        }
        const message = event.data;
        if (message.generation !== layoutGenerationRef.current) {
          performanceSnapshotRef.current.rejectedPositionMessageCount += 1;
          return;
        }
        if (message.type === "stats") {
          simulationPhaseRef.current = message.phase;
          primaryFocusedNodeIdRef.current = message.primaryFocusedNodeId;
          focusSourcesRef.current = message.focusSources;
          focusPressureRef.current = message.focusPressure;
          centroidRef.current = message.centroid;
          if (message.settled) {
            const settledAt = performance.now();
            performanceSnapshotRef.current.stableLayoutAt ??= settledAt;
            performanceSnapshotRef.current.initialLayoutSettledAt ??= settledAt;
            performanceSnapshotRef.current.settledFocusNodeId =
              message.primaryFocusedNodeId;
            performanceSnapshotRef.current.focusSettledAt = settledAt;
            performanceSnapshotRef.current.workerSettledGeneration =
              message.generation;
            performanceSnapshotRef.current.workerSettledTick = message.tick;
            const settledMarker = {
              generation: message.generation,
              tick: message.tick,
              focusNodeId: message.primaryFocusedNodeId
            };
            workerSettlementRef.current = settledMarker;
            if (
              performanceSnapshotRef.current.committedPositionTick ===
                message.tick &&
              message.primaryFocusedNodeId === focusNodeIdRef.current
            ) {
              pendingRenderedSettlementRef.current = settledMarker;
              safeRefreshSigma();
            }
            window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__ = {
              ...performanceSnapshotRef.current
            };
          }
          if (!startupWorkerVerificationHandledRef.current) {
            startupWorkerVerificationHandledRef.current = true;
            startupPhaseRef.current = "worker_started";
            recordDiagnosticsEvent({
              level: "info",
              eventKey: "worker_started",
              message:
                "Knowledge graph worker reported its first simulation stats.",
              details: {
                datasetSignature: datasetSignatureRef.current,
                phase: message.phase
              }
            });
            verifyStartupInvariant({
              phase: "worker_started",
              allowCorrection: true,
              publishBackendOnFailure: true
            });
          }
          return;
        }
        performanceSnapshotRef.current.workerPositionMessageCount += 1;
        if (window.__FORGE_KG_POSITION_MODE__ === "baseline") {
          applyPositionMessage(message);
          return;
        }
        const commitPendingPositionFrame = () => {
          positionCommitFrameRef.current = null;
          if (performance.now() < cameraInteractionUntilRef.current) {
            positionCommitFrameRef.current = window.requestAnimationFrame(
              commitPendingPositionFrame
            );
            return;
          }
          const pendingMessage = pendingPositionMessageRef.current;
          pendingPositionMessageRef.current = null;
          if (!pendingMessage) {
            return;
          }
          applyPositionMessage(pendingMessage);
        };
        pendingPositionMessageRef.current = message;
        if (positionCommitFrameRef.current !== null) {
          return;
        }
        positionCommitFrameRef.current = window.requestAnimationFrame(
          commitPendingPositionFrame
        );
      };
    }

    const nodeOrder = nextGraph.nodes();
    const nodeIndexById = new Map(
      nodeOrder.map((nodeId, index) => [nodeId, index])
    );
    const hopLevels = buildKnowledgeGraphHopLevelsFromAdjacency(
      nodeOrder,
      graphAdjacency,
      focusNodeId
    );
    performanceSnapshotRef.current.layoutStartedAt = performance.now();
    workerRef.current.postMessage({
      type: "init-graph",
      generation: layoutGenerationRef.current,
      positionPublishIntervalTicks:
        window.__FORGE_KG_POSITION_MODE__ === "baseline" ? 1 : 4,
      transferBuffers: window.__FORGE_KG_POSITION_MODE__ !== "baseline",
      nodes: nodeOrder.map((nodeId) => {
        const attributes = nextGraph.getNodeAttributes(nodeId);
        return {
          id: nodeId,
          x: attributes.x,
          y: attributes.y,
          size: attributes.size,
          mass: Math.max(1, attributes.data.importance / 42),
          importance: attributes.data.importance
        };
      }),
      edges: renderedEdges
        .filter(
          (edge) =>
            nodeIndexById.has(edge.source) && nodeIndexById.has(edge.target)
        )
        .map((edge) => ({
          source: nodeIndexById.get(edge.source)!,
          target: nodeIndexById.get(edge.target)!,
          weight: Math.max(0.6, edge.strength)
        })),
      focusNodeId,
      hopLevels,
      physics: physicsSettings
    } satisfies KnowledgeGraphLayoutWorkerMessage);
    recordDiagnosticsEvent({
      level: "debug",
      eventKey: "worker_init",
      message: "Posted the graph payload to the layout worker.",
      details: {
        datasetSignature,
        nodeCount: nodeOrder.length,
        edgeCount: renderedEdges.length
      }
    });
  }, [
    adaptiveRenderedEdgeCount,
    containerSize,
    datasetSignature,
    diagnosticsEnabled,
    focusNodeId,
    graphAdjacency,
    layoutRevision,
    nodes,
    physicsSettings,
    presentationKey,
    reducedMotion,
    renderedEdges,
    sourceEdgeCount,
    sourceNodeCount,
    visibleNodeIds
  ]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) {
      return;
    }
    applyKnowledgeGraphThemeColors(graph);
    sigmaRef.current?.setSetting(
      "defaultNodeColor",
      resolveKnowledgeGraphThemeColor("--primary")
    );
    sigmaRef.current?.setSetting(
      "defaultEdgeColor",
      fadeKnowledgeGraphColor(
        resolveKnowledgeGraphThemeColor("--info", "rgb(125, 211, 252)"),
        0.1
      )
    );
    setFallbackSnapshot(buildFallbackSnapshot(graph, renderedEdges));
    lifecycleCallbacksRef.current.safeRefreshSigma();
  }, [renderedEdges, themeKey]);

  useEffect(() => {
    const { recordDiagnosticsEvent } = lifecycleCallbacksRef.current;
    const previousFocusNodeId = previousFocusNodeIdRef.current;
    if (
      previousFocusNodeId !== focusNodeId &&
      sigmaRef.current &&
      datasetSignatureRef.current
    ) {
      const cache = cameraStateCacheRef.current;
      const key = `${datasetSignatureRef.current}::focus:${previousFocusNodeId ?? "overview"}`;
      cache.delete(key);
      cache.set(key, sigmaRef.current.getCamera().getState());
      while (cache.size > 48) {
        const oldestKey = cache.keys().next().value;
        if (!oldestKey) {
          break;
        }
        cache.delete(oldestKey);
      }
    }
    previousFocusNodeIdRef.current = focusNodeId;
    if (!workerRef.current || !graphRef.current) {
      return;
    }
    const hopLevels = buildKnowledgeGraphHopLevelsFromAdjacency(
      graphRef.current.nodes(),
      graphAdjacency,
      focusNodeId
    );
    workerRef.current.postMessage({
      type: "set-focus",
      focusNodeId,
      hopLevels
    } satisfies KnowledgeGraphLayoutWorkerMessage);
    recordDiagnosticsEvent({
      level: "debug",
      eventKey: "focus_set",
      message: "Updated the focused node in the graph worker.",
      details: {
        focusNodeId
      }
    });

    if (!focusNodeId) {
      desiredCameraRef.current = null;
    }
  }, [focusNodeId, graphAdjacency]);

  useEffect(() => {
    if (!workerRef.current) {
      return;
    }
    workerRef.current.postMessage({
      type: "update-physics",
      physics: physicsSettings
    } satisfies KnowledgeGraphLayoutWorkerMessage);
  }, [physicsSettings]);

  useEffect(() => {
    const { publishCurrentDiagnostics, recordSnapshot } =
      lifecycleCallbacksRef.current;
    if (
      !diagnosticsEnabled ||
      !graphRef.current ||
      !datasetSignatureRef.current
    ) {
      return;
    }
    const interval = window.setInterval(() => {
      lastDiagnosticsPublishAtRef.current = 0;
      publishCurrentDiagnostics();
      recordSnapshot({
        rendererMode: getCurrentRendererMode(),
        publishAnomaly: true
      });
    }, KNOWLEDGE_GRAPH_PERIODIC_SNAPSHOT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [datasetSignature, diagnosticsEnabled]);

  useEffect(() => {
    const { safeRefreshSigma } = lifecycleCallbacksRef.current;
    if (!sigmaRef.current || !graphRef.current) {
      return;
    }

    sigmaRef.current.setSetting("nodeReducer", (nodeId, attributes) => {
      const node = graphRef.current?.getNodeAttribute(
        nodeId,
        "data"
      ) as KnowledgeGraphNode;
      const cameraRatio = sigmaRef.current?.getCamera().getState().ratio ?? 1;
      const ambientLabelVisible =
        renderQuality === "full" &&
        (node.importance >= 90 ||
          (cameraRatio <= 0.32 && node.importance >= 70));
      return reduceKnowledgeGraphSigmaNodeAttributes({
        nodeId,
        attributes: attributes as SigmaNodeAttributes,
        node,
        focusNodeId,
        relatedNodeIds,
        detailNodeIds,
        hoveredNodeId,
        draggedNodeId,
        presentationVisible:
          visibleNodeIds.has(nodeId) && viewportVisibleNodeIds.has(nodeId),
        ambientLabelVisible
      });
    });
    sigmaRef.current.setSetting("edgeReducer", (edgeId, attributes) => {
      const edge = graphRef.current?.getEdgeAttribute(
        edgeId,
        "data"
      ) as RenderedKnowledgeGraphEdge;
      const preserveAdaptiveEdge =
        preserveVisibleEdges ||
        (!!focusNodeId &&
          (edge.source === focusNodeId || edge.target === focusNodeId)) ||
        (!!hoveredNodeId &&
          (edge.source === hoveredNodeId || edge.target === hoveredNodeId)) ||
        detailNodeIds.has(edge.source) ||
        detailNodeIds.has(edge.target);
      return reduceKnowledgeGraphSigmaEdgeAttributes({
        attributes: attributes as SigmaEdgeAttributes,
        edge,
        focusNodeId,
        detailNodeIds,
        relatedNodeIds,
        hoveredNodeId,
        presentationVisible:
          visibleRenderedEdgeIds.has(edgeId) &&
          viewportVisibleNodeIds.has(edge.source) &&
          viewportVisibleNodeIds.has(edge.target) &&
          shouldRenderKnowledgeGraphEdgeAtQuality({
            edge,
            quality: renderQuality,
            preserve: preserveAdaptiveEdge
          })
      });
    });
    performanceSnapshotRef.current.focusNodeId = focusNodeId;
    performanceSnapshotRef.current.renderedNodeCount =
      viewportVisibleNodeIds.size;
    performanceSnapshotRef.current.renderedNodeIds = [
      ...viewportVisibleNodeIds
    ].sort();
    performanceSnapshotRef.current.forcedLabelNodeIds = [
      ...viewportVisibleNodeIds
    ]
      .filter(
        (nodeId) =>
          nodeId === focusNodeId ||
          nodeId === hoveredNodeId ||
          nodeId === draggedNodeId
      )
      .sort();
    performanceSnapshotRef.current.renderedEdgeCount =
      adaptiveRenderedEdgeCount;
    performanceSnapshotRef.current.minimumRenderedEdgeCount = Math.min(
      performanceSnapshotRef.current.minimumRenderedEdgeCount,
      adaptiveRenderedEdgeCount
    );
    performanceSnapshotRef.current.adaptiveQuality = renderQuality;
    presentationRenderStateRef.current = beginKnowledgeGraphPresentationRender(
      presentationRenderStateRef.current
    );
    safeRefreshSigma();
  }, [
    detailNodeIds,
    adaptiveRenderedEdgeCount,
    draggedNodeId,
    focusNodeId,
    hoveredNodeId,
    preserveVisibleEdges,
    presentationKey,
    relatedNodeIds,
    renderQuality,
    sigmaReadyEpoch,
    visibleRenderedEdgeIds,
    visibleNodeIds,
    viewportVisibleNodeIds
  ]);

  useEffect(() => {
    const {
      buildCurrentStatus,
      recordDiagnosticsEvent,
      recordSnapshot,
      verifyStartupInvariant
    } = lifecycleCallbacksRef.current;
    if (
      !fallbackSnapshot ||
      !datasetSignatureRef.current ||
      containerSize.width <= 0 ||
      containerSize.height <= 0
    ) {
      return;
    }
    if (!fallbackReason && sigmaRef.current) {
      return;
    }
    if (!startupFirstFrameHandledRef.current) {
      startupFirstFrameHandledRef.current = true;
      startupPhaseRef.current = "first_frame";
      recordDiagnosticsEvent({
        level: "info",
        eventKey: "fallback_first_frame",
        message: "Knowledge graph rendered its first fallback frame.",
        details: {
          datasetSignature: datasetSignatureRef.current,
          reason: fallbackReason
        }
      });
      verifyStartupInvariant({
        phase: "first_frame",
        allowCorrection: true,
        publishBackendOnFailure: true
      });
      recordSnapshot({
        rendererMode: "fallback",
        publishAnomaly: true
      });
    }
    publishFallbackKnowledgeGraphDiagnostics({
      datasetSignature: datasetSignatureRef.current,
      focusNodeId,
      primaryFocusedNodeId: primaryFocusedNodeIdRef.current,
      draggedNodeId: dragStateRef.current?.nodeId ?? null,
      layoutGeneration: layoutGenerationRef.current,
      camera: fallbackCamera,
      snapshot: fallbackSnapshot,
      width: containerSize.width,
      height: containerSize.height,
      startupPhase: startupPhaseRef.current,
      startupInvariantSatisfied:
        buildCurrentStatus({ rendererMode: "fallback" })
          ?.startupInvariantSatisfied ?? false,
      simulationPhase: simulationPhaseRef.current,
      focusSources: focusSourcesRef.current,
      focusPressure: focusPressureRef.current,
      centroid: centroidRef.current,
      cameraTarget: desiredCameraRef.current
        ? {
            x: desiredCameraRef.current.x,
            y: desiredCameraRef.current.y,
            ratio: desiredCameraRef.current.ratio
          }
        : null,
      latestSnapshotAt: latestSnapshotAtRef.current,
      latestSnapshotNodeCount: latestSnapshotNodeCountRef.current
    });
  }, [
    containerSize.height,
    containerSize.width,
    fallbackCamera,
    fallbackReason,
    fallbackSnapshot,
    focusNodeId
  ]);

  const fallbackProjectedNodes = useMemo(() => {
    if (
      !fallbackSnapshot ||
      containerSize.width <= 0 ||
      containerSize.height <= 0
    ) {
      return [] as Array<
        FallbackGraphNode & {
          viewportX: number;
          viewportY: number;
          viewportSize: number;
        }
      >;
    }

    return fallbackSnapshot.nodes.map((node) => {
      const projected = projectFallbackNode({
        node,
        snapshot: fallbackSnapshot,
        camera: fallbackCamera,
        width: containerSize.width,
        height: containerSize.height
      });
      return {
        ...node,
        viewportX: projected.x,
        viewportY: projected.y,
        viewportSize: projected.size
      };
    });
  }, [
    containerSize.height,
    containerSize.width,
    fallbackCamera,
    fallbackSnapshot
  ]);

  const fallbackViewportNodeIds = useMemo(
    () =>
      buildKnowledgeGraphViewportNodeIds({
        nodes: fallbackProjectedNodes.filter((node) =>
          visibleNodeIds.has(node.id)
        ),
        width: containerSize.width,
        height: containerSize.height,
        padding: renderQuality === "full" ? 140 : 64,
        preserveNodeIds: new Set([
          ...(focusNodeId ? [focusNodeId] : []),
          ...detailNodeIds,
          ...(hoveredNodeId ? [hoveredNodeId] : [])
        ]),
        preserveAll: preserveVisibleEdges
      }),
    [
      containerSize.height,
      containerSize.width,
      detailNodeIds,
      fallbackProjectedNodes,
      focusNodeId,
      hoveredNodeId,
      renderQuality,
      preserveVisibleEdges,
      visibleNodeIds
    ]
  );
  const visibleFallbackProjectedNodes = useMemo(
    () =>
      fallbackProjectedNodes.filter((node) =>
        fallbackViewportNodeIds.has(node.id)
      ),
    [fallbackProjectedNodes, fallbackViewportNodeIds]
  );

  const fallbackNodeMap = useMemo(
    () => new Map(fallbackProjectedNodes.map((node) => [node.id, node])),
    [fallbackProjectedNodes]
  );

  const handleKeyboardNavigation = (event: KeyboardEvent<HTMLDivElement>) => {
    let nodePositions = new Map<string, { x: number; y: number }>();
    if (sigmaRef.current && graphRef.current) {
      graphRef.current.forEachNode((nodeId, attributes) => {
        nodePositions.set(
          nodeId,
          sigmaRef.current!.graphToViewport({
            x: attributes.x,
            y: attributes.y
          })
        );
      });
    } else {
      nodePositions = buildKnowledgeGraphFallbackKeyboardPositions(
        fallbackProjectedNodes
      );
    }
    const target = resolveKnowledgeGraphKeyboardTarget({
      key: event.key,
      nodeIds: nodes.map((node) => node.id),
      focusNodeId,
      nodePositions
    });
    if (!target.handled) {
      return;
    }
    event.preventDefault();
    onSelectNodeRef.current(
      target.targetNodeId
        ? (nodeMapRef.current.get(target.targetNodeId) ?? null)
        : null
    );
  };

  const focusedNode = focusNodeId
    ? (nodes.find((node) => node.id === focusNodeId) ?? null)
    : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--ui-surface-0)]">
      <div
        ref={containerRef}
        className="h-full w-full touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]/45"
        role="application"
        tabIndex={0}
        aria-label={`Knowledge graph canvas, ${visibleNodeIds.size} of ${nodes.length} retained nodes drawn${focusedNode ? `, focused on ${focusedNode.title}` : ""}`}
        aria-describedby="knowledge-graph-canvas-help"
        onKeyDown={handleKeyboardNavigation}
      >
        <span id="knowledge-graph-canvas-help" className="sr-only">
          Use arrow keys to move between nodes, Home or End to jump, Enter or
          Space to inspect the focused node, and Escape to clear focus. Keyboard
          navigation includes retained nodes that the calm overview has not
          drawn yet; focusing one reveals it and its direct context.
        </span>
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {focusedNode
            ? `${focusedNode.title}. ${focusedNode.subtitle}`
            : "No graph node focused."}
        </span>
        {fallbackReason && fallbackSnapshot ? (
          <svg
            className="h-full w-full"
            viewBox={`0 0 ${Math.max(containerSize.width, 1)} ${Math.max(containerSize.height, 1)}`}
            aria-hidden="true"
          >
            <title>Knowledge graph fallback canvas</title>
            <rect
              x="0"
              y="0"
              width={Math.max(containerSize.width, 1)}
              height={Math.max(containerSize.height, 1)}
              fill="transparent"
              onClick={() => onSelectNodeRef.current(null)}
            />
            {fallbackSnapshot.edges
              .filter((edge) => {
                const preserveAdaptiveEdge =
                  preserveVisibleEdges ||
                  (!!focusNodeId &&
                    (edge.source === focusNodeId ||
                      edge.target === focusNodeId)) ||
                  (!!hoveredNodeId &&
                    (edge.source === hoveredNodeId ||
                      edge.target === hoveredNodeId)) ||
                  detailNodeIds.has(edge.source) ||
                  detailNodeIds.has(edge.target);
                return (
                  visibleRenderedEdgeIds.has(edge.id) &&
                  fallbackViewportNodeIds.has(edge.source) &&
                  fallbackViewportNodeIds.has(edge.target) &&
                  shouldRenderKnowledgeGraphEdgeAtQuality({
                    edge,
                    quality: renderQuality,
                    preserve: preserveAdaptiveEdge
                  })
                );
              })
              .map((edge) => {
                const source = fallbackNodeMap.get(edge.source);
                const target = fallbackNodeMap.get(edge.target);
                if (!source || !target) {
                  return null;
                }
                const touchesFocus =
                  !!focusNodeId &&
                  (edge.source === focusNodeId || edge.target === focusNodeId);
                const touchesHover =
                  !!hoveredNodeId &&
                  (edge.source === hoveredNodeId ||
                    edge.target === hoveredNodeId);
                const sourceDistance = !focusNodeId
                  ? 0
                  : edge.source === focusNodeId
                    ? 0
                    : detailNodeIds.has(edge.source)
                      ? 1
                      : relatedNodeIds.has(edge.source)
                        ? 2
                        : 3;
                const targetDistance = !focusNodeId
                  ? 0
                  : edge.target === focusNodeId
                    ? 0
                    : detailNodeIds.has(edge.target)
                      ? 1
                      : relatedNodeIds.has(edge.target)
                        ? 2
                        : 3;
                const edgeDistance = focusNodeId
                  ? Math.max(sourceDistance, targetDistance)
                  : 0;
                return (
                  <line
                    key={edge.id}
                    x1={source.viewportX}
                    y1={source.viewportY}
                    x2={target.viewportX}
                    y2={target.viewportY}
                    stroke={
                      touchesFocus
                        ? buildKnowledgeGraphEdgeStroke(edge, 0.24)
                        : touchesHover
                          ? buildKnowledgeGraphEdgeStroke(edge, 0.14)
                          : !focusNodeId
                            ? buildKnowledgeGraphEdgeStroke(edge, 0.055)
                            : edgeDistance <= 1
                              ? buildKnowledgeGraphEdgeStroke(edge, 0.09)
                              : edgeDistance === 2
                                ? buildKnowledgeGraphEdgeStroke(edge, 0.05)
                                : buildKnowledgeGraphEdgeStroke(edge, 0.016)
                    }
                    strokeWidth={touchesFocus ? 1.7 : touchesHover ? 1.3 : 0.95}
                  />
                );
              })}
            {visibleFallbackProjectedNodes.map((node) => {
              const focused = focusNodeId === node.id;
              const related = relatedNodeIds.has(node.id);
              const detailed = detailNodeIds.has(node.id);
              const hovered = hoveredNodeId === node.id;
              const inNeighborhood = !focusNodeId || related;
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.viewportX}, ${node.viewportY})`}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    const nextNode = nodeMapRef.current.get(node.id) ?? null;
                    onSelectNodeRef.current(nextNode);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    r={
                      focused
                        ? node.viewportSize * 1.9
                        : hovered
                          ? node.viewportSize * 1.3
                          : detailed
                            ? node.viewportSize * 1.15
                            : related
                              ? node.viewportSize * 1.05
                              : node.viewportSize
                    }
                    fill={
                      inNeighborhood
                        ? node.color
                        : fadeKnowledgeGraphColor(node.color, 0.3)
                    }
                    stroke={
                      focused
                        ? "var(--ui-border-strong)"
                        : "var(--ui-border-subtle)"
                    }
                    strokeWidth={focused ? 2 : 1}
                  />
                  {(focused ||
                    hovered ||
                    node.data.importance >= 90 ||
                    (fallbackCamera.ratio <= 0.65 &&
                      node.data.importance >= 70)) && (
                    <text
                      x={node.viewportSize * 1.5}
                      y={4}
                      fill="var(--ui-ink-strong)"
                      fontSize="12"
                    >
                      {node.data.title}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        ) : null}
      </div>
      {fallbackReason ? (
        <div
          role="status"
          className="pointer-events-none absolute right-3 top-16 z-10 max-w-[15rem] rounded-[16px] border border-[var(--ui-border-subtle)] bg-[color-mix(in_srgb,var(--ui-surface-1)_92%,transparent)] px-3 py-2 shadow-[var(--ui-shadow-soft)] backdrop-blur-xl md:right-6 md:top-20"
        >
          <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Reduced graphics mode
          </div>
          <p className="mt-1 text-[10px] leading-4 text-[var(--ui-ink-soft)]">
            The full graph remains searchable and keyboard accessible while
            Forge uses the compatible renderer.
          </p>
        </div>
      ) : null}
    </div>
  );
});
