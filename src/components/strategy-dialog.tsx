import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from "lucide-react";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import { UserSelectField } from "@/components/ui/user-select-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  CrudEntityType,
  DashboardGoal,
  Habit,
  ProjectSummary,
  Strategy,
  Task,
  UserSummary
} from "@/lib/types";
import {
  buildOwnedEntitySearchText,
  formatOwnedEntityDescription,
  formatOwnedEntityOptionLabel,
  formatOwnerSelectDefaultLabel
} from "@/lib/user-ownership";

type StrategyDialogDraftNode = {
  id: string;
  entityType: "project" | "task";
  entityId: string;
  branchLabel: string;
  notes: string;
  predecessorIds: string[];
};

type StrategyDialogDraft = {
  title: string;
  overview: string;
  endStateDescription: string;
  status: Strategy["status"];
  userId: string | null;
  targetGoalIds: string[];
  targetProjectIds: string[];
  linkedEntities: Array<{ entityType: CrudEntityType; entityId: string }>;
  nodes: StrategyDialogDraftNode[];
};

type LinkableEntityOption = {
  key: string;
  entityType: CrudEntityType;
  entityId: string;
  label: string;
  description: string;
};

function createDraftNode(
  entityType: "project" | "task" = "project"
): StrategyDialogDraftNode {
  return {
    id: `strategy_node_${Math.random().toString(36).slice(2, 10)}`,
    entityType,
    entityId: "",
    branchLabel: "",
    notes: "",
    predecessorIds: []
  };
}

function strategyToDraft(strategy: Strategy): StrategyDialogDraft {
  const predecessorIdsByNode = new Map<string, string[]>();
  for (const node of strategy.graph.nodes) {
    predecessorIdsByNode.set(node.id, []);
  }
  for (const edge of strategy.graph.edges) {
    predecessorIdsByNode.set(edge.to, [
      ...(predecessorIdsByNode.get(edge.to) ?? []),
      edge.from
    ]);
  }
  return {
    title: strategy.title,
    overview: strategy.overview,
    endStateDescription: strategy.endStateDescription,
    status: strategy.status,
    userId: strategy.userId ?? null,
    targetGoalIds: strategy.targetGoalIds,
    targetProjectIds: strategy.targetProjectIds,
    linkedEntities: strategy.linkedEntities,
    nodes: strategy.graph.nodes.map((node) => ({
      id: node.id,
      entityType: node.entityType,
      entityId: node.entityId,
      branchLabel: node.branchLabel,
      notes: node.notes,
      predecessorIds: predecessorIdsByNode.get(node.id) ?? []
    }))
  };
}

function hasGraphCycle(nodes: StrategyDialogDraftNode[]) {
  const visited = new Set<string>();
  const active = new Set<string>();
  const byId = new Map(nodes.map((node) => [node.id, node]));

  function visit(nodeId: string): boolean {
    if (active.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }
    visited.add(nodeId);
    active.add(nodeId);
    const node = byId.get(nodeId);
    for (const predecessorId of node?.predecessorIds ?? []) {
      if (visit(predecessorId)) {
        return true;
      }
    }
    active.delete(nodeId);
    return false;
  }

  return nodes.some((node) => visit(node.id));
}

function toggleString(values: string[], nextValue: string) {
  return values.includes(nextValue)
    ? values.filter((value) => value !== nextValue)
    : [...values, nextValue];
}

function toggleLinkedEntity(
  values: StrategyDialogDraft["linkedEntities"],
  nextValue: { entityType: CrudEntityType; entityId: string }
) {
  return values.some(
    (entry) =>
      entry.entityType === nextValue.entityType &&
      entry.entityId === nextValue.entityId
  )
    ? values.filter(
        (entry) =>
          !(
            entry.entityType === nextValue.entityType &&
            entry.entityId === nextValue.entityId
          )
      )
    : [...values, nextValue];
}

function normalize(text: string) {
  return text.trim().toLowerCase();
}

const DEFAULT_STRATEGY_DRAFT: StrategyDialogDraft = {
  title: "",
  overview: "",
  endStateDescription: "",
  status: "active",
  userId: null,
  targetGoalIds: [],
  targetProjectIds: [],
  linkedEntities: [],
  nodes: [createDraftNode("project")]
};

