import {
  Background,
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
  type Viewport
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  Maximize2,
  Minus,
  Plus
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildKnowledgeGraphHierarchyModel,
  getKnowledgeGraphHierarchyAncestors,
  getKnowledgeGraphHierarchyConnectedNodeIds,
  getKnowledgeGraphHierarchyDirectLinkedNodeIds,
  resolveKnowledgeGraphFocusedHierarchyVisibleIds,
  resolveKnowledgeGraphHierarchyVisibleEdges,
  resolveKnowledgeGraphHierarchyVisibleIds,
  toggleKnowledgeGraphHierarchyBranch
} from "@/components/knowledge-graph/knowledge-graph-hierarchy-model";
import {
  getKnowledgeGraphSemanticGroup,
  KNOWLEDGE_GRAPH_SEMANTIC_GROUPS
} from "@/components/knowledge-graph/knowledge-graph-theme";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { getKnowledgeGraphFocusRelatedNodeIds } from "@/lib/knowledge-graph";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode
} from "@/lib/knowledge-graph-types";

const LANE_WIDTH = 336;
const ROW_HEIGHT = 184;
const FOCUS_ROW_HEIGHT = 208;
const FOCUS_MOBILE_INDENT = 44;
const FULL_LANE_Y = 24;
const FULL_ENTITY_START_Y = 120;
const FOCUS_ROOT_Y = 88;
const FOCUS_MOBILE_CHILD_START_Y = 300;
const FOCUS_MOBILE_ROW_HEIGHT = 200;
const HIERARCHY_GROUPS = Object.entries(KNOWLEDGE_GRAPH_SEMANTIC_GROUPS).map(
  ([id, group]) => ({ id, label: group.label, description: group.description })
);

type HierarchyEntityCardData = {
  kind: "entity";
  graphNode: KnowledgeGraphNode;
  childCount: number;
  countNoun: "child item" | "linked item";
  focused: boolean;
  highlighted: boolean;
  expanded: boolean;
  hasParent: boolean;
  stackedMobile: boolean;
  showBothSideHandles: boolean;
  onActivate: () => void;
  onOpen: () => void;
};

type HierarchyLaneCardData = {
  kind: "lane";
  label: string;
  count: number;
  active: boolean;
  onActivate: () => void;
};

type HierarchyCardData = HierarchyEntityCardData | HierarchyLaneCardData;

type HierarchyFlowNode = Node<HierarchyCardData, "hierarchyCard">;

type HierarchyEdgeData = {
  parallelOffset: number;
};

function HierarchyRelationshipEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  data
}: EdgeProps<Edge<HierarchyEdgeData>>) {
  const horizontalDistance = Math.abs(targetX - sourceX);
  const controlDistance = Math.max(56, horizontalDistance * 0.42);
  const direction = targetX >= sourceX ? 1 : -1;
  const parallelOffset = data?.parallelOffset ?? 0;
  const path = [
    `M ${sourceX} ${sourceY}`,
    `C ${sourceX + controlDistance * direction} ${sourceY + parallelOffset},`,
    `${targetX - controlDistance * direction} ${targetY + parallelOffset},`,
    `${targetX} ${targetY}`
  ].join(" ");
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} />;
}

const edgeTypes = {
  hierarchyRelationship: HierarchyRelationshipEdge
} satisfies EdgeTypes;

