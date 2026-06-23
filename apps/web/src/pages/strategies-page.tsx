import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { StrategyDialog } from "@/components/strategy-dialog";
import { PageHero } from "@/components/shell/page-hero";
import { UserBadge } from "@/components/ui/user-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page-state";
import { useForgeShell } from "@/components/shell/app-shell";
import { createStrategy, deleteStrategy, patchStrategy } from "@/lib/api";
import { buildStrategyAlignmentBreakdown } from "@/lib/strategy-metrics";
import type { Strategy } from "@/lib/types";
import { getSingleSelectedUserId } from "@/lib/user-ownership";

function normalize(text: string) {
  return text.trim().toLowerCase();
}

export function StrategiesPage() {
  const shell = useForgeShell();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const defaultUserId = getSingleSelectedUserId(shell.selectedUserIds);

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setEditingStrategy(null);
      setDialogOpen(true);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete("create");
          return next;
        },
        { replace: true }
      );
    }
  }, [searchParams, setSearchParams]);

  const refreshStrategies = async () => {
    await queryClient.invalidateQueries({ queryKey: ["strategy-detail"] });
    await shell.refresh();
  };

  const saveStrategyMutation = useMutation({
    mutationFn: async ({
      input,
      strategyId
    }: {
      input: Parameters<typeof createStrategy>[0];
      strategyId?: string;
    }) =>
      strategyId
        ? (await patchStrategy(strategyId, input)).strategy
        : (await createStrategy(input)).strategy,
    onSuccess: async () => {
      await refreshStrategies();
    }
  });

  const deleteStrategyMutation = useMutation({
    mutationFn: async (strategyId: string) => deleteStrategy(strategyId),
    onSuccess: async () => {
      await refreshStrategies();
    }
  });

  const goalsById = useMemo(
    () => new Map(shell.snapshot.goals.map((goal) => [goal.id, goal])),
    [shell.snapshot.goals]
  );
  const projectsById = useMemo(
    () =>
      new Map(
        shell.snapshot.dashboard.projects.map((project) => [
          project.id,
          project
        ])
      ),
    [shell.snapshot.dashboard.projects]
  );
  const tasksById = useMemo(
    () => new Map(shell.snapshot.tasks.map((task) => [task.id, task])),
    [shell.snapshot.tasks]
  );

  const filteredStrategies = useMemo(() => {
    const query = normalize(searchQuery);
    if (!query) {
      return shell.snapshot.strategies;
    }
    return shell.snapshot.strategies.filter((strategy) => {
      const targetGoalTitles = strategy.targetGoalIds
        .map((goalId) => goalsById.get(goalId)?.title ?? "")
        .join(" ");
      const targetProjectTitles = strategy.targetProjectIds
        .map((projectId) => projectsById.get(projectId)?.title ?? "")
        .join(" ");
      const graphTitles = strategy.graph.nodes
        .map((node) =>
          node.entityType === "project"
            ? (projectsById.get(node.entityId)?.title ?? "")
            : (tasksById.get(node.entityId)?.title ?? "")
        )
        .join(" ");
      return [
        strategy.title,
        strategy.overview,
        strategy.endStateDescription,
        strategy.status,
        strategy.user?.displayName ?? "",
        strategy.user?.handle ?? "",
        strategy.user?.kind ?? "",
        targetGoalTitles,
        targetProjectTitles,
        graphTitles
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [
    goalsById,
    projectsById,
    searchQuery,
    shell.snapshot.strategies,
    tasksById
  ]);

  return (
    <div className="grid gap-5">
      <PageHero
        title="Strategies"
        titleText="Strategies"
        description="Strategies connect human and bot work into a directed plan, with explicit end goals, ownership, and live alignment metrics."
        badge={`${shell.snapshot.strategies.length} strategies`}
        actions={
          <Button
            onClick={() => {
              setEditingStrategy(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" />
            New strategy
          </Button>
        }
      />

      <Card className="grid gap-4">
        <div className="flex items-center gap-3">
          <Search className="size-4 text-[var(--ui-ink-muted)]" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search strategy title, target, graph node, human, or bot"
          />
        </div>
        <div className="text-sm text-[var(--ui-ink-soft)]">
          Search includes owners, target goals/projects, and graph nodes so
          cross-user plans stay discoverable.
        </div>
      </Card>

      {filteredStrategies.length === 0 ? (
        <EmptyState
          eyebrow="Strategies"
          title="No strategies in this scope"
          description="Create a strategy to connect projects and tasks into a non-looping execution plan across human and bot actors."
          action={
            <Button
              onClick={() => {
                setEditingStrategy(null);
                setDialogOpen(true);
              }}
            >
              Create strategy
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          {filteredStrategies.map((strategy) => {
            const activeNodes = strategy.graph.nodes.filter((node) =>
              strategy.metrics.activeNodeIds.includes(node.id)
            );
            const alignmentBreakdown = buildStrategyAlignmentBreakdown(
              strategy.metrics
            );
            return (
              <Card key={strategy.id} className="grid gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => navigate(`/strategies/${strategy.id}`)}
                    >
                      <div className="font-display text-2xl text-[var(--ui-ink-strong)]">
                        {strategy.title}
                      </div>
                      <div className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
                        {strategy.overview || strategy.endStateDescription}
                      </div>
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <UserBadge user={strategy.user} />
                    <Badge
                      className={
                        strategy.isLocked
                          ? "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_76%,var(--ui-ink-strong)_24%)]"
                          : "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]"
                      }
                    >
                      {strategy.isLocked ? "Contract locked" : "Editable draft"}
                    </Badge>
                    <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                      {strategy.status}
                    </Badge>
                    <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
                      {strategy.metrics.alignmentScore}% aligned
                    </Badge>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-4">
                  <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-3">
                    <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      Graph progress
                    </div>
                    <div className="mt-2 text-xl text-[var(--ui-ink-strong)]">
                      {strategy.metrics.startedNodeCount}/
                      {strategy.metrics.totalNodeCount}
                    </div>
                    <div className="text-xs leading-5 text-[var(--ui-ink-soft)]">
                      {strategy.metrics.completedNodeCount} completed
                    </div>
                  </div>
                  <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-3">
                    <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      Ready branches
                    </div>
                    <div className="mt-2 text-xl text-[var(--ui-ink-strong)]">
                      {strategy.metrics.readyNodeCount}
                    </div>
                    <div className="text-xs leading-5 text-[var(--ui-ink-soft)]">
                      Nodes whose prerequisites are already satisfied.
                    </div>
                  </div>
                  <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-3">
                    <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      End targets
                    </div>
                    <div className="mt-2 text-xl text-[var(--ui-ink-strong)]">
                      {strategy.metrics.completedTargetCount}/
                      {strategy.metrics.totalTargetCount || 0}
                    </div>
                    <div className="text-xs leading-5 text-[var(--ui-ink-soft)]">
                      {strategy.metrics.targetProgressScore}% target progress
                    </div>
                  </div>
                  <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-3">
                    <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      Sequencing
                    </div>
                    <div className="mt-2 text-xl text-[var(--ui-ink-strong)]">
                      {strategy.metrics.sequencingScore}%
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)]">
                  <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                          Active next nodes
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {activeNodes.length === 0 ? (
                            <div className="text-sm text-[var(--ui-ink-soft)]">
                              No currently open branch.
                            </div>
                          ) : (
                            activeNodes.map((node) => (
                              <Badge
                                key={node.id}
                                className="bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]"
                              >
                                {node.title}
                              </Badge>
                            ))
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                          Alignment breakdown
                        </div>
                        <div className="mt-3 grid gap-2 text-sm text-[var(--ui-ink-soft)]">
                          {alignmentBreakdown.map((metric) => (
                            <div key={metric.id}>
                              {metric.label} {metric.value}%
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end justify-end gap-2">
                    {!strategy.isLocked ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingStrategy(strategy);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                    ) : null}
                    <Button
                      variant="secondary"
                      pending={
                        deleteStrategyMutation.isPending &&
                        deleteStrategyMutation.variables === strategy.id
                      }
                      pendingLabel="Deleting strategy"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Delete strategy "${strategy.title}"?`
                          )
                        ) {
                          return;
                        }
                        void deleteStrategyMutation.mutateAsync(strategy.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                    <Button
                      onClick={() => navigate(`/strategies/${strategy.id}`)}
                    >
                      Open strategy
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <StrategyDialog
        open={dialogOpen}
        pending={saveStrategyMutation.isPending}
        editingStrategy={editingStrategy}
        goals={shell.snapshot.dashboard.goals}
        projects={shell.snapshot.dashboard.projects}
        tasks={shell.snapshot.tasks}
        habits={shell.snapshot.habits}
        strategies={shell.snapshot.strategies}
        users={shell.snapshot.users}
        defaultUserId={defaultUserId}
        onOpenChange={setDialogOpen}
        onSubmit={async (input, strategyId) => {
          await saveStrategyMutation.mutateAsync({ input, strategyId });
        }}
      />
    </div>
  );
}
