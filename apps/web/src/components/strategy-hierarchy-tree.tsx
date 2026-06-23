import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Layers3, Split } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { UserBadge } from "@/components/ui/user-badge";
import { buildStrategyPhases } from "@/lib/strategy-hierarchy";
import type { ProjectSummary, Strategy, Task } from "@/lib/types";

function summarizeNodeState(strategy: Strategy, nodeId: string) {
  const isActive = strategy.metrics.activeNodeIds.includes(nodeId);
  const isBlocked = strategy.metrics.blockedNodeIds.includes(nodeId);
  const isOutOfOrder = strategy.metrics.outOfOrderNodeIds.includes(nodeId);

  if (isBlocked) {
    return {
      label: "Blocked",
      className:
        "bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_78%,var(--ui-ink-strong)_22%)]"
    };
  }
  if (isOutOfOrder) {
    return {
      label: "Out of order",
      className:
        "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]"
    };
  }
  if (isActive) {
    return {
      label: "Ready now",
      className:
        "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_78%,var(--ui-ink-strong)_22%)]"
    };
  }
  return {
    label: "In plan",
    className:
      "bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)]"
  };
}

export function StrategyHierarchyTree({
  strategy,
  projectsById,
  tasksById,
  className
}: {
  strategy: Strategy;
  projectsById: Map<string, ProjectSummary>;
  tasksById: Map<string, Task>;
  className?: string;
}) {
  const phases = useMemo(
    () => buildStrategyPhases(strategy.graph),
    [strategy.graph]
  );
  const predecessorsByNodeId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of strategy.graph.nodes) {
      map.set(node.id, []);
    }
    for (const edge of strategy.graph.edges) {
      map.set(edge.to, [...(map.get(edge.to) ?? []), edge.from]);
    }
    return map;
  }, [strategy.graph]);
  const [collapsedLevels, setCollapsedLevels] = useState<number[]>([]);

  return (
    <div className={className ?? "grid gap-3"}>
      {phases.map((phase) => {
        const collapsed = collapsedLevels.includes(phase.level);
        const phaseLabel =
          phase.level === 0 ? "Launch phase" : `Phase ${phase.level + 1}`;
        const parallel = phase.nodeIds.length > 1;

        return (
          <div
            key={phase.level}
            className="min-w-0 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] shadow-[var(--ui-shadow-soft)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
              <button
                type="button"
                className="flex min-w-0 max-w-full items-center gap-3 text-left"
                onClick={() =>
                  setCollapsedLevels((current) =>
                    collapsed
                      ? current.filter((level) => level !== phase.level)
                      : [...current, phase.level]
                  )
                }
              >
                <span className="rounded-full bg-[var(--ui-surface-3)] p-2 text-[var(--ui-ink-soft)]">
                  {collapsed ? (
                    <ChevronRight className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="break-words font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                    {phaseLabel}
                  </div>
                  <div className="mt-1 break-words text-sm text-[var(--ui-ink-soft)]">
                    {parallel
                      ? "These branches can progress in parallel once the previous phase is complete."
                      : "This phase advances as one focused step in the strategy."}
                  </div>
                </div>
              </button>

              <div className="flex flex-wrap gap-2">
                <Badge className="bg-[var(--ui-surface-3)] text-[var(--ui-ink-soft)]">
                  {phase.nodeIds.length} node
                  {phase.nodeIds.length === 1 ? "" : "s"}
                </Badge>
                <Badge className="bg-[var(--ui-surface-3)] text-[var(--ui-ink-soft)]">
                  {parallel ? (
                    <>
                      <Split className="mr-1 size-3.5" />
                      Parallel
                    </>
                  ) : (
                    <>
                      <Layers3 className="mr-1 size-3.5" />
                      Sequential
                    </>
                  )}
                </Badge>
              </div>
            </div>

            {!collapsed ? (
              <div className="grid min-w-0 gap-3 border-t border-[var(--ui-border-subtle)] px-4 py-4 lg:grid-cols-2">
                {phase.nodeIds.map((nodeId) => {
                  const node = strategy.graph.nodes.find(
                    (candidate) => candidate.id === nodeId
                  );
                  if (!node) {
                    return null;
                  }

                  const entity =
                    node.entityType === "project"
                      ? projectsById.get(node.entityId)
                      : tasksById.get(node.entityId);
                  const href =
                    node.entityType === "project"
                      ? `/projects/${node.entityId}`
                      : `/tasks/${node.entityId}`;
                  const owner =
                    node.entityType === "project"
                      ? projectsById.get(node.entityId)?.user
                      : tasksById.get(node.entityId)?.user;
                  const predecessorLabels =
                    predecessorsByNodeId
                      .get(node.id)
                      ?.map(
                        (predecessorId) =>
                          strategy.graph.nodes.find(
                            (candidate) => candidate.id === predecessorId
                          )?.title ?? predecessorId
                      ) ?? [];
                  const state = summarizeNodeState(strategy, node.id);

                  return (
                    <div
                      key={node.id}
                      className="min-w-0 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4"
                    >
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2">
                            <Badge className="bg-[var(--ui-surface-3)] text-[var(--ui-ink-soft)]">
                              {node.entityType}
                            </Badge>
                            <Badge className={state.className}>
                              {state.label}
                            </Badge>
                          </div>
                          <Link
                            to={href}
                            className="mt-3 block break-words text-lg font-medium text-[var(--ui-ink-strong)] transition hover:text-[var(--primary)]"
                          >
                            {node.title}
                          </Link>
                          <div className="mt-2 break-words text-sm leading-6 text-[var(--ui-ink-soft)]">
                            {node.notes ||
                              ("description" in (entity ?? {})
                                ? entity?.description
                                : "") ||
                              "No extra step note attached yet."}
                          </div>
                        </div>
                        <UserBadge user={owner} compact />
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {node.branchLabel ? (
                          <Badge className="bg-[var(--ui-accent-soft)] text-[var(--primary)]">
                            {node.branchLabel}
                          </Badge>
                        ) : null}
                        {predecessorLabels.length === 0 ? (
                          <Badge className="bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_78%,var(--ui-ink-strong)_22%)]">
                            Start node
                          </Badge>
                        ) : (
                          predecessorLabels.map((label) => (
                            <Badge
                              key={`${node.id}:${label}`}
                              className="max-w-full break-words bg-[var(--ui-surface-3)] text-[var(--ui-ink-soft)]"
                            >
                              Depends on {label}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}

      {phases.length === 0 ? (
        <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4 text-sm text-[var(--ui-ink-soft)]">
          No phases mapped yet.
        </div>
      ) : null}
    </div>
  );
}
