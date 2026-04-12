import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import {
  buildKnowledgeGraphHierarchy,
  getKnowledgeGraphFocusRelatedNodeIds
} from "@/lib/knowledge-graph";
import {
  KNOWLEDGE_GRAPH_HIERARCHY_LANES,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode
} from "@/lib/knowledge-graph-types";

const LANE_WIDTH = 300;
const ROW_HEIGHT = 152;

function buildPathIds(
  focusNodeId: string | null,
  edges: KnowledgeGraphEdge[]
): Set<string> {
  if (!focusNodeId) {
    return new Set<string>();
  }
  return getKnowledgeGraphFocusRelatedNodeIds(focusNodeId, edges);
}

function buildFlowNodes(
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
  focusNodeId: string | null
): Node[] {
  const hierarchy = buildKnowledgeGraphHierarchy(nodes, edges);
  const highlightedIds = buildPathIds(focusNodeId, edges);
  return hierarchy.nodes.map((node) => {
    const focused = node.id === focusNodeId;
    const highlighted = !focusNodeId || highlightedIds.has(node.id);
    return {
      id: node.id,
      draggable: false,
      selectable: false,
      position: {
        x: 72 + node.layer * LANE_WIDTH,
        y: 88 + node.row * ROW_HEIGHT
      },
      data: {
        label: (
          <div
            className="min-w-[232px] rounded-[22px] border px-4 py-4 shadow-[0_24px_70px_rgba(0,0,0,0.24)] transition"
            style={{
              borderColor: focused
                ? "rgba(255,255,255,0.32)"
                : "rgba(255,255,255,0.1)",
              background: focused
                ? "rgba(11,17,30,0.98)"
                : "rgba(8,14,26,0.92)",
              opacity: highlighted ? 1 : 0.28
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <EntityBadge
                kind={node.entityKind}
                label={node.entityKind.replaceAll("_", " ")}
                compact
                gradient={focused}
              />
            </div>
            <div className="mt-3">
              <EntityName
                kind={node.entityKind}
                label={node.title}
                className="max-w-full"
                lines={2}
              />
            </div>
            {node.subtitle ? (
              <div className="mt-2 text-sm leading-5 text-white/58">
                {node.subtitle}
              </div>
            ) : null}
          </div>
        )
      },
      style: {
        background: "transparent",
        border: "none",
        padding: 0
      }
    };
  });
}

function buildFlowEdges(
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
  focusNodeId: string | null,
  showSecondaryEdges: boolean
): Edge[] {
  const hierarchy = buildKnowledgeGraphHierarchy(nodes, edges);
  const highlightedIds = buildPathIds(focusNodeId, edges);
  return hierarchy.edges
    .filter((edge) => showSecondaryEdges || !edge.secondary)
    .map((edge) => {
      const highlighted =
        !focusNodeId ||
        highlightedIds.has(edge.source) ||
        highlightedIds.has(edge.target);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: !edge.secondary && edge.family === "structural" && highlighted,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edge.secondary
            ? "rgba(255,255,255,0.16)"
            : "rgba(232,242,255,0.42)"
        },
        style: {
          opacity: highlighted ? 1 : 0.18,
          stroke: edge.secondary
            ? "rgba(255,255,255,0.16)"
            : edge.family === "taxonomy"
              ? "rgba(162,245,189,0.34)"
              : edge.family === "structural"
                ? "rgba(232,242,255,0.4)"
                : "rgba(192,193,255,0.24)",
          strokeDasharray: edge.secondary ? "8 6" : undefined,
          strokeWidth: edge.secondary ? 1 : edge.family === "structural" ? 1.7 : 1.2
        }
      };
    });
}

export function KnowledgeGraphHierarchyView({
  nodes,
  edges,
  focusNodeId,
  showSecondaryEdges,
  onSelectNode,
  onOpenNode,
  onNavigateNode,
  isMobile
}: {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  focusNodeId: string | null;
  showSecondaryEdges: boolean;
  onSelectNode: (node: KnowledgeGraphNode) => void;
  onOpenNode: (node: KnowledgeGraphNode) => void;
  onNavigateNode: (node: KnowledgeGraphNode) => void;
  isMobile: boolean;
}) {
  const flowNodes = useMemo(
    () => buildFlowNodes(nodes, edges, focusNodeId),
    [edges, focusNodeId, nodes]
  );
  const flowEdges = useMemo(
    () => buildFlowEdges(nodes, edges, focusNodeId, showSecondaryEdges),
    [edges, focusNodeId, nodes, showSecondaryEdges]
  );
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  return (
    <div className="knowledge-graph-canvas relative h-[44rem] rounded-[28px]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex gap-4 overflow-x-auto px-6 py-4">
        {KNOWLEDGE_GRAPH_HIERARCHY_LANES.map((lane) => (
          <div
            key={lane.id}
            className="min-w-[17rem] rounded-full border border-white/10 bg-[rgba(11,17,28,0.78)] px-4 py-2 text-center text-[11px] uppercase tracking-[0.16em] text-white/52 backdrop-blur"
          >
            {lane.label}
          </div>
        ))}
      </div>
      <ReactFlow
        key={`${focusNodeId ?? "all"}-${showSecondaryEdges ? "all" : "primary"}`}
        fitView
        fitViewOptions={
          focusNodeId
            ? {
                padding: 0.24,
                nodes: [{ id: focusNodeId }]
              }
            : { padding: 0.2 }
        }
        nodes={flowNodes}
        edges={flowEdges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        attributionPosition="bottom-left"
        onNodeClick={(_, node) => {
          const graphNode = nodeMap.get(node.id);
          if (graphNode) {
            onSelectNode(graphNode);
          }
        }}
        onNodeDoubleClick={(_, node) => {
          const graphNode = nodeMap.get(node.id);
          if (!graphNode) {
            return;
          }
          if (isMobile) {
            onOpenNode(graphNode);
            return;
          }
          onNavigateNode(graphNode);
        }}
      >
        <Controls showInteractive={false} />
        <Background gap={28} size={1} color="rgba(255,255,255,0.05)" />
      </ReactFlow>
    </div>
  );
}
