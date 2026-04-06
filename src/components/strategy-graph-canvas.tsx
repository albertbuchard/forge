import { useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@/components/ui/badge";
import { buildStrategyLevels } from "@/lib/strategy-hierarchy";
import type { Strategy } from "@/lib/types";

type StrategyGraphCanvasProps = {
  strategy: Pick<Strategy, "graph" | "metrics">;
  ownerByNodeId?: Map<
    string,
    {
      label: string;
      color: string;
    } | null
  >;
  heightClassName?: string;
};

function buildFlowNodes(
  strategy: Pick<Strategy, "graph" | "metrics">,
  ownerByNodeId: StrategyGraphCanvasProps["ownerByNodeId"]
): Node[] {
  const levelById = buildStrategyLevels(strategy.graph);
  const columns = new Map<number, string[]>();
  for (const node of strategy.graph.nodes) {
    const level = levelById.get(node.id) ?? 0;
    columns.set(level, [...(columns.get(level) ?? []), node.id]);
  }

  return strategy.graph.nodes.map((node) => {
    const level = levelById.get(node.id) ?? 0;
    const index = (columns.get(level) ?? []).indexOf(node.id);
    const isActive = strategy.metrics.activeNodeIds.includes(node.id);
    const isBlocked = strategy.metrics.blockedNodeIds.includes(node.id);
    const isOutOfOrder = strategy.metrics.outOfOrderNodeIds.includes(node.id);
    const isDone = !isActive && !isBlocked && !isOutOfOrder;
    const owner = ownerByNodeId?.get(node.id) ?? null;

    let toneClassName = "border-white/10 bg-[rgba(8,14,26,0.92)]";
    if (isActive) {
      toneClassName = "border-emerald-400/30 bg-emerald-500/[0.08]";
    } else if (isBlocked) {
      toneClassName = "border-rose-400/28 bg-rose-500/[0.08]";
    } else if (isOutOfOrder) {
      toneClassName = "border-amber-400/28 bg-amber-500/[0.08]";
    } else if (strategy.metrics.completedNodeCount > 0) {
      toneClassName = "border-sky-400/20 bg-sky-500/[0.05]";
    }

    return {
      id: node.id,
      position: {
        x: 72 + level * 308,
        y: 56 + index * 168
      },
      draggable: false,
      selectable: false,
      data: {
        label: (
          <div
            className={`min-w-[220px] rounded-[22px] border px-4 py-4 shadow-[0_24px_70px_rgba(0,0,0,0.24)] ${toneClassName}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-white/[0.08] text-white/74">
                {node.entityType}
              </Badge>
              {isActive ? (
                <Badge className="bg-emerald-500/12 text-emerald-200">
                  Active
                </Badge>
              ) : null}
              {isBlocked ? (
                <Badge className="bg-rose-500/12 text-rose-200">Blocked</Badge>
              ) : null}
              {isOutOfOrder ? (
                <Badge className="bg-amber-500/12 text-amber-200">
                  Out of order
                </Badge>
              ) : null}
              {isDone && !isBlocked && !isOutOfOrder ? (
                <Badge className="bg-sky-500/12 text-sky-200">In plan</Badge>
              ) : null}
            </div>
            <div className="mt-3 text-base font-medium leading-6 text-white">
              {node.title}
            </div>
            {node.branchLabel ? (
              <div className="mt-2 text-xs uppercase tracking-[0.16em] text-white/45">
                {node.branchLabel}
              </div>
            ) : null}
            {node.notes ? (
              <div className="mt-2 text-sm leading-5 text-white/56">
                {node.notes}
              </div>
            ) : null}
            {owner ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-white/52">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: owner.color }}
                />
                <span>{owner.label}</span>
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

function buildFlowEdges(strategy: Pick<Strategy, "graph" | "metrics">): Edge[] {
  return strategy.graph.edges.map((edge) => {
    const targetIsActive = strategy.metrics.activeNodeIds.includes(edge.to);
    const targetIsBlocked = strategy.metrics.blockedNodeIds.includes(edge.to);
    const targetIsOutOfOrder = strategy.metrics.outOfOrderNodeIds.includes(
      edge.to
    );

    let stroke = "rgba(255,255,255,0.3)";
    if (targetIsActive) {
      stroke = "#4ade80";
    } else if (targetIsBlocked) {
      stroke = "#fb7185";
    } else if (targetIsOutOfOrder) {
      stroke = "#f59e0b";
    }

    return {
      id: `${edge.from}->${edge.to}`,
      source: edge.from,
      target: edge.to,
      label: edge.label || undefined,
      animated: targetIsActive,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: stroke
      },
      style: {
        stroke,
        strokeWidth: targetIsActive ? 2.4 : 1.5
      },
      labelStyle: {
        fill: "rgba(255,255,255,0.56)",
        fontSize: 11,
        fontWeight: 600
      }
    };
  });
}

export function StrategyGraphCanvas({
  strategy,
  ownerByNodeId,
  heightClassName = "h-[540px]"
}: StrategyGraphCanvasProps) {
  const nodes = useMemo(
    () => buildFlowNodes(strategy, ownerByNodeId),
    [ownerByNodeId, strategy]
  );
  const edges = useMemo(() => buildFlowEdges(strategy), [strategy]);

  return (
    <div
      className={`${heightClassName} rounded-[24px] bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.08),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(244,185,122,0.10),transparent_38%),linear-gradient(180deg,rgba(6,10,20,0.97),rgba(8,14,26,0.94))]`}
    >
      <ReactFlow
        fitView
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        attributionPosition="bottom-left"
      >
        <Controls showInteractive={false} />
        <Background gap={28} size={1} color="rgba(255,255,255,0.06)" />
      </ReactFlow>
    </div>
  );
}