const HierarchyCardNode = memo(function HierarchyCardNode({
  data
}: NodeProps<HierarchyFlowNode>) {
  if (data.kind === "lane") {
    return (
      <div
        className="relative w-[17rem] rounded-[20px] border shadow-[var(--ui-shadow-soft)] transition"
        style={{
          borderColor: data.active
            ? "var(--ui-border-strong)"
            : "var(--ui-border-subtle)",
          background: data.active
            ? "var(--ui-surface-active)"
            : "var(--ui-surface-1)"
        }}
      >
        <button
          type="button"
          className="nodrag nopan flex w-full items-center gap-3 rounded-[20px] px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/65 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ui-surface-0)]"
          onClick={(event) => {
            event.stopPropagation();
            data.onActivate();
          }}
          aria-label={`${data.label}, ${data.count} items, ${data.active ? "expanded" : "collapsed"}`}
          aria-expanded={data.active}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-xs font-semibold text-[var(--ui-ink-strong)]">
            {data.count}
          </div>
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Knowledge group
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
              {data.label}
            </div>
          </div>
          <ChevronRight
            className={`ml-auto size-4 shrink-0 text-[var(--ui-ink-faint)] transition ${data.active ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>
    );
  }
  const {
    graphNode,
    childCount,
    countNoun,
    focused,
    highlighted,
    expanded,
    hasParent,
    stackedMobile,
    showBothSideHandles
  } = data;
  return (
    <div
      className="relative w-[17rem] rounded-[20px] border shadow-[var(--ui-shadow-soft)] transition"
      style={{
        borderColor: focused
          ? "var(--ui-border-strong)"
          : "var(--ui-border-subtle)",
        background: focused
          ? "var(--ui-surface-active)"
          : "var(--ui-surface-1)",
        opacity: highlighted ? 1 : 0.34
      }}
    >
      {(!stackedMobile && hasParent) || showBothSideHandles ? (
        <Handle
          id="target-left"
          type="target"
          position={Position.Left}
          className="!size-2.5 !border-2 !border-[var(--ui-surface-1)] !bg-[var(--ui-border-strong)]"
        />
      ) : null}
      {stackedMobile && hasParent && !showBothSideHandles ? (
        <Handle
          id="target-right"
          type="target"
          position={Position.Right}
          className="!top-[44%] !size-2.5 !border-2 !border-[var(--ui-surface-1)] !bg-[var(--ui-border-strong)]"
        />
      ) : null}
      {childCount > 0 || showBothSideHandles ? (
        <Handle
          id="source-right"
          type="source"
          position={Position.Right}
          className="!size-2.5 !border-2 !border-[var(--ui-surface-1)] !bg-[var(--primary)]"
        />
      ) : null}
      {showBothSideHandles ? (
        <>
          <Handle
            id="source-left"
            type="source"
            position={Position.Left}
            className="!top-[56%] !size-2.5 !border-2 !border-[var(--ui-surface-1)] !bg-[var(--primary)]"
          />
          <Handle
            id="target-right"
            type="target"
            position={Position.Right}
            className="!top-[56%] !size-2.5 !border-2 !border-[var(--ui-surface-1)] !bg-[var(--ui-border-strong)]"
          />
        </>
      ) : null}
      <button
        type="button"
        className="nodrag nopan block min-h-[9.5rem] w-full rounded-[20px] px-3.5 py-3 pb-[5rem] pr-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/65 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ui-surface-0)]"
        onClick={(event) => {
          event.stopPropagation();
          data.onActivate();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          data.onOpen();
        }}
        aria-label={`${graphNode.title}, ${graphNode.entityKind.replaceAll("_", " ")}${childCount > 0 ? `, ${childCount} ${countNoun}${childCount === 1 ? "" : "s"}, ${expanded ? "expanded" : "collapsed"}` : ""}`}
        aria-expanded={childCount > 0 ? expanded : undefined}
        aria-pressed={focused}
      >
        <div className="flex min-w-0 items-center gap-2">
          <EntityBadge
            kind={graphNode.entityKind}
            label={graphNode.entityKind.replaceAll("_", " ")}
            compact
            gradient={focused}
          />
          {childCount > 0 ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2 py-1 text-[9px] text-[var(--ui-ink-faint)]">
              <ChevronRight
                className={`size-3 transition ${expanded ? "rotate-90" : ""}`}
                aria-hidden="true"
              />
              {childCount}
            </span>
          ) : null}
        </div>
        <div className="mt-2.5">
          <EntityName
            kind={graphNode.entityKind}
            label={graphNode.title}
            className="max-w-full"
            lines={2}
          />
        </div>
        {graphNode.subtitle ? (
          <div className="mt-1.5 line-clamp-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
            {graphNode.subtitle}
          </div>
        ) : null}
      </button>
      <button
        type="button"
        className="nodrag nopan absolute right-2.5 bottom-2.5 inline-flex min-h-14 min-w-14 items-center justify-center gap-1 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3.5 text-[10px] font-medium text-[var(--ui-ink-soft)] transition hover:border-[var(--ui-border-strong)] hover:text-[var(--ui-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/65"
        onClick={(event) => {
          event.stopPropagation();
          data.onOpen();
        }}
        aria-label={`Open ${graphNode.title} in Forge`}
      >
        Open
        <ExternalLink className="size-2.5" aria-hidden="true" />
      </button>
    </div>
  );
});

const nodeTypes = {
  hierarchyCard: HierarchyCardNode
} satisfies NodeTypes;

export function KnowledgeGraphHierarchyView({
  nodes,
  edges,
  focusNodeId,
  focusPanelLinkedItemCount,
  showSecondaryEdges,
  onSelectNode,
  onClearFocus,
  onOpenNode,
  onNavigateNode,
  isMobile
}: {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  focusNodeId: string | null;
  focusPanelLinkedItemCount: number;
  showSecondaryEdges: boolean;
  onSelectNode: (node: KnowledgeGraphNode) => void;
  onClearFocus: () => void;
  onOpenNode: (node: KnowledgeGraphNode) => void;
  onNavigateNode: (node: KnowledgeGraphNode) => void;
  isMobile: boolean;
}) {
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () => new Set()
  );
  const [expandAll, setExpandAll] = useState(false);
  const [expandedLaneId, setExpandedLaneId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<
    HierarchyFlowNode,
    Edge
  > | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1280, height: 720 });
  const hierarchyDefaultZoom = 0.82;
  const hierarchyMinimumZoom = isMobile ? 0.82 : 0.72;
  const [viewport, setViewport] = useState<Viewport>({
    x: 0,
    y: 0,
    zoom: hierarchyDefaultZoom
  });
  useEffect(() => {
    if (!canvasRef.current) return;
    const updateSize = () => {
      if (!canvasRef.current) return;
      setCanvasSize({
        width: canvasRef.current.clientWidth,
        height: canvasRef.current.clientHeight
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, []);
  const model = useMemo(
    () => buildKnowledgeGraphHierarchyModel(nodes, edges),
    [edges, nodes]
  );
  const focusGraphNode =
    focusNodeId && model.nodeById.has(focusNodeId)
      ? model.nodeById.get(focusNodeId)!
      : null;
  const focusLaneId = focusGraphNode
    ? getKnowledgeGraphSemanticGroup(focusGraphNode.entityKind)
    : null;
  const focusDirectLinkedIds = useMemo(
    () =>
      focusGraphNode
        ? getKnowledgeGraphHierarchyDirectLinkedNodeIds(
            model,
            focusGraphNode.id,
            showSecondaryEdges
          )
        : new Set<string>(),
    [focusGraphNode, model, showSecondaryEdges]
  );
  const focusAllConnectedIds = useMemo(
    () =>
      focusGraphNode
        ? getKnowledgeGraphHierarchyConnectedNodeIds(
            model,
            focusGraphNode.id,
            showSecondaryEdges
          )
        : new Set<string>(),
    [focusGraphNode, model, showSecondaryEdges]
  );
  useEffect(() => {
    if (!focusGraphNode || focusLaneId === null) {
      return;
    }
    setExpandAll(false);
    setExpandedLaneId(focusLaneId);
    setExpandedNodeIds(new Set([focusGraphNode.id]));
  }, [focusGraphNode, focusLaneId]);
  const visibleNodeIds = useMemo(() => {
    if (focusGraphNode) {
      return resolveKnowledgeGraphFocusedHierarchyVisibleIds({
        model,
        focusNodeId: focusGraphNode.id,
        expandAll,
        includeSecondary: showSecondaryEdges
      });
    }
    const candidateIds = resolveKnowledgeGraphHierarchyVisibleIds({
      model,
      expandedNodeIds,
      expandAll,
      focusNodeId
    });
    if (expandAll) return candidateIds;
    if (expandedNodeIds.size > 0) {
      const selectedId = [...expandedNodeIds].at(-1)!;
      let selectedRootId = selectedId;
      while (model.parentById.has(selectedRootId)) {
        selectedRootId = model.parentById.get(selectedRootId)!;
      }
      return new Set(
        [...candidateIds].filter((nodeId) => {
          let rootId = nodeId;
          while (model.parentById.has(rootId)) {
            rootId = model.parentById.get(rootId)!;
          }
          return rootId === selectedRootId;
        })
      );
    }
    const activeLaneId = focusLaneId ?? expandedLaneId;
    if (!activeLaneId) return new Set<string>();
    return new Set(
      [...candidateIds].filter(
        (nodeId) =>
          model.nodeById.has(nodeId) &&
          getKnowledgeGraphSemanticGroup(
            model.nodeById.get(nodeId)!.entityKind
          ) === activeLaneId
      )
    );
  }, [
    expandAll,
    expandedLaneId,
    expandedNodeIds,
    focusGraphNode,
    focusLaneId,
    focusNodeId,
    model,
    showSecondaryEdges
  ]);
  const highlightedIds = useMemo(
    () =>
      focusNodeId
        ? getKnowledgeGraphFocusRelatedNodeIds(focusNodeId, edges)
        : new Set<string>(),
    [edges, focusNodeId]
  );
  const focusAncestorIds = useMemo(() => {
    if (!focusNodeId || !model.nodeById.has(focusNodeId)) return [] as string[];
    return getKnowledgeGraphHierarchyAncestors(model, focusNodeId);
  }, [focusNodeId, model]);
  const focusDescendantIds = useMemo(() => {
    if (!focusGraphNode) {
      return new Set<string>();
    }
    return new Set(
      [...visibleNodeIds].filter((nodeId) => nodeId !== focusGraphNode.id)
    );
  }, [focusGraphNode, visibleNodeIds]);
  const focusDepthById = useMemo(() => {
    const depthById = new Map<string, number>();
    if (!focusGraphNode) return depthById;
    depthById.set(focusGraphNode.id, 0);
    const queue = [focusGraphNode.id];
    for (let index = 0; index < queue.length; index += 1) {
      const sourceId = queue[index]!;
      const sourceDepth = depthById.get(sourceId) ?? 0;
      for (const linkedId of getKnowledgeGraphHierarchyDirectLinkedNodeIds(
        model,
        sourceId,
        showSecondaryEdges
      )) {
        if (!visibleNodeIds.has(linkedId) || depthById.has(linkedId)) continue;
        depthById.set(linkedId, sourceDepth + 1);
        queue.push(linkedId);
      }
    }
    return depthById;
  }, [focusGraphNode, model, showSecondaryEdges, visibleNodeIds]);
  const focusParentNode = focusGraphNode
    ? (model.nodeById.get(model.parentById.get(focusGraphNode.id) ?? "") ??
      null)
    : null;
  const focusPathLabel = focusAncestorIds
    .map((nodeId) => model.nodeById.get(nodeId)?.title ?? null)
    .filter((title): title is string => Boolean(title))
    .join(" → ");
  const focusLinkedItemLabel = expandAll
    ? `${focusDescendantIds.size} connected item${focusDescendantIds.size === 1 ? "" : "s"}`
    : `${focusDirectLinkedIds.size} directly linked item${focusDirectLinkedIds.size === 1 ? "" : "s"}`;
  const focusRelatedLabel = `${focusPanelLinkedItemCount} unique linked item${focusPanelLinkedItemCount === 1 ? "" : "s"} in Focus panel`;
  const focusPathTailLabel =
    focusAncestorIds.length > 0
      ? (model.nodeById.get(focusAncestorIds[focusAncestorIds.length - 1] ?? "")
          ?.title ?? focusPathLabel)
      : null;
  const fullHierarchyTitle =
    expandAll || expandedLaneId || expandedNodeIds.size > 0
      ? `${visibleNodeIds.size} of ${nodes.length} knowledge items shown`
      : `${nodes.length} knowledge items available`;
  const activateLane = useCallback(
    (laneId: string) => {
      setExpandAll(false);
      setExpandedNodeIds(new Set());
      setExpandedLaneId((current) => (current === laneId ? null : laneId));
      onClearFocus();
    },
    [onClearFocus]
  );
  const activateEntity = useCallback(
    (graphNode: KnowledgeGraphNode) => {
      if (focusGraphNode) {
        setExpandAll(false);
        setExpandedLaneId(getKnowledgeGraphSemanticGroup(graphNode.entityKind));
        setExpandedNodeIds(new Set([graphNode.id]));
        onSelectNode(graphNode);
        return;
      }
      if ((model.childrenById.get(graphNode.id)?.length ?? 0) > 0) {
        setExpandAll(false);
        setExpandedLaneId(getKnowledgeGraphSemanticGroup(graphNode.entityKind));
        setExpandedNodeIds((current) =>
          toggleKnowledgeGraphHierarchyBranch(model, current, graphNode.id)
        );
      }
      onSelectNode(graphNode);
    },
    [focusGraphNode, model, onSelectNode]
  );
  const openEntity = useCallback(
    (graphNode: KnowledgeGraphNode) => {
      onNavigateNode(graphNode);
    },
    [onNavigateNode]
  );
  const allFlowNodes = useMemo(() => {
    const rowsByLayer = new Map<number, number>();
    const focusRowsByDepth = new Map<number, number>();
    let focusMobileRow = 0;
    const entityNodes = model.nodes
      .filter((node) => visibleNodeIds.has(node.id))
      .map((node): HierarchyFlowNode => {
        const focused = node.id === focusNodeId;
        const row = rowsByLayer.get(node.layer) ?? 0;
        rowsByLayer.set(node.layer, row + 1);
        let position = {
          x: 64 + node.layer * LANE_WIDTH,
          y: FULL_ENTITY_START_Y + row * ROW_HEIGHT
        };
        if (focusGraphNode) {
          if (focused) {
            position = { x: isMobile ? 24 : 64, y: FOCUS_ROOT_Y };
          } else if (focusDescendantIds.has(node.id)) {
            const relativeLayer = focusDepthById.get(node.id) ?? 1;
            if (isMobile) {
              position = {
                x: 24 + Math.min(relativeLayer * FOCUS_MOBILE_INDENT, 96),
                y:
                  FOCUS_MOBILE_CHILD_START_Y +
                  focusMobileRow * FOCUS_MOBILE_ROW_HEIGHT
              };
              focusMobileRow += 1;
            } else {
              const focusRow = focusRowsByDepth.get(relativeLayer) ?? 0;
              focusRowsByDepth.set(relativeLayer, focusRow + 1);
              position = {
                x: 64 + relativeLayer * LANE_WIDTH,
                y: 180 + focusRow * FOCUS_ROW_HEIGHT
              };
            }
          }
        }
        return {
          id: node.id,
          type: "hierarchyCard",
          draggable: false,
          selectable: false,
          position,
          data: {
            kind: "entity",
            graphNode: node,
            childCount: focusGraphNode
              ? getKnowledgeGraphHierarchyDirectLinkedNodeIds(
                  model,
                  node.id,
                  showSecondaryEdges
                ).size
              : (model.childrenById.get(node.id)?.length ?? 0),
            countNoun: focusGraphNode ? "linked item" : "child item",
            focused,
            highlighted:
              !focusNodeId ||
              highlightedIds.has(node.id) ||
              focusDescendantIds.has(node.id),
            expanded: expandAll || expandedNodeIds.has(node.id),
            hasParent: focusGraphNode
              ? node.id !== focusGraphNode.id
              : model.parentById.has(node.id),
            stackedMobile: isMobile && Boolean(focusGraphNode),
            showBothSideHandles: showSecondaryEdges,
            onActivate: () => activateEntity(node),
            onOpen: () => openEntity(node)
          },
          style: { background: "transparent", border: "none", padding: 0 }
        };
      });
    const laneNodes = focusNodeId
      ? []
      : HIERARCHY_GROUPS.map(
          (lane, index): HierarchyFlowNode => ({
            id: `lane:${lane.id}`,
            type: "hierarchyCard",
            draggable: false,
            selectable: false,
            position: {
              x: 64 + index * LANE_WIDTH,
              y: FULL_LANE_Y
            },
            data: {
              kind: "lane",
              label: lane.label,
              count: model.nodes.filter(
                (node) =>
                  getKnowledgeGraphSemanticGroup(node.entityKind) === lane.id
              ).length,
              active:
                expandAll ||
                expandedLaneId === lane.id ||
                (focusNodeId
                  ? model.nodeById.has(focusNodeId) &&
                    getKnowledgeGraphSemanticGroup(
                      model.nodeById.get(focusNodeId)!.entityKind
                    ) === lane.id
                  : false),
              onActivate: () => activateLane(lane.id)
            },
            style: { background: "transparent", border: "none", padding: 0 }
          })
        );
    return [...laneNodes, ...entityNodes];
  }, [
    activateEntity,
    activateLane,
    expandAll,
    expandedLaneId,
    expandedNodeIds,
    focusGraphNode,
    focusNodeId,
    focusDescendantIds,
    focusDepthById,
    highlightedIds,
    isMobile,
    model,
    openEntity,
    showSecondaryEdges,
    visibleNodeIds
  ]);
  const flowNodes = useMemo(() => {
    if (allFlowNodes.length <= 200) return allFlowNodes;
    const zoom = Math.max(0.08, viewport.zoom);
    const paddingX = 360 / zoom;
    const paddingY = 300 / zoom;
    const worldLeft = -viewport.x / zoom - paddingX;
    const worldRight = (canvasSize.width - viewport.x) / zoom + paddingX;
    const worldTop = -viewport.y / zoom - paddingY;
    const worldBottom = (canvasSize.height - viewport.y) / zoom + paddingY;
    return allFlowNodes.filter(
      (node) =>
        node.id.startsWith("lane:") ||
        (node.position.x + 272 >= worldLeft &&
          node.position.x <= worldRight &&
          node.position.y + 116 >= worldTop &&
          node.position.y <= worldBottom)
    );
  }, [allFlowNodes, canvasSize.height, canvasSize.width, viewport]);
  const renderedFlowNodeIds = useMemo(
    () => new Set(flowNodes.map((node) => node.id)),
    [flowNodes]
  );
  const renderedFlowNodeById = useMemo(
    () => new Map(flowNodes.map((node) => [node.id, node])),
    [flowNodes]
  );
  const flowEdges = useMemo((): Edge[] => {
    const visibleEdges = resolveKnowledgeGraphHierarchyVisibleEdges({
      model,
      visibleNodeIds: renderedFlowNodeIds,
      includeSecondary: showSecondaryEdges
    });
    const pairCountByKey = new Map<string, number>();
    for (const edge of visibleEdges) {
      const pairKey = [edge.source, edge.target].sort().join("\u0000");
      pairCountByKey.set(pairKey, (pairCountByKey.get(pairKey) ?? 0) + 1);
    }
    const pairIndexByKey = new Map<string, number>();
    return visibleEdges.map((edge): Edge => {
      const pairKey = [edge.source, edge.target].sort().join("\u0000");
      const pairCount = pairCountByKey.get(pairKey) ?? 1;
      const pairIndex = pairIndexByKey.get(pairKey) ?? 0;
      pairIndexByKey.set(pairKey, pairIndex + 1);
      const sourceX = renderedFlowNodeById.get(edge.source)?.position.x ?? 0;
      const targetX = renderedFlowNodeById.get(edge.target)?.position.x ?? 0;
      const travelsLeft = showSecondaryEdges && sourceX > targetX;
      const highlighted =
        !focusNodeId ||
        edge.source === focusNodeId ||
        edge.target === focusNodeId ||
        (focusDescendantIds.has(edge.source) &&
          focusDescendantIds.has(edge.target));
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: travelsLeft ? "source-left" : "source-right",
        targetHandle:
          focusGraphNode && isMobile && !showSecondaryEdges
            ? "target-right"
            : travelsLeft
              ? "target-right"
              : "target-left",
        type: "hierarchyRelationship",
        data: {
          parallelOffset: (pairIndex - (pairCount - 1) / 2) * 22
        } satisfies HierarchyEdgeData,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edge.secondary
            ? "var(--ui-border-subtle)"
            : "var(--ui-border-strong)"
        },
        style: {
          opacity: highlighted ? 0.9 : 0.16,
          stroke: edge.secondary
            ? "var(--ui-border-subtle)"
            : edge.family === "taxonomy"
              ? "var(--success)"
              : edge.family === "structural"
                ? "var(--ui-border-strong)"
                : "var(--primary)",
          strokeDasharray: edge.secondary ? "8 6" : undefined,
          strokeWidth: edge.secondary
            ? 1
            : edge.family === "structural"
              ? 1.7
              : 1.2
        }
      };
    });
  }, [
    focusNodeId,
    focusGraphNode,
    focusDescendantIds,
    isMobile,
    model,
    renderedFlowNodeById,
    renderedFlowNodeIds,
    showSecondaryEdges
  ]);
  const layoutKey = `${expandAll ? "all" : "branch"}:${expandedLaneId ?? "none"}:${[...expandedNodeIds].at(-1) ?? "none"}:${focusNodeId ?? "none"}:${showSecondaryEdges}:${nodes.length}`;
  const focusedNode = focusNodeId ? model.nodeById.get(focusNodeId) : null;
  return (
    <section
      aria-label="Knowledge hierarchy"
      className={`flex h-full min-h-[30rem] flex-col gap-3 ${isMobile ? "pb-[calc(5.75rem+env(safe-area-inset-bottom))]" : ""}`}
    >
      <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-3 shadow-[var(--ui-shadow-soft)]">
        <div className="min-w-0">
          {focusedNode ? (
            <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--ui-ink-soft)]">
              Selected hierarchy
            </div>
          ) : null}
          <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
            {focusedNode ? focusedNode.title : fullHierarchyTitle}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {focusedNode ? (
              <>
                {focusDescendantIds.size > 0 ? (
                  <span className="inline-flex items-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2.5 py-1 text-[10px] text-[var(--ui-ink-soft)]">
                    {focusLinkedItemLabel}
                  </span>
                ) : null}
                {focusPanelLinkedItemCount > 0 &&
                focusPanelLinkedItemCount !== focusDirectLinkedIds.size ? (
                  <span className="inline-flex items-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2.5 py-1 text-[10px] text-[var(--ui-ink-soft)]">
                    {focusRelatedLabel}
                  </span>
                ) : null}
                {focusPathTailLabel ? (
                  <span className="inline-flex items-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2.5 py-1 text-[10px] text-[var(--ui-ink-soft)]">
                    Parent · {focusPathTailLabel}
                  </span>
                ) : null}
              </>
            ) : (
              HIERARCHY_GROUPS.map((lane) => (
                <span
                  key={lane.id}
                  className="inline-flex items-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2.5 py-1 text-[10px] text-[var(--ui-ink-soft)]"
                >
                  {lane.label}
                </span>
              ))
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {focusedNode ? (
            <>
              {focusParentNode ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-11 rounded-full px-3 text-[10px]"
                  onClick={() => activateEntity(focusParentNode)}
                >
                  Up to parent
                </Button>
              ) : null}
              {focusDirectLinkedIds.size > 0 ||
              focusAllConnectedIds.size > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-11 rounded-full px-3 text-[10px]"
                  onClick={() => setExpandAll((current) => !current)}
                  aria-pressed={expandAll}
                >
                  {expandAll ? "Direct links only" : "Expand connected map"}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-11 rounded-full px-3 text-[10px]"
                onClick={() => {
                  setExpandAll(false);
                  setExpandedLaneId(null);
                  setExpandedNodeIds(new Set());
                  onClearFocus();
                }}
              >
                <ChevronsDownUp className="size-3" aria-hidden="true" />
                Back to full hierarchy
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-11 rounded-full px-3 text-[10px]"
                onClick={() => {
                  setExpandAll(false);
                  setExpandedLaneId(null);
                  setExpandedNodeIds(new Set());
                  onClearFocus();
                }}
              >
                <ChevronsDownUp className="size-3" aria-hidden="true" />
                Collapse all
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-11 rounded-full px-3 text-[10px]"
                onClick={() => {
                  setExpandedLaneId(null);
                  setExpandedNodeIds(new Set());
                  setExpandAll(true);
                }}
              >
                <ChevronsUpDown className="size-3" aria-hidden="true" />
                Expand all
              </Button>
            </>
          )}
        </div>
      </div>
      <div
        ref={canvasRef}
        className="knowledge-graph-canvas relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-0)]"
      >
        <div className="flex h-[3.75rem] shrink-0 items-center justify-end border-b border-[var(--ui-border-subtle)] px-3">
          <div
            className="knowledge-graph-hierarchy-controls"
            role="group"
            aria-label="Hierarchy zoom controls"
          >
            <button
              type="button"
              className="knowledge-graph-hierarchy-control-button"
              aria-label="Zoom in"
              onClick={() => flowInstanceRef.current?.zoomIn()}
            >
              <Plus aria-hidden="true" />
            </button>
            <button
              type="button"
              className="knowledge-graph-hierarchy-control-button"
              aria-label="Zoom out"
              onClick={() => flowInstanceRef.current?.zoomOut()}
            >
              <Minus aria-hidden="true" />
            </button>
            <button
              type="button"
              className="knowledge-graph-hierarchy-control-button"
              aria-label="Fit hierarchy to view"
              onClick={() =>
                flowInstanceRef.current?.fitView({
                  padding: focusNodeId ? 0.22 : 0.16,
                  maxZoom: 0.82
                })
              }
            >
              <Maximize2 aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <ReactFlow
            className="knowledge-graph-hierarchy-flow"
            key={layoutKey}
            fitView={false}
            fitViewOptions={
              focusNodeId
                ? {
                    padding: 0.22,
                    maxZoom: 0.82
                  }
                : { padding: 0.16 }
            }
            defaultViewport={{
              x: focusNodeId
                ? 24 - (isMobile ? 24 : 64) * hierarchyDefaultZoom
                : expandedLaneId
                  ? 24 -
                    (64 +
                      HIERARCHY_GROUPS.findIndex(
                        (lane) => lane.id === expandedLaneId
                      ) *
                        LANE_WIDTH) *
                      hierarchyDefaultZoom
                  : 0,
              y: focusNodeId
                ? 16 - 28 * hierarchyDefaultZoom
                : expandedLaneId
                  ? 8
                  : 0,
              zoom: hierarchyDefaultZoom
            }}
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            elementsSelectable={false}
            onInit={(instance) => {
              flowInstanceRef.current = instance;
            }}
            onMoveEnd={(_, nextViewport) => setViewport(nextViewport)}
            minZoom={hierarchyMinimumZoom}
            maxZoom={1.8}
            attributionPosition="top-left"
            onNodeClick={(_, flowNode) => {
              if (flowNode.id.startsWith("lane:")) {
                const laneId = flowNode.id.slice("lane:".length);
                setExpandAll(false);
                setExpandedNodeIds(new Set());
                setExpandedLaneId((current) =>
                  current === laneId ? null : laneId
                );
                onClearFocus();
                return;
              }
              const graphNode = model.nodeById.get(flowNode.id);
              if (!graphNode) return;
              if ((model.childrenById.get(flowNode.id)?.length ?? 0) > 0) {
                setExpandAll(false);
                setExpandedLaneId(
                  getKnowledgeGraphSemanticGroup(graphNode.entityKind)
                );
                setExpandedNodeIds((current) =>
                  toggleKnowledgeGraphHierarchyBranch(
                    model,
                    current,
                    flowNode.id
                  )
                );
              }
              onSelectNode(graphNode);
            }}
            onNodeDoubleClick={(_, flowNode) => {
              const graphNode = model.nodeById.get(flowNode.id);
              if (!graphNode) return;
              if (isMobile) onOpenNode(graphNode);
              else onNavigateNode(graphNode);
            }}
          >
            <Background gap={28} size={1} color="var(--ui-border-subtle)" />
          </ReactFlow>
        </div>
      </div>
    </section>
  );
}
