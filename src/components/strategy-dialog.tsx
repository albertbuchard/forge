import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Link2,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2
} from "lucide-react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { Input } from "@/components/ui/input";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import { UserSelectField } from "@/components/ui/user-select-field";
import { createTask } from "@/lib/api";
import {
  buildStrategyContractChecks,
  isStrategyContractReady
} from "@/lib/strategy-contract";
import { buildStrategyAlignmentBreakdown } from "@/lib/strategy-metrics";
import type { QuickTaskInput } from "@/lib/schemas";
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
  formatOwnerSelectDefaultLabel
} from "@/lib/user-ownership";
import { cn } from "@/lib/utils";

type StrategyNodeDependencyMode =
  | "start"
  | "after_previous"
  | "parallel_with_previous"
  | "custom";

type StrategyDialogDraftNode = {
  id: string;
  entityType: "project" | "task";
  entityId: string;
  branchLabel: string;
  notes: string;
  dependencyMode: StrategyNodeDependencyMode;
  customPredecessorIds: string[];
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
  entityType: "goal" | "project" | "task" | "habit" | "strategy";
  entityId: string;
  label: string;
  description: string;
  user: UserSummary | null;
};

type InlineTaskDraft = {
  title: string;
  description: string;
  goalId: string;
  projectId: string;
  userId: string | null;
  priority: QuickTaskInput["priority"];
  effort: QuickTaskInput["effort"];
  energy: QuickTaskInput["energy"];
  points: number;
};

