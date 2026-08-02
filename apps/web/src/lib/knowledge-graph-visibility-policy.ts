import {
  KNOWLEDGE_GRAPH_RELATION_LABELS,
  type KnowledgeGraphEdge,
  type KnowledgeGraphEntityKind,
  type KnowledgeGraphNode,
  type KnowledgeGraphRelationKind
} from "@/lib/knowledge-graph-types";

export type KnowledgeGraphDisplayMode = "default" | "all";

export const DEFAULT_KNOWLEDGE_GRAPH_DESKTOP_NODE_BUDGET = 480;
export const DEFAULT_KNOWLEDGE_GRAPH_MOBILE_NODE_BUDGET = 280;

export type KnowledgeGraphDisclosureGroup =
  | "direction"
  | "knowledge"
  | "people-and-evidence"
  | "psyche"
  | "execution"
  | "time"
  | "learning"
  | "taxonomy"
  | "workspace";

export type KnowledgeGraphVisibilityPolicy = {
  label: string;
  defaultVisible: boolean;
  disclosureGroup: KnowledgeGraphDisclosureGroup;
  rationale: string;
};

export const KNOWLEDGE_GRAPH_NODE_VISIBILITY_POLICY = {
  goal: {
    label: "Goals",
    defaultVisible: true,
    disclosureGroup: "direction",
    rationale: "Goals explain what the work is trying to achieve."
  },
  strategy: {
    label: "Strategies",
    defaultVisible: true,
    disclosureGroup: "direction",
    rationale: "Strategies connect direction to the work chosen to deliver it."
  },
  project: {
    label: "Projects",
    defaultVisible: true,
    disclosureGroup: "execution",
    rationale: "Projects are the main navigable units of active delivery."
  },
  wiki_space: {
    label: "Wiki spaces",
    defaultVisible: true,
    disclosureGroup: "knowledge",
    rationale: "Wiki spaces provide stable landmarks for organized knowledge."
  },
  wiki_page: {
    label: "Wiki pages",
    defaultVisible: true,
    disclosureGroup: "knowledge",
    rationale:
      "Wiki pages contain durable knowledge worth exploring by default."
  },
  note: {
    label: "Notes",
    defaultVisible: true,
    disclosureGroup: "knowledge",
    rationale: "Notes are the primary connective tissue between Forge entities."
  },
  insight: {
    label: "Insights",
    defaultVisible: true,
    disclosureGroup: "knowledge",
    rationale:
      "Insights surface interpreted knowledge rather than raw activity."
  },
  person: {
    label: "People",
    defaultVisible: true,
    disclosureGroup: "people-and-evidence",
    rationale: "People provide essential ownership and relationship context."
  },
  artifact: {
    label: "Artifacts",
    defaultVisible: true,
    disclosureGroup: "people-and-evidence",
    rationale: "Artifacts are concrete evidence and outputs of the work."
  },
  value: {
    label: "Values",
    defaultVisible: true,
    disclosureGroup: "psyche",
    rationale: "Values explain durable motivations behind goals and behavior."
  },
  pattern: {
    label: "Patterns",
    defaultVisible: true,
    disclosureGroup: "psyche",
    rationale:
      "Patterns reveal recurring structure across behavior and decisions."
  },
  behavior: {
    label: "Behaviors",
    defaultVisible: true,
    disclosureGroup: "psyche",
    rationale:
      "Behaviors connect abstract psyche concepts to observable action."
  },
  belief: {
    label: "Beliefs",
    defaultVisible: true,
    disclosureGroup: "psyche",
    rationale: "Beliefs provide explanatory context for values and behaviors."
  },
  mode: {
    label: "Modes",
    defaultVisible: true,
    disclosureGroup: "psyche",
    rationale:
      "Modes summarize meaningful states without showing every session."
  },
  task: {
    label: "Tasks",
    defaultVisible: false,
    disclosureGroup: "execution",
    rationale:
      "Task volume can overwhelm higher-level direction in the overview."
  },
  habit: {
    label: "Habits",
    defaultVisible: false,
    disclosureGroup: "execution",
    rationale: "Habits are useful on demand but repetitive in a broad overview."
  },
  tag: {
    label: "Tags",
    defaultVisible: false,
    disclosureGroup: "taxonomy",
    rationale:
      "Tag hubs create dense taxonomy spokes that obscure semantic paths."
  },
  calendar_event: {
    label: "Calendar events",
    defaultVisible: false,
    disclosureGroup: "time",
    rationale: "Event volume is transient and can crowd out durable knowledge."
  },
  work_block: {
    label: "Work blocks",
    defaultVisible: false,
    disclosureGroup: "time",
    rationale:
      "Work blocks are detailed scheduling records best revealed on demand."
  },
  timebox: {
    label: "Timeboxes",
    defaultVisible: false,
    disclosureGroup: "time",
    rationale: "Timeboxes add execution detail that is noisy at overview scale."
  },
  mode_session: {
    label: "Mode sessions",
    defaultVisible: false,
    disclosureGroup: "time",
    rationale:
      "Individual sessions are high-volume evidence behind visible modes."
  },
  flashcard: {
    label: "Flashcards",
    defaultVisible: false,
    disclosureGroup: "learning",
    rationale:
      "Flashcards are granular learning records best found through search."
  },
  report: {
    label: "Reports",
    defaultVisible: false,
    disclosureGroup: "people-and-evidence",
    rationale:
      "Reports can be numerous and are supporting evidence in the overview."
  },
  event_type: {
    label: "Event types",
    defaultVisible: false,
    disclosureGroup: "taxonomy",
    rationale:
      "Event types are classification nodes rather than primary destinations."
  },
  emotion: {
    label: "Emotions",
    defaultVisible: false,
    disclosureGroup: "taxonomy",
    rationale:
      "Emotion taxonomy is valuable in focused analysis, not every overview."
  },
  workbench: {
    label: "Workbench",
    defaultVisible: false,
    disclosureGroup: "workspace",
    rationale:
      "Workbench topology describes application structure, not knowledge first."
  },
  functor: {
    label: "Functors",
    defaultVisible: false,
    disclosureGroup: "workspace",
    rationale:
      "Functor nodes are specialist workspace details available on demand."
  },
  chat: {
    label: "Chats",
    defaultVisible: false,
    disclosureGroup: "workspace",
    rationale:
      "Chats are conversational sources rather than calm overview landmarks."
  }
} satisfies Record<KnowledgeGraphEntityKind, KnowledgeGraphVisibilityPolicy>;

