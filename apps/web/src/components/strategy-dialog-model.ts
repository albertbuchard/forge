import type { QuickTaskInput } from "@/lib/schemas";
import type {
  CrudEntityType,
  DashboardGoal,
  ProjectSummary,
  Strategy,
  Task
} from "@/lib/types";

export type StrategyNodeDependencyMode =
  | "start"
  | "after_previous"
  | "parallel_with_previous"
  | "custom";

export type StrategyDialogDraftNode = {
  id: string;
  entityType: "project" | "task";
  entityId: string;
  branchLabel: string;
  notes: string;
  dependencyMode: StrategyNodeDependencyMode;
  customPredecessorIds: string[];
};

export type StrategyDialogDraft = {
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

export type InlineTaskDraft = {
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

export function normalize(text: string) {
  return text.trim().toLowerCase();
}

export function toggleString(values: string[], nextValue: string) {
  return values.includes(nextValue)
    ? values.filter((value) => value !== nextValue)
    : [...values, nextValue];
}

export function toggleLinkedEntity(
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

export function createDraftNode(
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

export function strategyToDraft(strategy: Strategy): StrategyDialogDraft {
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

export function resolveDraftPredecessors(nodes: StrategyDialogDraftNode[]) {
  const predecessorIdsByNode = new Map<string, string[]>();
  const nodeIds = new Set(nodes.map((node) => node.id));

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
        predecessorIds = Array.from(
          new Set(
            node.customPredecessorIds.filter(
              (id) => id !== node.id && nodeIds.has(id)
            )
          )
        );
        break;
      case "start":
      default:
        predecessorIds = [];
        break;
    }

    predecessorIdsByNode.set(node.id, predecessorIds);
  }

  return predecessorIdsByNode;
}

export function hasGraphCycle(nodes: StrategyDialogDraftNode[]) {
  const predecessorIdsByNode = resolveDraftPredecessors(nodes);
  const outgoingByNode = new Map(
    nodes.map((node) => [node.id, [] as string[]] as const)
  );
  const incomingCount = new Map(
    nodes.map(
      (node) =>
        [node.id, predecessorIdsByNode.get(node.id)?.length ?? 0] as const
    )
  );
  for (const [nodeId, predecessorIds] of predecessorIdsByNode) {
    for (const predecessorId of predecessorIds) {
      outgoingByNode.get(predecessorId)?.push(nodeId);
    }
  }

  const queue = nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  let visitedCount = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index]!;
    visitedCount += 1;
    for (const nextId of outgoingByNode.get(nodeId) ?? []) {
      const nextIncoming = (incomingCount.get(nextId) ?? 0) - 1;
      incomingCount.set(nextId, nextIncoming);
      if (nextIncoming === 0) {
        queue.push(nextId);
      }
    }
  }
  return visitedCount !== nodes.length;
}

export const DEFAULT_STRATEGY_DRAFT: StrategyDialogDraft = {
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

export function createInlineTaskDraft(
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

export function buildDraftGraph(
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

export function buildDraftMetrics(options: {
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