function normalize(text: string) {
  return text.trim().toLowerCase();
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

function sameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function createDraftNode(
  entityType: "project" | "task" = "project",
  options?: Partial<StrategyDialogDraftNode>
): StrategyDialogDraftNode {
  return {
    id: `strategy_node_${Math.random().toString(36).slice(2, 10)}`,
    entityType,
    entityId: "",
    branchLabel: "",
    notes: "",
    dependencyMode: "after_previous",
    customPredecessorIds: [],
    ...options
  };
}

function topologicallySortStrategyNodes(strategy: Strategy) {
  const nodeById = new Map(strategy.graph.nodes.map((node) => [node.id, node]));
  const incomingCount = new Map(
    strategy.graph.nodes.map((node) => [node.id, 0])
  );
  const outgoingById = new Map<string, string[]>();
  const originalOrderById = new Map(
    strategy.graph.nodes.map((node, index) => [node.id, index] as const)
  );

  for (const node of strategy.graph.nodes) {
    outgoingById.set(node.id, []);
  }
  for (const edge of strategy.graph.edges) {
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
    outgoingById.set(edge.from, [
      ...(outgoingById.get(edge.from) ?? []),
      edge.to
    ]);
  }

  const queue = strategy.graph.nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .sort(
      (left, right) =>
        (originalOrderById.get(left.id) ?? 0) -
        (originalOrderById.get(right.id) ?? 0)
    )
    .map((node) => node.id);
  const ordered: Strategy["graph"]["nodes"] = [];

  while (queue.length > 0) {
    queue.sort(
      (left, right) =>
        (originalOrderById.get(left) ?? 0) - (originalOrderById.get(right) ?? 0)
    );
    const currentId = queue.shift();
    if (!currentId) {
      continue;
    }
    const current = nodeById.get(currentId);
    if (!current) {
      continue;
    }
    ordered.push(current);
    for (const childId of outgoingById.get(currentId) ?? []) {
      const nextIncoming = (incomingCount.get(childId) ?? 0) - 1;
      incomingCount.set(childId, nextIncoming);
      if (nextIncoming === 0) {
        queue.push(childId);
      }
    }
  }

  return ordered.length === strategy.graph.nodes.length
    ? ordered
    : strategy.graph.nodes;
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
  const orderedNodes = topologicallySortStrategyNodes(strategy);

  return {
    title: strategy.title,
    overview: strategy.overview,
    endStateDescription: strategy.endStateDescription,
    status: strategy.status,
    userId: strategy.userId ?? null,
    targetGoalIds: strategy.targetGoalIds,
    targetProjectIds: strategy.targetProjectIds,
    linkedEntities: strategy.linkedEntities,
    nodes: orderedNodes.map((node, index) => {
      const predecessorIds = predecessorIdsByNode.get(node.id) ?? [];
      const previousNode = orderedNodes[index - 1];
      const previousPredecessors = previousNode
        ? (predecessorIdsByNode.get(previousNode.id) ?? [])
        : [];

      let dependencyMode: StrategyNodeDependencyMode = "custom";
      if (predecessorIds.length === 0) {
        dependencyMode = "start";
      } else if (
        previousNode &&
        sameStringSet(predecessorIds, [previousNode.id])
      ) {
        dependencyMode = "after_previous";
      } else if (
        previousNode &&
        predecessorIds.length > 0 &&
        sameStringSet(predecessorIds, previousPredecessors)
      ) {
        dependencyMode = "parallel_with_previous";
      }

      return createDraftNode(node.entityType, {
        id: node.id,
        entityId: node.entityId,
        branchLabel: node.branchLabel,
        notes: node.notes,
        dependencyMode,
        customPredecessorIds: predecessorIds
      });
    })
  };
}

function resolveDraftPredecessors(nodes: StrategyDialogDraftNode[]) {
  const predecessorIdsByNode = new Map<string, string[]>();
  const earlierIds = new Set<string>();

  for (const [index, node] of nodes.entries()) {
    const previousNode = nodes[index - 1];
    let predecessorIds: string[];

    switch (node.dependencyMode) {
      case "after_previous":
        predecessorIds = previousNode ? [previousNode.id] : [];
        break;
      case "parallel_with_previous":
        predecessorIds = previousNode
          ? [...(predecessorIdsByNode.get(previousNode.id) ?? [])]
          : [];
        break;
      case "custom":
        predecessorIds = node.customPredecessorIds.filter((id) =>
          earlierIds.has(id)
        );
        break;
      case "start":
      default:
        predecessorIds = [];
        break;
    }

    predecessorIdsByNode.set(node.id, predecessorIds);
    earlierIds.add(node.id);
  }

  return predecessorIdsByNode;
}

function hasGraphCycle(nodes: StrategyDialogDraftNode[]) {
  const predecessorIdsByNode = resolveDraftPredecessors(nodes);
  const visited = new Set<string>();
  const active = new Set<string>();

  function visit(nodeId: string): boolean {
    if (active.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }
    visited.add(nodeId);
    active.add(nodeId);
    for (const predecessorId of predecessorIdsByNode.get(nodeId) ?? []) {
      if (visit(predecessorId)) {
        return true;
      }
    }
    active.delete(nodeId);
    return false;
  }

  return nodes.some((node) => visit(node.id));
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
  nodes: [createDraftNode("project", { dependencyMode: "start" })]
};

function createInlineTaskDraft(
  defaultUserId: string | null,
  projects: ProjectSummary[]
): InlineTaskDraft {
  const firstProject = projects[0];
  return {
    title: "",
    description: "",
    goalId: firstProject?.goalId ?? "",
    projectId: firstProject?.id ?? "",
    userId: firstProject?.userId ?? defaultUserId,
    priority: "medium",
    effort: "deep",
    energy: "steady",
    points: 60
  };
}

function buildDraftGraph(
  draft: StrategyDialogDraft,
  projectsById: Map<string, ProjectSummary>,
  tasksById: Map<string, Task>
): Strategy["graph"] {
  const predecessorIdsByNode = resolveDraftPredecessors(draft.nodes);
  const includedNodeIds = new Set(
    draft.nodes.filter((node) => node.entityId).map((node) => node.id)
  );

  return {
    nodes: draft.nodes
      .filter((node) => node.entityId)
      .map((node) => ({
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
      !includedNodeIds.has(node.id)
        ? []
        : (predecessorIdsByNode.get(node.id) ?? [])
            .filter((predecessorId) => includedNodeIds.has(predecessorId))
            .map((predecessorId) => ({
              from: predecessorId,
              to: node.id,
              label: "",
              condition: ""
            }))
    )
  };
}

function projectProgress(project: ProjectSummary | undefined) {
  return (project?.progress ?? 0) / 100;
}

function taskProgress(task: Task | undefined) {
  switch (task?.status) {
    case "done":
      return 1;
    case "in_progress":
      return 0.66;
    case "focus":
      return 0.5;
    case "blocked":
      return 0.25;
    default:
      return 0;
  }
}

function buildDraftMetrics(options: {
  draft: StrategyDialogDraft;
  graph: Strategy["graph"];
  goals: DashboardGoal[];
  projects: ProjectSummary[];
  projectsById: Map<string, ProjectSummary>;
  tasks: Task[];
  tasksById: Map<string, Task>;
}): Strategy["metrics"] {
  const { draft, graph, goals, projects, projectsById, tasks, tasksById } =
    options;
  const nodeProgressById = new Map(
    graph.nodes.map(
      (node) =>
        [
          node.id,
          node.entityType === "project"
            ? projectProgress(projectsById.get(node.entityId))
            : taskProgress(tasksById.get(node.entityId))
        ] as const
    )
  );
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) {
    incoming.set(node.id, []);
  }
  for (const edge of graph.edges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }

  const completedNodeIds = graph.nodes
    .filter((node) => (nodeProgressById.get(node.id) ?? 0) >= 1)
    .map((node) => node.id);
  const startedNodeIds = graph.nodes
    .filter((node) => (nodeProgressById.get(node.id) ?? 0) > 0)
    .map((node) => node.id);
  const blockedNodeIds = graph.nodes
    .filter((node) =>
      node.entityType === "project"
        ? projectsById.get(node.entityId)?.status === "paused"
        : tasksById.get(node.entityId)?.status === "blocked"
    )
    .map((node) => node.id);
  const outOfOrderNodeIds = graph.nodes
    .filter((node) => {
      const progress = nodeProgressById.get(node.id) ?? 0;
      if (progress <= 0) {
        return false;
      }
      return (incoming.get(node.id) ?? []).some(
        (dependencyId) => (nodeProgressById.get(dependencyId) ?? 0) < 1
      );
    })
    .map((node) => node.id);
  const activeNodeIds = graph.nodes
    .filter((node) => {
      const progress = nodeProgressById.get(node.id) ?? 0;
      if (progress >= 1) {
        return false;
      }
      return (incoming.get(node.id) ?? []).every(
        (dependencyId) => (nodeProgressById.get(dependencyId) ?? 0) >= 1
      );
    })
    .map((node) => node.id);

  const goalsById = new Map(goals.map((goal) => [goal.id, goal] as const));
  const targetGoalScores = draft.targetGoalIds.map((goalId) => {
    const scopedTasks = tasks.filter((task) => task.goalId === goalId);
    if (scopedTasks.length === 0) {
      return goalsById.get(goalId)?.status === "completed" ? 1 : 0;
    }
    return (
      scopedTasks.filter((task) => task.status === "done").length /
      scopedTasks.length
    );
  });
  const targetProjectScores = draft.targetProjectIds.map((projectId) =>
    projectProgress(projectsById.get(projectId))
  );
  const targetScores = [...targetGoalScores, ...targetProjectScores];
  const nodeAverage =
    graph.nodes.length === 0
      ? 0
      : graph.nodes.reduce(
          (sum, node) => sum + (nodeProgressById.get(node.id) ?? 0),
          0
        ) / graph.nodes.length;
  const targetAverage =
    targetScores.length === 0
      ? nodeAverage
      : targetScores.reduce((sum, value) => sum + value, 0) /
        targetScores.length;

  const graphProjectIds = new Set(
    graph.nodes
      .filter((node) => node.entityType === "project")
      .map((node) => node.entityId)
  );
  const graphTaskIds = new Set(
    graph.nodes
      .filter((node) => node.entityType === "task")
      .map((node) => node.entityId)
  );
  const offPlanEntityKeys = new Set<string>();
  const offPlanActiveEntityKeys = new Set<string>();
  const offPlanCompletedEntityKeys = new Set<string>();

  for (const projectId of draft.targetProjectIds) {
    const project = projects.find((entry) => entry.id === projectId);
    if (
      project &&
      !graphProjectIds.has(project.id) &&
      project.status !== "completed"
    ) {
      const entityKey = `project:${project.id}`;
      offPlanEntityKeys.add(entityKey);
      offPlanActiveEntityKeys.add(entityKey);
    }
    for (const task of tasks.filter((entry) => entry.projectId === projectId)) {
      if (
        !graphTaskIds.has(task.id) &&
        ["focus", "in_progress", "done", "blocked"].includes(task.status)
      ) {
        const entityKey = `task:${task.id}`;
        offPlanEntityKeys.add(entityKey);
        if (task.status === "done") {
          offPlanCompletedEntityKeys.add(entityKey);
        } else {
          offPlanActiveEntityKeys.add(entityKey);
        }
      }
    }
  }

  for (const goalId of draft.targetGoalIds) {
    for (const task of tasks.filter((entry) => entry.goalId === goalId)) {
      if (
        !graphTaskIds.has(task.id) &&
        ["focus", "in_progress", "done", "blocked"].includes(task.status)
      ) {
        const entityKey = `task:${task.id}`;
        offPlanEntityKeys.add(entityKey);
        if (task.status === "done") {
          offPlanCompletedEntityKeys.add(entityKey);
        } else {
          offPlanActiveEntityKeys.add(entityKey);
        }
      }
    }
  }

  const totalNodes = Math.max(1, graph.nodes.length);
  const offPlanEntityCount = offPlanEntityKeys.size;
  const blockedRatio = blockedNodeIds.length / totalNodes;
  const planCoverageScore = Math.max(
    0,
    Math.min(100, Math.round(nodeAverage * 100))
  );
  const sequencingScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(100 - (outOfOrderNodeIds.length / totalNodes) * 100)
    )
  );
  const scopeDisciplineScore = Math.max(
    0,
    Math.min(100, Math.round(100 - (offPlanEntityCount / totalNodes) * 100))
  );
  const qualityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        Math.max(
          0,
          Math.min(1, targetAverage * 0.8 + (1 - blockedRatio) * 0.2)
        ) * 100
      )
    )
  );
  const targetProgressScore = Math.max(
    0,
    Math.min(100, Math.round(targetAverage * 100))
  );
  const alignmentScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        planCoverageScore * 0.35 +
          sequencingScore * 0.3 +
          scopeDisciplineScore * 0.2 +
          qualityScore * 0.15
      )
    )
  );

  return {
    alignmentScore,
    planCoverageScore,
    sequencingScore,
    scopeDisciplineScore,
    qualityScore,
    targetProgressScore,
    completedNodeCount: completedNodeIds.length,
    startedNodeCount: startedNodeIds.length,
    readyNodeCount: activeNodeIds.length,
    totalNodeCount: totalNodes,
    completedTargetCount: targetScores.filter((score) => score >= 1).length,
    totalTargetCount: targetScores.length,
    offPlanEntityCount,
    offPlanActiveEntityCount: offPlanActiveEntityKeys.size,
    offPlanCompletedEntityCount: offPlanCompletedEntityKeys.size,
    activeNodeIds: activeNodeIds.slice(0, 8),
    nextNodeIds: activeNodeIds.slice(0, 5),
    blockedNodeIds,
    outOfOrderNodeIds
  };
}