const DEFAULT_HIDDEN_RELATIONS = new Set<KnowledgeGraphRelationKind>([
  "tag_goal",
  "tag_task",
  "tag_strategy",
  "report_event_type",
  "report_emotion"
]);

const TAXONOMY_RELATIONS = new Set<KnowledgeGraphRelationKind>([
  "tag_goal",
  "tag_task",
  "tag_strategy",
  "report_event_type",
  "report_emotion"
]);

const WORKSPACE_RELATIONS = new Set<KnowledgeGraphRelationKind>([
  "workbench_flow",
  "workbench_surface",
  "workbench_route"
]);

const TIME_RELATIONS = new Set<KnowledgeGraphRelationKind>([
  "calendar_link",
  "timebox_task",
  "timebox_project",
  "mode_session_mode"
]);

function buildRelationPolicy(
  relationKind: KnowledgeGraphRelationKind
): KnowledgeGraphVisibilityPolicy {
  const defaultVisible = !DEFAULT_HIDDEN_RELATIONS.has(relationKind);
  const disclosureGroup = TAXONOMY_RELATIONS.has(relationKind)
    ? "taxonomy"
    : WORKSPACE_RELATIONS.has(relationKind)
      ? "workspace"
      : TIME_RELATIONS.has(relationKind)
        ? "time"
        : "knowledge";
  return {
    label: KNOWLEDGE_GRAPH_RELATION_LABELS[relationKind],
    defaultVisible,
    disclosureGroup,
    rationale: defaultVisible
      ? "This relation explains a useful semantic path between visible entities."
      : "This taxonomy relation is available on demand but adds dense overview spokes."
  };
}

