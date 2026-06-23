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

    let toneClassName =
      "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]";
    let statusBadgeClassName =
      "bg-[var(--ui-surface-3)] text-[var(--ui-ink-soft)]";
    if (isActive) {
      toneClassName =
        "border-[color-mix(in_srgb,var(--success)_34%,var(--ui-border-subtle))] bg-[var(--ui-success-soft)]";
      statusBadgeClassName =
        "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_78%,var(--ui-ink-strong)_22%)]";
    } else if (isBlocked) {
      toneClassName =
        "border-[color-mix(in_srgb,var(--danger)_32%,var(--ui-border-subtle))] bg-[var(--ui-danger-soft)]";
      statusBadgeClassName =
        "bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_78%,var(--ui-ink-strong)_22%)]";
    } else if (isOutOfOrder) {
      toneClassName =
        "border-[color-mix(in_srgb,var(--warning)_34%,var(--ui-border-subtle))] bg-[var(--ui-warning-soft)]";
      statusBadgeClassName =
        "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]";
    } else if (strategy.metrics.completedNodeCount > 0) {
      toneClassName =
        "border-[color-mix(in_srgb,var(--info)_30%,var(--ui-border-subtle))] bg-[var(--ui-info-soft)]";
      statusBadgeClassName =
        "bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)]";
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
            className={`w-[min(17rem,calc(100vw-5rem))] min-w-0 max-w-[17rem] rounded-[22px] border px-4 py-4 shadow-[var(--ui-shadow-soft)] ${toneClassName}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-[var(--ui-surface-3)] text-[var(--ui-ink-soft)]">
                {node.entityType}
              </Badge>
              {isActive ? (
                <Badge className={statusBadgeClassName}>Active</Badge>
              ) : null}
              {isBlocked ? (
                <Badge className={statusBadgeClassName}>Blocked</Badge>
              ) : null}
              {isOutOfOrder ? (
                <Badge className={statusBadgeClassName}>Out of order</Badge>
              ) : null}
              {isDone && !isBlocked && !isOutOfOrder ? (
                <Badge className={statusBadgeClassName}>In plan</Badge>
              ) : null}
            </div>
            <div className="mt-3 break-words text-base font-medium leading-6 text-[var(--ui-ink-strong)]">
              {node.title}
            </div>
            {node.branchLabel ? (
              <div className="mt-2 break-words text-xs uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                {node.branchLabel}
              </div>
            ) : null}
            {node.notes ? (
              <div className="mt-2 break-words text-sm leading-5 text-[var(--ui-ink-soft)]">
                {node.notes}
              </div>
            ) : null}
            {owner ? (
              <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-[var(--ui-ink-faint)]">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: owner.color }}
                />
                <span className="min-w-0 break-words">{owner.label}</span>
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

    let stroke = "var(--ui-border-strong)";
    if (targetIsActive) {
      stroke = "var(--success)";
    } else if (targetIsBlocked) {
      stroke = "var(--danger)";
    } else if (targetIsOutOfOrder) {
      stroke = "var(--warning)";
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
        fill: "var(--ui-ink-soft)",
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
      className={`${heightClassName} min-w-0 overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] shadow-[var(--ui-shadow-soft)]`}
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
        <Background gap={28} size={1} color="var(--ui-border-subtle)" />
      </ReactFlow>
    </div>
  );
}