function SortableSequenceCard({
  node,
  index,
  total,
  projectsById,
  tasksById,
  usersById,
  allNodes,
  onUpdate,
  onRemove
}: {
  node: StrategyDialogDraftNode;
  index: number;
  total: number;
  projectsById: Map<string, ProjectSummary>;
  tasksById: Map<string, Task>;
  usersById: Map<string, UserSummary>;
  allNodes: StrategyDialogDraftNode[];
  onUpdate: (nodeId: string, patch: Partial<StrategyDialogDraftNode>) => void;
  onRemove: (nodeId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: node.id
  });
  const entity =
    node.entityType === "project"
      ? projectsById.get(node.entityId)
      : tasksById.get(node.entityId);
  const owner =
    entity && "userId" in entity && entity.userId
      ? (usersById.get(entity.userId) ?? entity.user ?? null)
      : null;
  const previousNodes = allNodes.slice(0, index);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
      className={cn(
        "min-w-0 overflow-hidden rounded-[24px] border border-white/8 bg-[rgba(8,14,26,0.8)] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.2)]",
        isDragging && "opacity-70"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            className="mt-1 rounded-full bg-white/[0.06] p-2 text-white/58 transition hover:bg-white/[0.1] hover:text-white"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-white/[0.08] text-white/76">
                Step {index + 1}
              </Badge>
              <Badge className="bg-white/[0.08] text-white/76">
                {node.entityType}
              </Badge>
              {entity ? (
                <EntityBadge
                  kind={node.entityType}
                  label={entity.title}
                  compact
                  gradient={false}
                />
              ) : null}
            </div>
            <div className="mt-3 text-base font-medium text-white">
              {entity?.title || "Select an entity for this step"}
            </div>
            <div className="mt-2 break-words text-sm leading-6 text-white/54">
              {node.notes ||
                (entity && "description" in entity ? entity.description : "") ||
                "Add an optional note if this phase needs intent or setup context."}
            </div>
            {owner ? (
              <div className="mt-3">
                <UserBadge user={owner} compact />
              </div>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full sm:w-auto"
          disabled={total === 1}
          onClick={() => onRemove(node.id)}
        >
          <Trash2 className="size-4" />
          Remove
        </Button>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <FlowField
          label="Relationship to the flow"
          labelHelp="Keep the sequence mostly linear in the form. Use parallel when this step should open beside the previous one, or custom only when the dependency is special."
        >
          <FlowChoiceGrid
            value={node.dependencyMode}
            columns={2}
            onChange={(value) =>
              onUpdate(node.id, {
                dependencyMode: value as StrategyNodeDependencyMode
              })
            }
            options={[
              {
                value: "start",
                label: "Start here",
                description: "This step opens immediately."
              },
              {
                value: "after_previous",
                label: "After previous",
                description: "Use the prior step as the gate."
              },
              {
                value: "parallel_with_previous",
                label: "Parallel with previous",
                description: "Open beside the prior branch."
              },
              {
                value: "custom",
                label: "Custom dependency",
                description: "Pick earlier steps manually."
              }
            ]}
          />
        </FlowField>

        <div className="grid gap-4">
          <FlowField label="Branch label">
            <Input
              value={node.branchLabel}
              onChange={(event) =>
                onUpdate(node.id, { branchLabel: event.target.value })
              }
              placeholder="Core path, fallback lane, support branch"
            />
          </FlowField>
          <FlowField label="Step note">
            <Textarea
              value={node.notes}
              onChange={(event) =>
                onUpdate(node.id, { notes: event.target.value })
              }
              placeholder="Explain what has to be true before or after this step."
            />
          </FlowField>
        </div>
      </div>

      {node.dependencyMode === "custom" ? (
        <div className="mt-4 rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
          <div className="text-sm font-medium text-white">Depends on</div>
          <div className="mt-3 grid gap-2">
            {previousNodes.length === 0 ? (
              <div className="text-sm text-white/52">
                No earlier steps available yet.
              </div>
            ) : (
              previousNodes.map((candidate) => {
                const candidateEntity =
                  candidate.entityType === "project"
                    ? projectsById.get(candidate.entityId)
                    : tasksById.get(candidate.entityId);
                return (
                  <label
                    key={candidate.id}
                    className="flex items-start justify-between gap-3 rounded-[16px] bg-white/[0.04] px-4 py-3"
                  >
                    <div>
                      <div className="text-sm font-medium text-white">
                        {candidateEntity?.title ||
                          `Step ${allNodes.indexOf(candidate) + 1}`}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-white/52">
                        {candidate.branchLabel || candidate.entityType}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={node.customPredecessorIds.includes(candidate.id)}
                      onChange={() =>
                        onUpdate(node.id, {
                          customPredecessorIds: toggleString(
                            node.customPredecessorIds,
                            candidate.id
                          )
                        })
                      }
                    />
                  </label>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
  initialStepId,
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
  initialStepId?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    input: Omit<StrategyDialogDraft, "nodes"> & { graph: Strategy["graph"] },
    strategyId?: string
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState<StrategyDialogDraft>(
    DEFAULT_STRATEGY_DRAFT
  );
  const [objectiveSearchQuery, setObjectiveSearchQuery] = useState("");
  const [contextSearchQuery, setContextSearchQuery] = useState("");
  const [sequenceSearchQuery, setSequenceSearchQuery] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdTasks, setCreatedTasks] = useState<Task[]>([]);
  const [inlineTaskDraft, setInlineTaskDraft] = useState<InlineTaskDraft>(
    createInlineTaskDraft(defaultUserId, projects)
  );
  const [showInlineTaskComposer, setShowInlineTaskComposer] = useState(false);
  const [inlineTaskError, setInlineTaskError] = useState<string | null>(null);
  const [inlineTaskPending, setInlineTaskPending] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextDraft = editingStrategy
      ? strategyToDraft(editingStrategy)
      : {
          ...DEFAULT_STRATEGY_DRAFT,
          userId: defaultUserId,
          nodes: [createDraftNode("project", { dependencyMode: "start" })]
        };
    setDraft(nextDraft);
    setObjectiveSearchQuery("");
    setContextSearchQuery("");
    setSequenceSearchQuery("");
    setCreatedTasks([]);
    setShowInlineTaskComposer(false);
    setInlineTaskDraft(
      createInlineTaskDraft(defaultUserId, projects).projectId &&
        nextDraft.targetProjectIds[0]
        ? {
            ...createInlineTaskDraft(defaultUserId, projects),
            goalId:
              projects.find(
                (project) => project.id === nextDraft.targetProjectIds[0]
              )?.goalId ?? "",
            projectId: nextDraft.targetProjectIds[0] ?? projects[0]?.id ?? "",
            userId:
              projects.find(
                (project) => project.id === nextDraft.targetProjectIds[0]
              )?.userId ?? defaultUserId
          }
        : createInlineTaskDraft(defaultUserId, projects)
    );
    setInlineTaskError(null);
    setSubmitError(null);
  }, [defaultUserId, editingStrategy, open, projects]);

  const objectiveQuery = useDeferredValue(objectiveSearchQuery);
  const contextQuery = useDeferredValue(contextSearchQuery);
  const sequenceQuery = useDeferredValue(sequenceSearchQuery);
  const allTasks = useMemo(() => {
    const createdIds = new Set(createdTasks.map((task) => task.id));
    return [
      ...createdTasks,
      ...tasks.filter((task) => !createdIds.has(task.id))
    ];
  }, [createdTasks, tasks]);
  const goalsById = useMemo(
    () => new Map(goals.map((goal) => [goal.id, goal] as const)),
    [goals]
  );
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects]
  );
  const tasksById = useMemo(
    () => new Map(allTasks.map((task) => [task.id, task] as const)),
    [allTasks]
  );
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user] as const)),
    [users]
  );
  const defaultUser = users.find((user) => user.id === defaultUserId) ?? null;
  const selectedStrategyUser =
    users.find((user) => user.id === draft.userId) ?? defaultUser;

  const matchesOwnedEntityQuery = (
    query: string,
    parts: Array<string | null | undefined>,
    user?: UserSummary | null
  ) => {
    const normalizedQuery = normalize(query);
    return (
      normalizedQuery.length === 0 ||
      buildOwnedEntitySearchText(parts, user).includes(normalizedQuery)
    );
  };

  const visibleGoals = useMemo(
    () =>
      goals.filter((goal) =>
        matchesOwnedEntityQuery(
          contextQuery,
          [goal.title, goal.description],
          goal.user
        )
      ),
    [contextQuery, goals]
  );
  const objectiveGoals = useMemo(
    () =>
      goals.filter((goal) =>
        matchesOwnedEntityQuery(
          objectiveQuery,
          [goal.title, goal.description],
          goal.user
        )
      ),
    [goals, objectiveQuery]
  );
  const objectiveProjects = useMemo(
    () =>
      projects.filter((project) =>
        matchesOwnedEntityQuery(
          objectiveQuery,
          [
            project.title,
            project.description,
            project.goalTitle,
            project.status
          ],
          project.user
        )
      ),
    [objectiveQuery, projects]
  );
  const visibleProjects = useMemo(
    () =>
      projects.filter((project) =>
        matchesOwnedEntityQuery(
          contextQuery,
          [
            project.title,
            project.description,
            project.goalTitle,
            project.status
          ],
          project.user
        )
      ),
    [contextQuery, projects]
  );
  const visibleTasks = useMemo(
    () =>
      allTasks.filter((task) =>
        matchesOwnedEntityQuery(
          contextQuery,
          [task.title, task.description, task.owner, task.status],
          task.user
        )
      ),
    [allTasks, contextQuery]
  );
  const visibleHabits = useMemo(
    () =>
      habits.filter((habit) =>
        matchesOwnedEntityQuery(
          contextQuery,
          [habit.title, habit.description, habit.frequency, habit.status],
          habit.user
        )
      ),
    [contextQuery, habits]
  );
  const visibleStrategies = useMemo(
    () =>
      strategies.filter(
        (strategy) =>
          strategy.id !== editingStrategy?.id &&
          matchesOwnedEntityQuery(
            contextQuery,
            [
              strategy.title,
              strategy.overview,
              strategy.endStateDescription,
              strategy.status
            ],
            strategy.user
          )
      ),
    [contextQuery, editingStrategy?.id, strategies]
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
        ),
        user: goal.user ?? null
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
        ),
        user: project.user ?? null
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
        ),
        user: task.user ?? null
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
        ),
        user: habit.user ?? null
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
        ),
        user: strategy.user ?? null
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

  const draftGraph = useMemo(
    () => buildDraftGraph(draft, projectsById, tasksById),
    [draft, projectsById, tasksById]
  );
  const draftMetrics = useMemo(
    () =>
      buildDraftMetrics({
        draft,
        graph: draftGraph,
        goals,
        projects,
        projectsById,
        tasks: allTasks,
        tasksById
      }),
    [allTasks, draft, draftGraph, goals, projects, projectsById, tasksById]
  );
  const contractChecks = useMemo(
    () => [
      ...buildStrategyContractChecks({
        title: draft.title,
        overview: draft.overview,
        endStateDescription: draft.endStateDescription,
        targetGoalIds: draft.targetGoalIds,
        targetProjectIds: draft.targetProjectIds,
        graph: draftGraph
      }),
      {
        id: "acyclic",
        label: "Graph stays directed and non-looping",
        satisfied: !hasGraphCycle(draft.nodes)
      }
    ],
    [
      draft.endStateDescription,
      draft.nodes,
      draft.overview,
      draft.targetGoalIds,
      draft.targetProjectIds,
      draft.title,
      draftGraph
    ]
  );
  const contractReady = useMemo(
    () =>
      isStrategyContractReady({
        title: draft.title,
        overview: draft.overview,
        endStateDescription: draft.endStateDescription,
        targetGoalIds: draft.targetGoalIds,
        targetProjectIds: draft.targetProjectIds,
        graph: draftGraph
      }),
    [
      draft.endStateDescription,
      draft.overview,
      draft.targetGoalIds,
      draft.targetProjectIds,
      draft.title,
      draftGraph
    ]
  );
  const alignmentBreakdown = useMemo(
    () => buildStrategyAlignmentBreakdown(draftMetrics),
    [draftMetrics]
  );

  const validationMessage = useMemo(() => {
    if (!draft.title.trim()) {
      return "Strategy title is required.";
    }
    if (draft.nodes.length === 0) {
      return "Add at least one project or task step.";
    }
    const seenEntityKeys = new Set<string>();
    for (const node of draft.nodes) {
      if (!node.entityId) {
        return "Every step needs a linked project or task.";
      }
      const entityKey = `${node.entityType}:${node.entityId}`;
      if (seenEntityKeys.has(entityKey)) {
        return "Each project or task should appear only once in the sequence.";
      }
      seenEntityKeys.add(entityKey);
    }
    if (hasGraphCycle(draft.nodes)) {
      return "Strategy graph must stay directed and non-loopy.";
    }
    return null;
  }, [draft.nodes, draft.title]);
  const stepErrorMessage = (stepId: string) => {
    if (stepId === "sequence") {
      return (
        submitError ??
        validationMessage ??
        (!contractReady
          ? "This can still be saved as a draft. Add the target plus the overview or end state later, then lock it as the contract from the strategy detail page."
          : null)
      );
    }
    return null;
  };

  const sequenceGoals = useMemo(
    () =>
      goals.filter((goal) =>
        matchesOwnedEntityQuery(
          sequenceQuery,
          [goal.title, goal.description],
          goal.user
        )
      ),
    [goals, sequenceQuery]
  );
  const sequenceProjects = useMemo(
    () =>
      projects.filter((project) =>
        matchesOwnedEntityQuery(
          sequenceQuery,
          [
            project.title,
            project.description,
            project.goalTitle,
            project.status
          ],
          project.user
        )
      ),
    [projects, sequenceQuery]
  );
  const sequenceTasks = useMemo(
    () =>
      allTasks.filter((task) =>
        matchesOwnedEntityQuery(
          sequenceQuery,
          [task.title, task.description, task.owner, task.status],
          task.user
        )
      ),
    [allTasks, sequenceQuery]
  );
  const targetGoalSet = useMemo(
    () => new Set(draft.targetGoalIds),
    [draft.targetGoalIds]
  );
  const targetProjectSet = useMemo(
    () => new Set(draft.targetProjectIds),
    [draft.targetProjectIds]
  );
  const sequenceEntityKeys = useMemo(
    () =>
      new Set(draft.nodes.map((node) => `${node.entityType}:${node.entityId}`)),
    [draft.nodes]
  );
  const selectedGoals = useMemo(
    () =>
      draft.targetGoalIds
        .map((goalId) => goalsById.get(goalId))
        .filter((goal): goal is DashboardGoal => Boolean(goal)),
    [draft.targetGoalIds, goalsById]
  );
  const selectedProjects = useMemo(
    () =>
      draft.targetProjectIds
        .map((projectId) => projectsById.get(projectId))
        .filter((project): project is ProjectSummary => Boolean(project)),
    [draft.targetProjectIds, projectsById]
  );
  const suggestedProjects = useMemo(
    () =>
      sequenceProjects.filter(
        (project) =>
          targetProjectSet.has(project.id) || targetGoalSet.has(project.goalId)
      ),
    [sequenceProjects, targetGoalSet, targetProjectSet]
  );
  const suggestedTasks = useMemo(
    () =>
      sequenceTasks.filter(
        (task) =>
          targetProjectSet.has(task.projectId ?? "") ||
          targetGoalSet.has(task.goalId ?? "")
      ),
    [sequenceTasks, targetGoalSet, targetProjectSet]
  );
  const limitedObjectiveGoals = useMemo(
    () => objectiveGoals.slice(0, 8),
    [objectiveGoals]
  );
  const limitedObjectiveProjects = useMemo(
    () => objectiveProjects.slice(0, 8),
    [objectiveProjects]
  );
  const limitedContextEntities = useMemo(
    () => linkableEntities.slice(0, 12),
    [linkableEntities]
  );
  const limitedSequenceGoals = useMemo(
    () => sequenceGoals.slice(0, 6),
    [sequenceGoals]
  );
  const limitedSequenceProjects = useMemo(
    () => sequenceProjects.slice(0, 8),
    [sequenceProjects]
  );
  const limitedSequenceTasks = useMemo(
    () => sequenceTasks.slice(0, 10),
    [sequenceTasks]
  );
  const limitedSuggestedProjects = useMemo(
    () => suggestedProjects.slice(0, 4),
    [suggestedProjects]
  );
  const limitedSuggestedTasks = useMemo(
    () => suggestedTasks.slice(0, 6),
    [suggestedTasks]
  );
  const inlineTaskProjects = useMemo(() => {
    if (!inlineTaskDraft.goalId) {
      return projects;
    }
    const matchingProjects = projects.filter(
      (project) => project.goalId === inlineTaskDraft.goalId
    );
    return matchingProjects.length > 0 ? matchingProjects : projects;
  }, [inlineTaskDraft.goalId, projects]);
  const hasSequenceQuery = sequenceQuery.length > 0;
  const hasSequenceResults =
    limitedSequenceGoals.length > 0 ||
    limitedSequenceProjects.length > 0 ||
    limitedSequenceTasks.length > 0;

  const updateNode = (
    nodeId: string,
    patch: Partial<StrategyDialogDraftNode>
  ) => {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...patch } : node
      )
    }));
  };

  const appendSequenceNode = (
    entityType: "project" | "task",
    entityId: string
  ) => {
    if (
      draft.nodes.some(
        (node) => node.entityType === entityType && node.entityId === entityId
      )
    ) {
      return;
    }
    setDraft((current) => ({
      ...current,
      nodes: [
        ...current.nodes,
        createDraftNode(entityType, {
          entityId,
          dependencyMode:
            current.nodes.length === 0 ? "start" : "after_previous"
        })
      ]
    }));
  };

  const removeNode = (nodeId: string) => {
    setDraft((current) => {
      const remaining = current.nodes.filter((node) => node.id !== nodeId);
      return {
        ...current,
        nodes: remaining.map((node, index) => ({
          ...node,
          dependencyMode:
            index === 0 && node.dependencyMode === "after_previous"
              ? "start"
              : node.dependencyMode,
          customPredecessorIds: node.customPredecessorIds.filter(
            (candidateId) => candidateId !== nodeId
          )
        }))
      };
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6
      }
    })
  );

  const handleSequenceDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) {
      return;
    }
    setDraft((current) => {
      const oldIndex = current.nodes.findIndex(
        (node) => node.id === event.active.id
      );
      const newIndex = current.nodes.findIndex(
        (node) => node.id === event.over?.id
      );
      if (oldIndex < 0 || newIndex < 0) {
        return current;
      }
      return {
        ...current,
        nodes: arrayMove(current.nodes, oldIndex, newIndex)
      };
    });
  };

  const openInlineTaskComposer = () => {
    const seededQuery = sequenceSearchQuery.trim();
    const targetProject =
      draft.targetProjectIds
        .map((projectId) => projectsById.get(projectId))
        .find((project): project is ProjectSummary => Boolean(project)) ??
      projectsById.get(inlineTaskDraft.projectId) ??
      projects[0] ??
      null;
    const nextGoalId = targetProject?.goalId ?? draft.targetGoalIds[0] ?? "";
    const nextProject =
      projects.find(
        (project) =>
          project.goalId === nextGoalId &&
          (targetProject ? project.id === targetProject.id : true)
      ) ??
      projects.find((project) => project.goalId === nextGoalId) ??
      targetProject;

    setInlineTaskDraft((current) => ({
      ...createInlineTaskDraft(defaultUserId, projects),
      title: seededQuery || current.title,
      description: current.description,
      goalId: nextGoalId,
      projectId: nextProject?.id ?? current.projectId,
      userId: nextProject?.userId ?? current.userId ?? defaultUserId
    }));
    setInlineTaskError(null);
    setShowInlineTaskComposer(true);
  };

  const submitInlineTask = async () => {
    const selectedProject = projectsById.get(inlineTaskDraft.projectId);
    if (!inlineTaskDraft.title.trim()) {
      setInlineTaskError("Task title is required.");
      return;
    }
    if (!selectedProject) {
      setInlineTaskError("Pick a project for the new task.");
      return;
    }

    setInlineTaskPending(true);
    setInlineTaskError(null);
    try {
      const taskOwner =
        usersById.get(inlineTaskDraft.userId ?? selectedProject.userId ?? "") ??
        selectedProject.user ??
        selectedStrategyUser ??
        defaultUser;
      const createdTask = (
        await createTask({
          title: inlineTaskDraft.title.trim(),
          description: inlineTaskDraft.description.trim(),
          owner: taskOwner?.displayName ?? "Albert",
          userId:
            inlineTaskDraft.userId ?? selectedProject.userId ?? draft.userId,
          goalId: selectedProject.goalId,
          projectId: selectedProject.id,
          priority: inlineTaskDraft.priority,
          status: "focus",
          effort: inlineTaskDraft.effort,
          energy: inlineTaskDraft.energy,
          dueDate: "",
          points: inlineTaskDraft.points,
          tagIds: [],
          notes: []
        })
      ).task;

      setCreatedTasks((current) => [createdTask, ...current]);
      appendSequenceNode("task", createdTask.id);
      setInlineTaskDraft({
        ...createInlineTaskDraft(defaultUserId, projects),
        goalId: selectedProject.goalId,
        projectId: selectedProject.id,
        userId: createdTask.userId ?? selectedProject.userId ?? draft.userId
      });
      setSequenceSearchQuery("");
      setShowInlineTaskComposer(false);
    } catch (error) {
      setInlineTaskError(
        error instanceof Error ? error.message : "Task creation failed."
      );
    } finally {
      setInlineTaskPending(false);
    }
  };

  const submitDraft = async () => {
    if (validationMessage) {
      setSubmitError(validationMessage);
      return;
    }
    try {
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
          graph: draftGraph
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

  const steps: Array<QuestionFlowStep<StrategyDialogDraft>> = [
    {
      id: "foundation",
      eyebrow: "Foundation",
      title: "Set the owner and the strategic frame",
      description:
        "Start with who owns the strategy, what the plan is called, and whether this should open as active, paused, or already landed.",
      render: (value, setValue) => (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)]">
            <FlowField label="Strategy title">
              <Input
                value={value.title}
                onChange={(event) => setValue({ title: event.target.value })}
                placeholder="Land the multi-user planning system"
              />
            </FlowField>
            <FlowField label="Status">
              <FlowChoiceGrid
                value={value.status}
                onChange={(next) =>
                  setValue({ status: next as Strategy["status"] })
                }
                options={[
                  {
                    value: "active",
                    label: "Active",
                    description: "Use this when the plan should drive work now."
                  },
                  {
                    value: "paused",
                    label: "Paused",
                    description:
                      "Keep the strategy visible without active pressure."
                  },
                  {
                    value: "completed",
                    label: "Completed",
                    description: "The end state is already landed."
                  }
                ]}
              />
            </FlowField>
          </div>

          <UserSelectField
            value={value.userId}
            users={users}
            onChange={(userId) => setValue({ userId })}
            label="Owner user"
            defaultLabel={formatOwnerSelectDefaultLabel(defaultUser)}
            help="Strategies can belong to a human or a bot even when the sequence spans multiple owners."
          />

          <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(135deg,rgba(192,193,255,0.16),rgba(125,211,252,0.08))] px-5 py-5">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/46">
              Live posture
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <EntityBadge
                kind="strategy"
                label={value.title.trim() || "Untitled strategy"}
                compact
                gradient={false}
              />
              <Badge className="bg-white/[0.12] text-white/86">
                {value.status}
              </Badge>
              {selectedStrategyUser ? (
                <UserBadge user={selectedStrategyUser} compact />
              ) : null}
            </div>
            <div className="mt-3 text-sm leading-6 text-white/62">
              This flow is built to keep strategy creation as guided as the
              other major entities in Forge: clear questions first, then a
              focused sequence stage at the end.
            </div>
          </div>
        </>
      )
    },
    {
      id: "objective",
      eyebrow: "Objective",
      title: "Define the objective and the end targets",
      description:
        "Capture what this strategy is coordinating, what done looks like, and which goals or projects are the real targets.",
      render: (value, setValue) => (
        <>
          <div className="grid gap-4">
            <FlowField label="Overview">
              <Textarea
                value={value.overview}
                onChange={(event) => setValue({ overview: event.target.value })}
                placeholder="Explain what this strategy is coordinating and why it matters right now."
              />
            </FlowField>
            <FlowField label="End state">
              <Textarea
                value={value.endStateDescription}
                onChange={(event) =>
                  setValue({ endStateDescription: event.target.value })
                }
                placeholder="Describe what reality should look like when this strategy lands."
              />
            </FlowField>
          </div>

          <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(21,28,44,0.9),rgba(12,17,30,0.88))] px-5 py-5">
            <FlowField
              label="Search goals or projects"
              description="Keep this page search-first. Add only the targets that truly define what this strategy is trying to land."
            >
              <div className="flex items-center gap-3 rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                <Search className="size-4 text-white/42" />
                <Input
                  className="border-none bg-transparent px-0 py-0"
                  value={objectiveSearchQuery}
                  onChange={(event) =>
                    setObjectiveSearchQuery(event.target.value)
                  }
                  placeholder="Search goals, projects, owners, humans, or bots"
                />
              </div>
            </FlowField>

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                  Selected goals
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedGoals.length === 0 ? (
                    <Badge className="bg-white/[0.08] text-white/62">
                      No target goals yet
                    </Badge>
                  ) : (
                    selectedGoals.map((goal) => (
                      <button
                        key={goal.id}
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full bg-[rgba(192,193,255,0.14)] px-3 py-1.5 text-sm text-white transition hover:bg-[rgba(192,193,255,0.2)]"
                        onClick={() =>
                          setValue({
                            targetGoalIds: toggleString(
                              value.targetGoalIds,
                              goal.id
                            )
                          })
                        }
                      >
                        <EntityBadge
                          kind="goal"
                          label={goal.title}
                          compact
                          gradient={false}
                        />
                        <span>Remove</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                  Selected projects
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedProjects.length === 0 ? (
                    <Badge className="bg-white/[0.08] text-white/62">
                      No target projects yet
                    </Badge>
                  ) : (
                    selectedProjects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full bg-[rgba(192,193,255,0.14)] px-3 py-1.5 text-sm text-white transition hover:bg-[rgba(192,193,255,0.2)]"
                        onClick={() =>
                          setValue({
                            targetProjectIds: toggleString(
                              value.targetProjectIds,
                              project.id
                            )
                          })
                        }
                      >
                        <EntityBadge
                          kind="project"
                          label={project.title}
                          compact
                          gradient={false}
                        />
                        <span>Remove</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                  Goal matches
                </div>
                {objectiveQuery ? (
                  <Badge className="bg-white/[0.08] text-white/72">
                    {objectiveGoals.length} found
                  </Badge>
                ) : null}
              </div>
              <div className="mt-3 grid gap-3">
                {!objectiveQuery ? (
                  <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/56">
                    Search for the goal this strategy is meant to land.
                  </div>
                ) : limitedObjectiveGoals.length === 0 ? (
                  <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/56">
                    No goals match this search yet.
                  </div>
                ) : (
                  limitedObjectiveGoals.map((goal) => {
                    const selected = value.targetGoalIds.includes(goal.id);
                    return (
                      <button
                        key={goal.id}
                        type="button"
                        className={cn(
                          "rounded-[22px] border px-4 py-4 text-left transition",
                          selected
                            ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white"
                            : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
                        )}
                        onClick={() =>
                          setValue({
                            targetGoalIds: toggleString(
                              value.targetGoalIds,
                              goal.id
                            )
                          })
                        }
                      >
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <EntityName
                            kind="goal"
                            label={goal.title}
                            className="max-w-full min-w-0"
                          />
                          <UserBadge user={goal.user} compact />
                        </div>
                        <div className="mt-2 text-sm leading-6 text-white/54">
                          {goal.description ||
                            "No strategic note attached yet."}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                  Project matches
                </div>
                {objectiveQuery ? (
                  <Badge className="bg-white/[0.08] text-white/72">
                    {objectiveProjects.length} found
                  </Badge>
                ) : null}
              </div>
              <div className="mt-3 grid gap-3">
                {!objectiveQuery ? (
                  <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/56">
                    Search for the concrete project this strategy should land or
                    organize.
                  </div>
                ) : limitedObjectiveProjects.length === 0 ? (
                  <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/56">
                    No projects match this search yet.
                  </div>
                ) : (
                  limitedObjectiveProjects.map((project) => {
                    const selected = value.targetProjectIds.includes(
                      project.id
                    );
                    return (
                      <button
                        key={project.id}
                        type="button"
                        className={cn(
                          "rounded-[22px] border px-4 py-4 text-left transition",
                          selected
                            ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white"
                            : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
                        )}
                        onClick={() =>
                          setValue({
                            targetProjectIds: toggleString(
                              value.targetProjectIds,
                              project.id
                            )
                          })
                        }
                      >
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <EntityName
                            kind="project"
                            label={project.title}
                            className="max-w-full min-w-0"
                            showIcon={false}
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="bg-white/[0.08] text-white/70">
                              {project.goalTitle}
                            </Badge>
                            <UserBadge user={project.user} compact />
                          </div>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-white/54">
                          {project.description ||
                            "No project summary attached yet."}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )
    },
    {
      id: "context",
      eyebrow: "Context",
      title: "Keep the right supporting entities in view",
      description:
        "Linked entities stay visible in the strategy context without becoming part of the main execution sequence.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Search supporting context"
            description="Search across goals, projects, tasks, habits, and other strategies."
          >
            <div className="flex items-center gap-3 rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
              <Search className="size-4 text-white/42" />
              <Input
                className="border-none bg-transparent px-0 py-0"
                value={contextSearchQuery}
                onChange={(event) => setContextSearchQuery(event.target.value)}
                placeholder="Search by title, owner, @handle, human, or bot"
              />
            </div>
          </FlowField>

          <div className="flex flex-wrap gap-2">
            {value.linkedEntities.length === 0 ? (
              <Badge className="bg-white/[0.08] text-white/62">
                No extra linked context yet
              </Badge>
            ) : (
              value.linkedEntities.map((entity) => {
                const option = linkableEntities.find(
                  (candidate) =>
                    candidate.entityType === entity.entityType &&
                    candidate.entityId === entity.entityId
                );
                return (
                  <button
                    key={`${entity.entityType}:${entity.entityId}`}
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full bg-[rgba(192,193,255,0.14)] px-3 py-1.5 text-sm text-white/82 transition hover:bg-[rgba(192,193,255,0.22)]"
                    onClick={() =>
                      setValue({
                        linkedEntities: value.linkedEntities.filter(
                          (entry) =>
                            !(
                              entry.entityType === entity.entityType &&
                              entry.entityId === entity.entityId
                            )
                        )
                      })
                    }
                  >
                    <Link2 className="mr-1 size-3.5" />
                    {option?.label ?? `${entity.entityType}:${entity.entityId}`}
                    <span>Remove</span>
                  </button>
                );
              })
            )}
          </div>

          <div className="grid gap-3">
            {!contextQuery ? (
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/56">
                Search when you want to pull another entity into the background
                context. This keeps the page focused instead of dumping every
                record into one long list.
              </div>
            ) : limitedContextEntities.length === 0 ? (
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/56">
                No supporting entities match this search yet.
              </div>
            ) : (
              limitedContextEntities.map((option) => {
                const selected = value.linkedEntities.some(
                  (entry) =>
                    entry.entityType === option.entityType &&
                    entry.entityId === option.entityId
                );
                return (
                  <label
                    key={option.key}
                    className={cn(
                      "flex items-start justify-between gap-3 rounded-[20px] border px-4 py-4",
                      selected
                        ? "border-[rgba(192,193,255,0.24)] bg-[rgba(192,193,255,0.12)]"
                        : "border-white/8 bg-white/[0.04]"
                    )}
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <EntityBadge
                          kind={option.entityType}
                          label={option.label}
                          compact
                          gradient={false}
                        />
                        {option.user ? (
                          <UserBadge user={option.user} compact />
                        ) : null}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-white/54">
                        {option.description}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        setValue({
                          linkedEntities: toggleLinkedEntity(
                            value.linkedEntities,
                            {
                              entityType: option.entityType,
                              entityId: option.entityId
                            }
                          )
                        })
                      }
                    />
                  </label>
                );
              })
            )}
          </div>
        </>
      )
    },
    {
      id: "sequence",
      eyebrow: "Sequence",
      title: "Build the execution sequence",
      description: "Search, add steps, and create missing tasks.",
      render: () => (
        <div className="grid min-w-0 gap-5">
          <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(21,28,44,0.9),rgba(12,17,30,0.88))] px-5 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                  Search and add
                </div>
                <div className="mt-2 text-sm leading-6 text-white/58">
                  Search goals, projects, tasks, humans, and bots.
                </div>
              </div>
              <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
                {draft.nodes.length} planned steps
              </Badge>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
              <Search className="size-4 text-white/42" />
              <Input
                className="border-none bg-transparent px-0 py-0"
                value={sequenceSearchQuery}
                onChange={(event) => setSequenceSearchQuery(event.target.value)}
                placeholder="Search goals, projects, tasks, owners, humans, or bots"
              />
            </div>

            <div className="mt-4 grid gap-3">
              <Button
                type="button"
                className="w-full justify-start"
                variant="secondary"
                onClick={openInlineTaskComposer}
              >
                <Plus className="size-4" />
                Create new task
              </Button>

              {showInlineTaskComposer ? (
                <div className="rounded-[22px] border border-white/8 bg-white/[0.04] px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">New task</div>
                      <div className="mt-1 text-sm text-white/54">
                        Add the task and place it in the sequence.
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full sm:w-auto"
                      onClick={() => {
                        setShowInlineTaskComposer(false);
                        setInlineTaskError(null);
                      }}
                    >
                      Close
                    </Button>
                  </div>

                  <div className="mt-4 grid gap-4">
                    <FlowField label="Task title">
                      <Input
                        value={inlineTaskDraft.title}
                        onChange={(event) =>
                          setInlineTaskDraft((current) => ({
                            ...current,
                            title: event.target.value
                          }))
                        }
                        placeholder="Draft the shared strategy hierarchy view"
                      />
                    </FlowField>

                    <div className="grid gap-4 md:grid-cols-2">
                      <FlowField label="Goal">
                        <select
                          value={inlineTaskDraft.goalId}
                          onChange={(event) => {
                            const nextGoalId = event.target.value;
                            const nextProject =
                              projects.find(
                                (project) => project.goalId === nextGoalId
                              ) ?? null;
                            setInlineTaskDraft((current) => ({
                              ...current,
                              goalId: nextGoalId,
                              projectId: nextProject?.id ?? "",
                              userId:
                                nextProject?.userId ??
                                current.userId ??
                                defaultUserId
                            }));
                          }}
                          className="min-h-10 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.3)]"
                        >
                          <option value="">Select goal</option>
                          {goals.map((goal) => (
                            <option key={goal.id} value={goal.id}>
                              {goal.title}
                            </option>
                          ))}
                        </select>
                      </FlowField>

                      <FlowField label="Project">
                        <select
                          value={inlineTaskDraft.projectId}
                          onChange={(event) =>
                            setInlineTaskDraft((current) => ({
                              ...current,
                              projectId: event.target.value,
                              goalId:
                                projectsById.get(event.target.value)?.goalId ??
                                current.goalId,
                              userId:
                                projectsById.get(event.target.value)?.userId ??
                                current.userId
                            }))
                          }
                          className="min-h-10 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.3)]"
                        >
                          <option value="">Select project</option>
                          {inlineTaskProjects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.title}
                            </option>
                          ))}
                        </select>
                      </FlowField>
                    </div>

                    <FlowField label="Notes">
                      <Textarea
                        value={inlineTaskDraft.description}
                        onChange={(event) =>
                          setInlineTaskDraft((current) => ({
                            ...current,
                            description: event.target.value
                          }))
                        }
                        placeholder="Optional detail or acceptance note."
                      />
                    </FlowField>

                    <div className="grid gap-4 md:grid-cols-2">
                      <FlowField label="Priority">
                        <select
                          value={inlineTaskDraft.priority}
                          onChange={(event) =>
                            setInlineTaskDraft((current) => ({
                              ...current,
                              priority: event.target
                                .value as InlineTaskDraft["priority"]
                            }))
                          }
                          className="min-h-10 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.3)]"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </FlowField>

                      <FlowField label="Points">
                        <Input
                          type="number"
                          value={inlineTaskDraft.points}
                          onChange={(event) =>
                            setInlineTaskDraft((current) => ({
                              ...current,
                              points: Number(event.target.value) || 0
                            }))
                          }
                        />
                      </FlowField>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <FlowField label="Effort">
                        <select
                          value={inlineTaskDraft.effort}
                          onChange={(event) =>
                            setInlineTaskDraft((current) => ({
                              ...current,
                              effort: event.target
                                .value as InlineTaskDraft["effort"]
                            }))
                          }
                          className="min-h-10 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.3)]"
                        >
                          <option value="light">Light</option>
                          <option value="deep">Deep</option>
                          <option value="extended">Extended</option>
                        </select>
                      </FlowField>

                      <FlowField label="Energy">
                        <select
                          value={inlineTaskDraft.energy}
                          onChange={(event) =>
                            setInlineTaskDraft((current) => ({
                              ...current,
                              energy: event.target
                                .value as InlineTaskDraft["energy"]
                            }))
                          }
                          className="min-h-10 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.3)]"
                        >
                          <option value="calm">Calm</option>
                          <option value="steady">Steady</option>
                          <option value="intense">Intense</option>
                        </select>
                      </FlowField>
                    </div>

                    {inlineTaskError ? (
                      <div className="rounded-[18px] border border-rose-400/20 bg-rose-500/[0.08] px-4 py-3 text-sm text-rose-100/90">
                        {inlineTaskError}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full sm:w-auto"
                        onClick={() => {
                          setShowInlineTaskComposer(false);
                          setInlineTaskError(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        className="w-full sm:w-auto"
                        pending={inlineTaskPending}
                        pendingLabel="Creating task"
                        onClick={() => void submitInlineTask()}
                      >
                        <Plus className="size-4" />
                        Create task
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {hasSequenceQuery ? (
                hasSequenceResults ? (
                  <div className="grid gap-3">
                    {limitedSequenceGoals.length > 0 ? (
                      <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                        Goals
                      </div>
                    ) : null}
                    {limitedSequenceGoals.map((goal) => {
                      const targeted = draft.targetGoalIds.includes(goal.id);
                      const linked = draft.linkedEntities.some(
                        (entry) =>
                          entry.entityType === "goal" &&
                          entry.entityId === goal.id
                      );
                      return (
                        <div
                          key={goal.id}
                          className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <EntityBadge
                                  kind="goal"
                                  label={goal.title}
                                  compact
                                  gradient={false}
                                />
                                <UserBadge user={goal.user} compact />
                              </div>
                              {goal.description ? (
                                <div className="mt-2 text-sm leading-6 text-white/54">
                                  {goal.description}
                                </div>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                className="w-full sm:w-auto"
                                variant={targeted ? "secondary" : "primary"}
                                onClick={() =>
                                  setDraft((current) => ({
                                    ...current,
                                    targetGoalIds: toggleString(
                                      current.targetGoalIds,
                                      goal.id
                                    )
                                  }))
                                }
                              >
                                {targeted ? "Targeted" : "Add target"}
                              </Button>
                              <Button
                                type="button"
                                className="w-full sm:w-auto"
                                variant="secondary"
                                onClick={() =>
                                  setDraft((current) => ({
                                    ...current,
                                    linkedEntities: toggleLinkedEntity(
                                      current.linkedEntities,
                                      {
                                        entityType: "goal",
                                        entityId: goal.id
                                      }
                                    )
                                  }))
                                }
                              >
                                {linked ? "Unlink" : "Link"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {limitedSequenceProjects.length > 0 ? (
                      <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                        Projects
                      </div>
                    ) : null}
                    {limitedSequenceProjects.map((project) => {
                      const inSequence = sequenceEntityKeys.has(
                        `project:${project.id}`
                      );
                      return (
                        <div
                          key={`sequence-project:${project.id}`}
                          className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <EntityBadge
                                  kind="project"
                                  label={project.title}
                                  compact
                                  gradient={false}
                                />
                                <Badge className="bg-white/[0.08] text-white/72">
                                  {project.goalTitle}
                                </Badge>
                                <UserBadge user={project.user} compact />
                              </div>
                              {project.description ? (
                                <div className="mt-2 text-sm leading-6 text-white/54">
                                  {project.description}
                                </div>
                              ) : null}
                            </div>
                            <Button
                              type="button"
                              className="w-full sm:w-auto"
                              variant={inSequence ? "secondary" : "primary"}
                              disabled={inSequence}
                              onClick={() =>
                                appendSequenceNode("project", project.id)
                              }
                            >
                              {inSequence ? "In sequence" : "Add step"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}

                    {limitedSequenceTasks.length > 0 ? (
                      <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                        Tasks
                      </div>
                    ) : null}
                    {limitedSequenceTasks.map((task) => {
                      const inSequence = sequenceEntityKeys.has(
                        `task:${task.id}`
                      );
                      return (
                        <div
                          key={`sequence-task:${task.id}`}
                          className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <EntityBadge
                                  kind="task"
                                  label={task.title}
                                  compact
                                  gradient={false}
                                />
                                <Badge className="bg-white/[0.08] text-white/72">
                                  {task.status}
                                </Badge>
                                <UserBadge user={task.user} compact />
                              </div>
                              <div className="mt-2 text-sm leading-6 text-white/54">
                                {task.description ||
                                  `${task.owner} · ${task.projectId}`}
                              </div>
                            </div>
                            <Button
                              type="button"
                              className="w-full sm:w-auto"
                              variant={inSequence ? "secondary" : "primary"}
                              disabled={inSequence}
                              onClick={() =>
                                appendSequenceNode("task", task.id)
                              }
                            >
                              {inSequence ? "In sequence" : "Add step"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/56">
                    No goals, projects, or tasks match this search.
                  </div>
                )
              ) : limitedSuggestedProjects.length > 0 ||
                limitedSuggestedTasks.length > 0 ? (
                <div className="grid gap-3">
                  <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                    Suggested from targets
                  </div>
                  {limitedSuggestedProjects.map((project) => {
                    const inSequence = sequenceEntityKeys.has(
                      `project:${project.id}`
                    );
                    return (
                      <div
                        key={`suggested-project:${project.id}`}
                        className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <EntityBadge
                                kind="project"
                                label={project.title}
                                compact
                                gradient={false}
                              />
                              <UserBadge user={project.user} compact />
                            </div>
                            <div className="mt-2 text-sm leading-6 text-white/54">
                              {project.description || project.goalTitle}
                            </div>
                          </div>
                          <Button
                            type="button"
                            className="w-full sm:w-auto"
                            variant={inSequence ? "secondary" : "primary"}
                            disabled={inSequence}
                            onClick={() =>
                              appendSequenceNode("project", project.id)
                            }
                          >
                            {inSequence ? "In sequence" : "Add step"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {limitedSuggestedTasks.map((task) => {
                    const inSequence = sequenceEntityKeys.has(
                      `task:${task.id}`
                    );
                    return (
                      <div
                        key={`suggested-task:${task.id}`}
                        className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <EntityBadge
                                kind="task"
                                label={task.title}
                                compact
                                gradient={false}
                              />
                              <UserBadge user={task.user} compact />
                            </div>
                            <div className="mt-2 text-sm leading-6 text-white/54">
                              {task.description ||
                                `${task.owner} · ${task.status}`}
                            </div>
                          </div>
                          <Button
                            type="button"
                            className="w-full sm:w-auto"
                            variant={inSequence ? "secondary" : "primary"}
                            disabled={inSequence}
                            onClick={() => appendSequenceNode("task", task.id)}
                          >
                            {inSequence ? "In sequence" : "Add step"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/56">
                  Type to search.
                </div>
              )}
            </div>
          </div>

          <div className="grid min-w-0 gap-4">
            <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-5 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                    Sequence
                  </div>
                  <div className="mt-2 text-sm leading-6 text-white/58">
                    Keep the flow mostly linear here. When a step should open
                    beside the previous one, switch it to parallel. Use custom
                    only for special joins.
                  </div>
                </div>
                <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
                  {draft.nodes.length} planned steps
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {draft.targetGoalIds.map((goalId) => {
                  const goal = goalsById.get(goalId);
                  return goal ? (
                    <EntityBadge
                      key={goalId}
                      kind="goal"
                      label={goal.title}
                      compact
                      gradient={false}
                    />
                  ) : null;
                })}
                {draft.targetProjectIds.map((projectId) => {
                  const project = projectsById.get(projectId);
                  return project ? (
                    <EntityBadge
                      key={projectId}
                      kind="project"
                      label={project.title}
                      compact
                      gradient={false}
                    />
                  ) : null;
                })}
              </div>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleSequenceDragEnd}
            >
              <SortableContext
                items={draft.nodes.map((node) => node.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="grid gap-3">
                  {draft.nodes.map((node, index) => (
                    <SortableSequenceCard
                      key={node.id}
                      node={node}
                      index={index}
                      total={draft.nodes.length}
                      projectsById={projectsById}
                      tasksById={tasksById}
                      usersById={usersById}
                      allNodes={draft.nodes}
                      onUpdate={updateNode}
                      onRemove={removeNode}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                Contract readiness
              </div>
              <div className="mt-3 grid gap-2">
                {contractChecks.map((check) => (
                  <div
                    key={check.id}
                    className="flex items-center justify-between gap-3 rounded-[14px] bg-white/[0.03] px-3 py-2"
                  >
                    <div className="text-sm text-white/62">{check.label}</div>
                    <Badge
                      className={
                        check.satisfied
                          ? "bg-emerald-500/12 text-emerald-200"
                          : "bg-amber-500/12 text-amber-200"
                      }
                    >
                      {check.satisfied ? "Ready" : "Missing"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                Alignment preview
              </div>
              <div className="mt-3 grid gap-3">
                {alignmentBreakdown.map((metric) => (
                  <div key={metric.id}>
                    <div className="flex items-center justify-between gap-3 text-sm text-white/60">
                      <span>{metric.label}</span>
                      <span>{metric.value}%</span>
                    </div>
                    <ProgressMeter value={metric.value} className="mt-2" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Strategy"
      title={editingStrategy ? "Edit strategy" : "Create strategy"}
      description="Strategies connect goals, projects, and tasks into a guided multi-step plan with a focused sequence builder at the end."
      value={draft}
      onChange={setDraft}
      steps={steps}
      initialStepId={initialStepId}
      contentClassName="lg:h-[min(56rem,calc(100vh-1rem))] lg:w-[min(78rem,calc(100vw-1.5rem))]"
      submitLabel={
        editingStrategy
          ? contractReady
            ? "Save strategy"
            : "Save draft"
          : contractReady
            ? "Create strategy"
            : "Create draft"
      }
      pending={pending}
      pendingLabel="Saving strategy"
      resolveError={stepErrorMessage}
      onSubmit={submitDraft}
    />
  );
}
