import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { StrategyDialog } from "@/components/strategy-dialog";
import { PageHero } from "@/components/shell/page-hero";
import { UserBadge } from "@/components/ui/user-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { useForgeShell } from "@/components/shell/app-shell";
import {
  createStrategy,
  deleteStrategy,
  getStrategy,
  patchStrategy
} from "@/lib/api";
import { getEntityRoute } from "@/lib/note-helpers";
import { getSingleSelectedUserId } from "@/lib/user-ownership";

export function StrategyDetailPage() {
  const shell = useForgeShell();
  const { strategyId } = useParams<{ strategyId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const defaultUserId = getSingleSelectedUserId(shell.selectedUserIds);

  const scopedStrategy =
    shell.snapshot.strategies.find((entry) => entry.id === strategyId) ?? null;
  const strategyQuery = useQuery({
    queryKey: ["strategy-detail", strategyId],
    queryFn: async () => (await getStrategy(strategyId!)).strategy,
    enabled: Boolean(strategyId && !scopedStrategy)
  });

  const strategy = scopedStrategy ?? strategyQuery.data ?? null;

  const refreshStrategy = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["strategy-detail", strategyId]
      }),
      shell.refresh()
    ]);
  };

  const saveStrategyMutation = useMutation({
    mutationFn: async ({
      input,
      currentStrategyId
    }: {
      input: Parameters<typeof createStrategy>[0];
      currentStrategyId: string;
    }) => (await patchStrategy(currentStrategyId, input)).strategy,
    onSuccess: refreshStrategy
  });

  const deleteStrategyMutation = useMutation({
    mutationFn: async (currentStrategyId: string) =>
      deleteStrategy(currentStrategyId),
    onSuccess: async () => {
      await refreshStrategy();
      navigate("/strategies");
    }
  });

  const lockStrategyMutation = useMutation({
    mutationFn: async (nextLocked: boolean) =>
      (
        await patchStrategy(strategyId!, {
          isLocked: nextLocked,
          lockedByUserId:
            nextLocked
              ? defaultUserId ?? strategy?.userId ?? "user_operator"
              : null
        })
      ).strategy,
    onSuccess: refreshStrategy
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

  const predecessorsByNodeId = useMemo(() => {
    if (!strategy) {
      return new Map<string, string[]>();
    }
    const map = new Map(
      strategy.graph.nodes.map((node) => [node.id, [] as string[]])
    );
    for (const edge of strategy.graph.edges) {
      map.set(edge.to, [...(map.get(edge.to) ?? []), edge.from]);
    }
    return map;
  }, [strategy]);

  if (strategyQuery.isLoading && !strategy) {
    return (
      <LoadingState
        eyebrow="Strategy"
        title="Loading strategy"
        description="Resolving the directed plan, targets, and current alignment."
      />
    );
  }

  if (strategyQuery.isError) {
    return (
      <ErrorState
        eyebrow="Strategy"
        error={strategyQuery.error}
        onRetry={() => void strategyQuery.refetch()}
      />
    );
  }

  if (!strategy) {
    return (
      <ErrorState
        eyebrow="Strategy"
        error={new Error("Strategy not found.")}
        onRetry={() => navigate("/strategies")}
      />
    );
  }

  return (
    <div className="grid gap-5">
      <PageHero
        title={strategy.title}
        titleText={strategy.title}
        description={strategy.overview || strategy.endStateDescription}
        badge={`${strategy.metrics.alignmentScore}% aligned`}
        actions={
          <div className="flex flex-wrap gap-2">
            {!strategy.isLocked ? (
              <Button variant="secondary" onClick={() => setDialogOpen(true)}>
                Edit strategy
              </Button>
            ) : null}
            <Button
              variant="secondary"
              pending={lockStrategyMutation.isPending}
              pendingLabel={
                strategy.isLocked ? "Unlocking contract" : "Locking contract"
              }
              onClick={() => {
                void lockStrategyMutation.mutateAsync(!strategy.isLocked);
              }}
            >
              {strategy.isLocked ? "Unlock contract" : "Lock as contract"}
            </Button>
            <Button
              variant="secondary"
              pending={deleteStrategyMutation.isPending}
              pendingLabel="Deleting strategy"
              onClick={() => {
                if (!window.confirm(`Delete strategy "${strategy.title}"?`)) {
                  return;
                }
                void deleteStrategyMutation.mutateAsync(strategy.id);
              }}
            >
              Delete
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <UserBadge user={strategy.user} />
        <Badge
          className={
            strategy.isLocked
              ? "bg-amber-500/12 text-amber-200"
              : "bg-emerald-500/12 text-emerald-200"
          }
        >
          {strategy.isLocked ? "Contract locked" : "Editable draft"}
        </Badge>
        <Badge className="bg-white/[0.08] text-white/76">
          {strategy.status}
        </Badge>
        <Badge className="bg-white/[0.08] text-white/76">
          {strategy.graph.nodes.length} nodes
        </Badge>
        <Badge className="bg-white/[0.08] text-white/76">
          {strategy.graph.edges.length} edges
        </Badge>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <div className="grid gap-5">
          <Card className="grid gap-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              End state
            </div>
            <div className="text-sm leading-7 text-white/64">
              {strategy.endStateDescription || "No end-state description yet."}
            </div>
          </Card>

          <Card className="grid gap-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Directed execution graph
            </div>
            <div className="grid gap-3">
              {strategy.graph.nodes.map((node, index) => {
                const href =
                  node.entityType === "project"
                    ? `/projects/${node.entityId}`
                    : `/tasks/${node.entityId}`;
                const predecessors =
                  predecessorsByNodeId
                    .get(node.id)
                    ?.map(
                      (predecessorId) =>
                        strategy.graph.nodes.find(
                          (entry) => entry.id === predecessorId
                        )?.title ?? predecessorId
                    ) ?? [];
                const isActive = strategy.metrics.activeNodeIds.includes(
                  node.id
                );
                const isBlocked = strategy.metrics.blockedNodeIds.includes(
                  node.id
                );
                const isOutOfOrder = strategy.metrics.outOfOrderNodeIds.includes(
                  node.id
                );
                return (
                  <div
                    key={node.id}
                    className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap gap-2">
                          <Badge className="bg-white/[0.08] text-white/76">
                            Step {index + 1}
                          </Badge>
                          <Badge className="bg-white/[0.08] text-white/76">
                            {node.entityType}
                          </Badge>
                          {isActive ? (
                            <Badge className="bg-emerald-500/12 text-emerald-200">
                              Active branch
                            </Badge>
                          ) : null}
                          {isBlocked ? (
                            <Badge className="bg-rose-500/12 text-rose-200">
                              Blocked
                            </Badge>
                          ) : null}
                          {isOutOfOrder ? (
                            <Badge className="bg-amber-500/12 text-amber-200">
                              Out of order
                            </Badge>
                          ) : null}
                        </div>
                        <Link
                          to={href}
                          className="mt-3 block text-lg font-medium text-white transition hover:text-[var(--primary)]"
                        >
                          {node.title}
                        </Link>
                        <div className="mt-2">
                          <UserBadge
                            user={
                              node.entityType === "project"
                                ? projectsById.get(node.entityId)?.user
                                : tasksById.get(node.entityId)?.user
                            }
                            compact
                          />
                        </div>
                        {node.branchLabel ? (
                          <div className="mt-2 text-sm text-white/56">
                            Branch: {node.branchLabel}
                          </div>
                        ) : null}
                        {node.notes ? (
                          <div className="mt-2 text-sm leading-6 text-white/58">
                            {node.notes}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-right text-sm text-white/52">
                        {predecessors.length === 0 ? (
                          <div>Start node</div>
                        ) : (
                          predecessors.map((label) => (
                            <div key={label}>{label}</div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="grid gap-5">
          <Card className="grid gap-3">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Contract state
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-4">
              <div className="text-sm text-white/58">
                {strategy.isLocked
                  ? "This strategy is currently locked as a contract. The graph, targets, and descriptive plan stay frozen until you explicitly unlock it."
                  : "This strategy is still a draft. Agents and users can keep refining the plan until you lock it."}
              </div>
              {strategy.isLocked ? (
                <div className="mt-3 flex flex-wrap gap-2 text-sm text-white/60">
                  <span>
                    Locked by {strategy.lockedByUser?.displayName ?? "Unknown user"}
                  </span>
                  {strategy.lockedAt ? <span>· {new Date(strategy.lockedAt).toLocaleString()}</span> : null}
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="grid gap-3">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Alignment metrics
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="text-sm text-white/56">Alignment score</div>
              <div className="mt-2 font-display text-3xl text-[var(--primary)]">
                {strategy.metrics.alignmentScore}%
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="text-sm text-white/56">Plan coverage</div>
              <div className="mt-2 text-white">
                {strategy.metrics.planCoverageScore}%
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="text-sm text-white/56">Sequencing</div>
              <div className="mt-2 text-white">
                {strategy.metrics.sequencingScore}%
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="text-sm text-white/56">Scope discipline</div>
              <div className="mt-2 text-white">
                {strategy.metrics.scopeDisciplineScore}% · {strategy.metrics.offPlanEntityCount} off-plan
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="text-sm text-white/56">Quality</div>
              <div className="mt-2 text-white">
                {strategy.metrics.qualityScore}% · {strategy.metrics.blockedNodeIds.length} blocked
              </div>
            </div>
          </Card>

          <Card className="grid gap-3">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              End targets
            </div>
            {strategy.targetGoalIds.map((goalId) => {
              const goal = goalsById.get(goalId);
              return goal ? (
                <Link
                  key={goal.id}
                  to={`/goals/${goal.id}`}
                  className="rounded-[16px] bg-white/[0.04] px-4 py-3 text-sm text-white/78 transition hover:bg-white/[0.08]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>Goal: {goal.title}</span>
                    <UserBadge user={goal.user} compact />
                  </div>
                </Link>
              ) : null;
            })}
            {strategy.targetProjectIds.map((projectId) => {
              const project = projectsById.get(projectId);
              return project ? (
                <Link
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="rounded-[16px] bg-white/[0.04] px-4 py-3 text-sm text-white/78 transition hover:bg-white/[0.08]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>Project: {project.title}</span>
                    <UserBadge user={project.user} compact />
                  </div>
                </Link>
              ) : null;
            })}
            {strategy.targetGoalIds.length === 0 &&
            strategy.targetProjectIds.length === 0 ? (
              <div className="rounded-[16px] bg-white/[0.04] px-4 py-3 text-sm text-white/52">
                No end targets linked yet.
              </div>
            ) : null}
          </Card>

          <Card className="grid gap-3">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Linked entities
            </div>
            {strategy.linkedEntities.length === 0 ? (
              <div className="rounded-[16px] bg-white/[0.04] px-4 py-3 text-sm text-white/52">
                No additional linked entities.
              </div>
            ) : (
              strategy.linkedEntities.map((entity) => {
                const href = getEntityRoute(entity.entityType, entity.entityId);
                const label =
                  entity.entityType === "goal"
                    ? goalsById.get(entity.entityId)?.title
                    : entity.entityType === "project"
                      ? projectsById.get(entity.entityId)?.title
                      : entity.entityType === "task"
                        ? tasksById.get(entity.entityId)?.title
                        : `${entity.entityType}:${entity.entityId}`;
                return href ? (
                  <Link
                    key={`${entity.entityType}:${entity.entityId}`}
                    to={href}
                    className="rounded-[16px] bg-white/[0.04] px-4 py-3 text-sm text-white/78 transition hover:bg-white/[0.08]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{label}</span>
                      <UserBadge
                        user={
                          entity.entityType === "goal"
                            ? goalsById.get(entity.entityId)?.user
                            : entity.entityType === "project"
                              ? projectsById.get(entity.entityId)?.user
                              : entity.entityType === "task"
                                ? tasksById.get(entity.entityId)?.user
                                : entity.entityType === "strategy"
                                  ? shell.snapshot.strategies.find(
                                      (entry) => entry.id === entity.entityId
                                    )?.user
                                  : null
                        }
                        compact
                      />
                    </div>
                  </Link>
                ) : (
                  <div
                    key={`${entity.entityType}:${entity.entityId}`}
                    className="rounded-[16px] bg-white/[0.04] px-4 py-3 text-sm text-white/52"
                  >
                    {label}
                  </div>
                );
              })
            )}
          </Card>
        </div>
      </div>

      <StrategyDialog
        open={dialogOpen}
        pending={saveStrategyMutation.isPending}
        editingStrategy={strategy}
        goals={shell.snapshot.dashboard.goals}
        projects={shell.snapshot.dashboard.projects}
        tasks={shell.snapshot.tasks}
        habits={shell.snapshot.habits}
        strategies={shell.snapshot.strategies}
        users={shell.snapshot.users}
        defaultUserId={defaultUserId}
        onOpenChange={setDialogOpen}
        onSubmit={async (input) => {
          await saveStrategyMutation.mutateAsync({
            input,
            currentStrategyId: strategy.id
          });
        }}
      />
    </div>
  );
}