export const KNOWLEDGE_GRAPH_RELATION_VISIBILITY_POLICY = {
  goal_project: buildRelationPolicy("goal_project"),
  goal_task: buildRelationPolicy("goal_task"),
  project_task: buildRelationPolicy("project_task"),
  tag_goal: buildRelationPolicy("tag_goal"),
  tag_task: buildRelationPolicy("tag_task"),
  tag_strategy: buildRelationPolicy("tag_strategy"),
  value_goal: buildRelationPolicy("value_goal"),
  value_project: buildRelationPolicy("value_project"),
  value_task: buildRelationPolicy("value_task"),
  strategy_target: buildRelationPolicy("strategy_target"),
  strategy_step: buildRelationPolicy("strategy_step"),
  strategy_link: buildRelationPolicy("strategy_link"),
  habit_link: buildRelationPolicy("habit_link"),
  entity_link: buildRelationPolicy("entity_link"),
  note_link: buildRelationPolicy("note_link"),
  wiki_parent: buildRelationPolicy("wiki_parent"),
  wiki_link: buildRelationPolicy("wiki_link"),
  calendar_link: buildRelationPolicy("calendar_link"),
  timebox_task: buildRelationPolicy("timebox_task"),
  timebox_project: buildRelationPolicy("timebox_project"),
  pattern_value: buildRelationPolicy("pattern_value"),
  pattern_belief: buildRelationPolicy("pattern_belief"),
  pattern_mode: buildRelationPolicy("pattern_mode"),
  behavior_pattern: buildRelationPolicy("behavior_pattern"),
  behavior_value: buildRelationPolicy("behavior_value"),
  behavior_belief: buildRelationPolicy("behavior_belief"),
  behavior_mode: buildRelationPolicy("behavior_mode"),
  belief_value: buildRelationPolicy("belief_value"),
  belief_behavior: buildRelationPolicy("belief_behavior"),
  belief_mode: buildRelationPolicy("belief_mode"),
  belief_report: buildRelationPolicy("belief_report"),
  mode_pattern: buildRelationPolicy("mode_pattern"),
  mode_behavior: buildRelationPolicy("mode_behavior"),
  mode_value: buildRelationPolicy("mode_value"),
  flashcard_value: buildRelationPolicy("flashcard_value"),
  flashcard_behavior: buildRelationPolicy("flashcard_behavior"),
  flashcard_pattern: buildRelationPolicy("flashcard_pattern"),
  flashcard_belief: buildRelationPolicy("flashcard_belief"),
  flashcard_mode: buildRelationPolicy("flashcard_mode"),
  flashcard_report: buildRelationPolicy("flashcard_report"),
  report_value: buildRelationPolicy("report_value"),
  report_pattern: buildRelationPolicy("report_pattern"),
  report_goal: buildRelationPolicy("report_goal"),
  report_project: buildRelationPolicy("report_project"),
  report_task: buildRelationPolicy("report_task"),
  report_behavior: buildRelationPolicy("report_behavior"),
  report_belief: buildRelationPolicy("report_belief"),
  report_mode: buildRelationPolicy("report_mode"),
  report_event_type: buildRelationPolicy("report_event_type"),
  report_emotion: buildRelationPolicy("report_emotion"),
  mode_session_mode: buildRelationPolicy("mode_session_mode"),
  workbench_flow: buildRelationPolicy("workbench_flow"),
  workbench_surface: buildRelationPolicy("workbench_surface"),
  workbench_route: buildRelationPolicy("workbench_route")
} satisfies Record<KnowledgeGraphRelationKind, KnowledgeGraphVisibilityPolicy>;

export type KnowledgeGraphPresentation = {
  visibleNodeIds: ReadonlySet<string>;
  visibleEdgeIds: ReadonlySet<string>;
  hiddenNodeCount: number;
  hiddenEdgeCount: number;
  disclosureReason: "default" | "all" | "query" | "focus";
};