export function StrategyDialog({
  open,
  pending = false,
  editingStrategy,
  goals,
  projects,
  tasks,
  habits,
  strategies,
  users,
  defaultUserId = null,
  onOpenChange,
  onSubmit
}: {
  open: boolean;
  pending?: boolean;
  editingStrategy: Strategy | null;
  goals: DashboardGoal[];
  projects: ProjectSummary[];
  tasks: Task[];
  habits: Habit[];
  strategies: Strategy[];
  users: UserSummary[];
  defaultUserId?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    input: Omit<StrategyDialogDraft, "nodes"> & { graph: Strategy["graph"] },
    strategyId?: string
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState<StrategyDialogDraft>(
    DEFAULT_STRATEGY_DRAFT
  );
  const [entitySearchQuery, setEntitySearchQuery] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (editingStrategy) {
      setDraft(strategyToDraft(editingStrategy));
      setSubmitError(null);
      return;
    }
    setDraft({
      ...DEFAULT_STRATEGY_DRAFT,
      userId: defaultUserId,
      nodes: [createDraftNode("project")]
    });
    setEntitySearchQuery("");
    setSubmitError(null);
  }, [defaultUserId, editingStrategy, open]);

  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );
  const tasksById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks]
  );
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user] as const)),
    [users]
  );
  const normalizedEntitySearch = normalize(entitySearchQuery);
  const defaultUser = users.find((user) => user.id === defaultUserId) ?? null;

  const matchesEntitySearch = (
    parts: Array<string | null | undefined>,
    user?: UserSummary | null
  ) =>
    normalizedEntitySearch.length === 0 ||
    buildOwnedEntitySearchText(parts, user).includes(normalizedEntitySearch);

  const visibleGoals = useMemo(
    () =>
      goals.filter((goal) =>
        matchesEntitySearch([goal.title, goal.description], goal.user)
      ),
    [goals, normalizedEntitySearch]
  );
  const visibleProjects = useMemo(
    () =>
      projects.filter((project) =>
        matchesEntitySearch(
          [
            project.title,
            project.description,
            project.goalTitle,
            project.status
          ],
          project.user
        )
      ),
    [projects, normalizedEntitySearch]
  );
  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) =>
        matchesEntitySearch(
          [task.title, task.description, task.owner, task.status],
          task.user
        )
      ),
    [tasks, normalizedEntitySearch]
  );
  const visibleHabits = useMemo(
    () =>
      habits.filter((habit) =>
        matchesEntitySearch(
          [habit.title, habit.description, habit.frequency, habit.status],
          habit.user
        )
      ),
    [habits, normalizedEntitySearch]
  );
  const visibleStrategies = useMemo(
    () =>
      strategies.filter(
        (strategy) =>
          strategy.id !== editingStrategy?.id &&
          matchesEntitySearch(
            [
              strategy.title,
              strategy.overview,
              strategy.endStateDescription,
              strategy.status
            ],
            strategy.user
          )
      ),
    [editingStrategy?.id, normalizedEntitySearch, strategies]
  );

  const linkableEntities = useMemo(() => {
    const options: LinkableEntityOption[] = [
      ...visibleGoals.map((goal) => ({
        key: `goal:${goal.id}`,
        entityType: "goal" as const,
        entityId: goal.id,
        label: goal.title,
        description: formatOwnedEntityDescription(
          goal.description,
          goal.user,
          "Goal"
        )
      })),
      ...visibleProjects.map((project) => ({
        key: `project:${project.id}`,
        entityType: "project" as const,
        entityId: project.id,
        label: project.title,
        description: formatOwnedEntityDescription(
          `${project.goalTitle}${project.goalTitle ? " · " : ""}${project.status}`,
          project.user,
          `Project · ${project.goalTitle}`
        )
      })),
      ...visibleTasks.map((task) => ({
        key: `task:${task.id}`,
        entityType: "task" as const,
        entityId: task.id,
        label: task.title,
        description: formatOwnedEntityDescription(
          `${task.status} · ${task.owner}`,
          task.user,
          `Task · ${task.owner}`
        )
      })),
      ...visibleHabits.map((habit) => ({
        key: `habit:${habit.id}`,
        entityType: "habit" as const,
        entityId: habit.id,
        label: habit.title,
        description: formatOwnedEntityDescription(
          habit.description,
          habit.user,
          "Habit"
        )
      })),
      ...visibleStrategies.map((strategy) => ({
        key: `strategy:${strategy.id}`,
        entityType: "strategy" as const,
        entityId: strategy.id,
        label: strategy.title,
        description: formatOwnedEntityDescription(
          strategy.overview,
          strategy.user,
          "Strategy"
        )
      }))
    ];
    return options.sort((left, right) => left.label.localeCompare(right.label));
  }, [
    visibleGoals,
    visibleHabits,
    visibleProjects,
    visibleStrategies,
    visibleTasks
  ]);

  const validationMessage = useMemo(() => {
    if (!draft.title.trim()) {
      return "Strategy title is required.";
    }
    if (draft.nodes.length === 0) {
      return "Add at least one project or task node to the strategy graph.";
    }
    const seenEntityKeys = new Set<string>();
    for (const node of draft.nodes) {
      if (!node.entityId) {
        return "Every strategy node needs a linked project or task.";
      }
      const entityKey = `${node.entityType}:${node.entityId}`;
      if (seenEntityKeys.has(entityKey)) {
        return "Each project or task should appear only once in the strategy graph.";
      }
      seenEntityKeys.add(entityKey);
      if (node.predecessorIds.includes(node.id)) {
        return "A strategy node cannot depend on itself.";
      }
    }
    if (hasGraphCycle(draft.nodes)) {
      return "Strategy graph must stay directed and non-loopy.";
    }
    return null;
  }, [draft]);

  const submitDraft = async () => {
    if (validationMessage) {
      setSubmitError(validationMessage);
      return;
    }
    try {
      const graph: Strategy["graph"] = {
        nodes: draft.nodes.map((node) => ({
          id: node.id,
          entityType: node.entityType,
          entityId: node.entityId,
          title:
            node.entityType === "project"
              ? (projectsById.get(node.entityId)?.title ?? node.entityId)
              : (tasksById.get(node.entityId)?.title ?? node.entityId),
          branchLabel: node.branchLabel.trim(),
          notes: node.notes.trim()
        })),
        edges: draft.nodes.flatMap((node) =>
          node.predecessorIds.map((predecessorId) => ({
            from: predecessorId,
            to: node.id,
            label: "",
            condition: ""
          }))
        )
      };

      await onSubmit(
        {
          title: draft.title.trim(),
          overview: draft.overview.trim(),
          endStateDescription: draft.endStateDescription.trim(),
          status: draft.status,
          userId: draft.userId,
          targetGoalIds: draft.targetGoalIds,
          targetProjectIds: draft.targetProjectIds,
          linkedEntities: draft.linkedEntities,
          graph
        },
        editingStrategy?.id
      );
      setSubmitError(null);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Strategy save failed."
      );
    }
  };

  return (
    <SheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Strategy"
      title={editingStrategy ? "Edit strategy" : "Create strategy"}
      description="Strategies connect goals, projects, and tasks into a directed execution plan with explicit ownership."
    >
      <div className="grid gap-4">
        <Card className="grid gap-4">
          <label className="grid gap-2">
            <span className="text-sm font-medium text-white">Title</span>
            <Input
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value
                }))
              }
              placeholder="Launch the agent execution loop"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <UserSelectField
              value={draft.userId}
              users={users}
              onChange={(userId) =>
                setDraft((current) => ({ ...current, userId }))
              }
              label="Owner user"
              defaultLabel={formatOwnerSelectDefaultLabel(defaultUser)}
              help="Strategies can belong to a human or bot user even when the linked projects and tasks span multiple owners."
            />
            <label className="grid gap-2">
              <span className="text-sm font-medium text-white">Status</span>
              <select
                value={draft.status}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    status: event.target.value as Strategy["status"]
                  }))
                }
                className="min-h-10 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.3)]"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </label>
          </div>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-white">Overview</span>
            <Textarea
              value={draft.overview}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  overview: event.target.value
                }))
              }
              placeholder="What this strategy is coordinating, why it exists, and which human/bot actors it aligns."
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-white">End state</span>
            <Textarea
              value={draft.endStateDescription}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  endStateDescription: event.target.value
                }))
              }
              placeholder="Describe the finished future state this strategy is meant to reach."
            />
          </label>
        </Card>

        <Card className="grid gap-4">
          <div className="grid gap-2">
            <span className="text-sm font-medium text-white">
              Search cross-user entities
            </span>
            <div className="flex items-center gap-3 rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3">
              <Search className="size-4 text-white/42" />
              <Input
                className="border-none bg-transparent px-0 py-0"
                value={entitySearchQuery}
                onChange={(event) => setEntitySearchQuery(event.target.value)}
                placeholder="Search by title, owner, @handle, human, or bot"
              />
            </div>
            <div className="text-sm text-white/52">
              Target pickers, linked entities, and graph node selectors all use
              this search.
            </div>
          </div>

          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Target goals
            </div>
            <div className="mt-3 grid gap-2">
              {visibleGoals.map((goal) => {
                const selected = draft.targetGoalIds.includes(goal.id);
                return (
                  <label
                    key={goal.id}
                    className="flex items-start justify-between gap-3 rounded-[18px] bg-white/[0.04] px-4 py-3"
                  >
                    <div>
                      <div className="text-sm font-medium text-white">
                        {goal.title}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-white/52">
                        {formatOwnedEntityDescription(
                          goal.description,
                          goal.user,
                          "Goal"
                        )}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        setDraft((current) => ({
                          ...current,
                          targetGoalIds: toggleString(
                            current.targetGoalIds,
                            goal.id
                          )
                        }))
                      }
                    />
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Target projects
            </div>
            <div className="mt-3 grid gap-2">
              {visibleProjects.map((project) => {
                const selected = draft.targetProjectIds.includes(project.id);
                return (
                  <label
                    key={project.id}
                    className="flex items-start justify-between gap-3 rounded-[18px] bg-white/[0.04] px-4 py-3"
                  >
                    <div>
                      <div className="text-sm font-medium text-white">
                        {project.title}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-white/52">
                        {formatOwnedEntityDescription(
                          `${project.goalTitle}${project.goalTitle ? " · " : ""}${project.status}`,
                          project.user,
                          project.goalTitle
                        )}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        setDraft((current) => ({
                          ...current,
                          targetProjectIds: toggleString(
                            current.targetProjectIds,
                            project.id
                          )
                        }))
                      }
                    />
                  </label>
                );
              })}
            </div>
          </div>
        </Card>

        <Card className="grid gap-3">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Other linked entities
          </div>
          <div className="grid gap-2">
            {linkableEntities.map((option) => {
              const selected = draft.linkedEntities.some(
                (entry) =>
                  entry.entityType === option.entityType &&
                  entry.entityId === option.entityId
              );
              return (
                <label
                  key={option.key}
                  className="flex items-start justify-between gap-3 rounded-[18px] bg-white/[0.04] px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-medium text-white">
                      {option.label}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-white/52">
                      {option.description}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() =>
                      setDraft((current) => ({
                        ...current,
                        linkedEntities: toggleLinkedEntity(
                          current.linkedEntities,
                          {
                            entityType: option.entityType,
                            entityId: option.entityId
                          }
                        )
                      }))
                    }
                  />
                </label>
              );
            })}
          </div>
        </Card>

        <Card className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                Directed plan graph
              </div>
              <div className="mt-1 text-sm text-white/58">
                Order the project/task nodes and declare which nodes must finish
                before the next branch can open.
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    nodes: [...current.nodes, createDraftNode("project")]
                  }))
                }
              >
                <Plus className="size-4" />
                Project Node
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    nodes: [...current.nodes, createDraftNode("task")]
                  }))
                }
              >
                <Plus className="size-4" />
                Task Node
              </Button>
            </div>
          </div>

          <div className="grid gap-3">
            {draft.nodes.map((node, index) => {
              const predecessorOptions = draft.nodes.filter(
                (candidate) => candidate.id !== node.id
              );
              const selectedEntity =
                node.entityType === "project"
                  ? projectsById.get(node.entityId)
                  : tasksById.get(node.entityId);
              return (
                <div
                  key={node.id}
                  className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-white/[0.08] text-white/76">
                        Step {index + 1}
                      </Badge>
                      <Badge className="bg-white/[0.08] text-white/76">
                        {node.entityType}
                      </Badge>
                      {selectedEntity ? (
                        <Badge className="bg-[rgba(192,193,255,0.12)] text-white/82">
                          {"title" in selectedEntity
                            ? selectedEntity.title
                            : node.entityId}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={index === 0}
                        onClick={() =>
                          setDraft((current) => {
                            const nodes = current.nodes.slice();
                            const swap = nodes[index - 1];
                            nodes[index - 1] = nodes[index]!;
                            nodes[index] = swap!;
                            return { ...current, nodes };
                          })
                        }
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={index === draft.nodes.length - 1}
                        onClick={() =>
                          setDraft((current) => {
                            const nodes = current.nodes.slice();
                            const swap = nodes[index + 1];
                            nodes[index + 1] = nodes[index]!;
                            nodes[index] = swap!;
                            return { ...current, nodes };
                          })
                        }
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            nodes: current.nodes
                              .filter((entry) => entry.id !== node.id)
                              .map((entry) => ({
                                ...entry,
                                predecessorIds: entry.predecessorIds.filter(
                                  (predecessorId) => predecessorId !== node.id
                                )
                              }))
                          }))
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-white">
                        Entity type
                      </span>
                      <select
                        value={node.entityType}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            nodes: current.nodes.map((entry) =>
                              entry.id === node.id
                                ? {
                                    ...entry,
                                    entityType: event.target
                                      .value as StrategyDialogDraftNode["entityType"],
                                    entityId: ""
                                  }
                                : entry
                            )
                          }))
                        }
                        className="min-h-10 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.3)]"
                      >
                        <option value="project">Project</option>
                        <option value="task">Task</option>
                      </select>
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-white">
                        Linked entity
                      </span>
                      <select
                        value={node.entityId}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            nodes: current.nodes.map((entry) =>
                              entry.id === node.id
                                ? { ...entry, entityId: event.target.value }
                                : entry
                            )
                          }))
                        }
                        className="min-h-10 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.3)]"
                      >
                        <option value="">Select {node.entityType}</option>
                        {(node.entityType === "project"
                          ? visibleProjects
                          : visibleTasks
                        ).map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {formatOwnedEntityOptionLabel(
                              entry.title,
                              usersById.get(entry.userId ?? "") ??
                                entry.user ??
                                null
                            )}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-white">
                        Branch label
                      </span>
                      <Input
                        value={node.branchLabel}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            nodes: current.nodes.map((entry) =>
                              entry.id === node.id
                                ? {
                                    ...entry,
                                    branchLabel: event.target.value
                                  }
                                : entry
                            )
                          }))
                        }
                        placeholder="Fallback branch, scale-up path, recovery path"
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-white">
                        Notes
                      </span>
                      <Input
                        value={node.notes}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            nodes: current.nodes.map((entry) =>
                              entry.id === node.id
                                ? { ...entry, notes: event.target.value }
                                : entry
                            )
                          }))
                        }
                        placeholder="What has to be true before or after this node"
                      />
                    </label>
                  </div>

                  <div className="mt-4">
                    <div className="text-sm font-medium text-white">
                      Depends on
                    </div>
                    <div className="mt-2 grid gap-2">
                      {predecessorOptions.length === 0 ? (
                        <div className="rounded-[16px] bg-white/[0.04] px-4 py-3 text-sm text-white/52">
                          This is a start node with no prerequisites.
                        </div>
                      ) : (
                        predecessorOptions.map((candidate) => {
                          const candidateLabel =
                            candidate.entityType === "project"
                              ? (projectsById.get(candidate.entityId)?.title ??
                                "Project")
                              : (tasksById.get(candidate.entityId)?.title ??
                                "Task");
                          const candidateUser =
                            candidate.entityType === "project"
                              ? (projectsById.get(candidate.entityId)?.user ??
                                null)
                              : (tasksById.get(candidate.entityId)?.user ??
                                null);
                          return (
                            <label
                              key={candidate.id}
                              className="flex items-start justify-between gap-3 rounded-[16px] bg-white/[0.04] px-4 py-3"
                            >
                              <div>
                                <div className="text-sm font-medium text-white">
                                  {candidateLabel}
                                </div>
                                <div className="mt-1 text-xs text-white/52">
                                  {formatOwnedEntityDescription(
                                    candidate.entityType,
                                    candidateUser,
                                    candidate.entityType
                                  )}
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={node.predecessorIds.includes(
                                  candidate.id
                                )}
                                onChange={() =>
                                  setDraft((current) => ({
                                    ...current,
                                    nodes: current.nodes.map((entry) =>
                                      entry.id === node.id
                                        ? {
                                            ...entry,
                                            predecessorIds: toggleString(
                                              entry.predecessorIds,
                                              candidate.id
                                            )
                                          }
                                        : entry
                                    )
                                  }))
                                }
                              />
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {validationMessage ? (
          <div className="rounded-[18px] border border-amber-400/20 bg-amber-500/[0.08] px-4 py-3 text-sm text-amber-100/90">
            {validationMessage}
          </div>
        ) : null}
        {submitError ? (
          <div className="rounded-[18px] border border-rose-400/20 bg-rose-500/[0.08] px-4 py-3 text-sm text-rose-100/90">
            {submitError}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button
            type="button"
            pending={pending}
            pendingLabel="Saving strategy"
            onClick={() => void submitDraft()}
          >
            {editingStrategy ? "Save strategy" : "Create strategy"}
          </Button>
        </div>
      </div>
    </SheetScaffold>
  );
}