export function resolveKnowledgeGraphPresentation({
  nodes,
  edges,
  displayMode,
  hasExplicitQuery,
  focusNodeId,
  nodeBudget = DEFAULT_KNOWLEDGE_GRAPH_DESKTOP_NODE_BUDGET,
  edgeBudget
}: {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  displayMode: KnowledgeGraphDisplayMode;
  hasExplicitQuery: boolean;
  focusNodeId: string | null;
  nodeBudget?: number;
  edgeBudget?: number;
}): KnowledgeGraphPresentation {
  const revealAll = displayMode === "all" || hasExplicitQuery;
  const visibleNodeIds = new Set<string>();
  const visibleEdgeIds = new Set<string>();

  const eligibleNodes = nodes.filter(
    (node) =>
      revealAll ||
      KNOWLEDGE_GRAPH_NODE_VISIBILITY_POLICY[node.entityKind].defaultVisible
  );
  const rankedEligibleNodes = [...eligibleNodes].sort(
    (left, right) =>
      right.importance - left.importance ||
      right.graphStats.degree - left.graphStats.degree ||
      (Date.parse(right.updatedAt ?? "") || 0) -
        (Date.parse(left.updatedAt ?? "") || 0) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id)
  );
  const anchorKinds = new Set<KnowledgeGraphEntityKind>([
    "goal",
    "strategy",
    "project",
    "wiki_space",
    "person",
    "value",
    "pattern",
    "behavior",
    "belief",
    "mode"
  ]);
  const focusExists =
    !!focusNodeId && nodes.some((node) => node.id === focusNodeId);

  if (focusExists && !revealAll) {
    visibleNodeIds.add(focusNodeId);
    for (const edge of edges) {
      if (edge.source === focusNodeId || edge.target === focusNodeId) {
        visibleNodeIds.add(edge.source);
        visibleNodeIds.add(edge.target);
      }
    }
  } else if (rankedEligibleNodes.length <= nodeBudget) {
    for (const node of rankedEligibleNodes) {
      visibleNodeIds.add(node.id);
    }
  } else {
    const priorityKinds = revealAll
      ? new Set(rankedEligibleNodes.map((node) => node.entityKind))
      : anchorKinds;
    const coveredAnchorKinds = new Set<KnowledgeGraphEntityKind>();
    for (const node of rankedEligibleNodes) {
      if (
        priorityKinds.has(node.entityKind) &&
        !coveredAnchorKinds.has(node.entityKind) &&
        visibleNodeIds.size < nodeBudget
      ) {
        visibleNodeIds.add(node.id);
        coveredAnchorKinds.add(node.entityKind);
      }
    }
    for (const node of rankedEligibleNodes) {
      if (visibleNodeIds.size >= nodeBudget) {
        break;
      }
      visibleNodeIds.add(node.id);
    }
  }

  if (focusExists && revealAll) {
    visibleNodeIds.add(focusNodeId);
    for (const edge of edges) {
      if (edge.source === focusNodeId || edge.target === focusNodeId) {
        visibleNodeIds.add(edge.source);
        visibleNodeIds.add(edge.target);
      }
    }
  }

  const resolvedEdgeBudget =
    edgeBudget ??
    Math.max(36, Math.min(220, Math.round(visibleNodeIds.size * 0.3)));

  const eligibleEdges = edges.filter((edge) => {
    const touchesFocus =
      !!focusNodeId &&
      (edge.source === focusNodeId || edge.target === focusNodeId);
    return (
      visibleNodeIds.has(edge.source) &&
      visibleNodeIds.has(edge.target) &&
      (revealAll ||
        touchesFocus ||
        KNOWLEDGE_GRAPH_RELATION_VISIBILITY_POLICY[edge.relationKind]
          .defaultVisible)
    );
  });
  const rankedEdges = [...eligibleEdges].sort(
    (left, right) =>
      Number(right.source === focusNodeId || right.target === focusNodeId) -
        Number(left.source === focusNodeId || left.target === focusNodeId) ||
      Number(right.structural) - Number(left.structural) ||
      right.strength - left.strength ||
      left.id.localeCompare(right.id)
  );

  if (rankedEdges.length <= resolvedEdgeBudget) {
    for (const edge of rankedEdges) {
      visibleEdgeIds.add(edge.id);
    }
  } else {
    for (const edge of rankedEdges) {
      if (edge.source === focusNodeId || edge.target === focusNodeId) {
        visibleEdgeIds.add(edge.id);
      }
    }
    const coveredNodeIds = new Set<string>();
    for (const edge of rankedEdges) {
      if (visibleEdgeIds.size >= resolvedEdgeBudget) break;
      if (
        !coveredNodeIds.has(edge.source) ||
        !coveredNodeIds.has(edge.target)
      ) {
        visibleEdgeIds.add(edge.id);
        coveredNodeIds.add(edge.source);
        coveredNodeIds.add(edge.target);
      }
    }
    for (const edge of rankedEdges) {
      if (visibleEdgeIds.size >= resolvedEdgeBudget) break;
      visibleEdgeIds.add(edge.id);
    }
  }

  return {
    visibleNodeIds,
    visibleEdgeIds,
    hiddenNodeCount: nodes.length - visibleNodeIds.size,
    hiddenEdgeCount: edges.length - visibleEdgeIds.size,
    disclosureReason: revealAll
      ? displayMode === "all"
        ? "all"
        : "query"
      : focusNodeId
        ? "focus"
        : "default"
  };
}
