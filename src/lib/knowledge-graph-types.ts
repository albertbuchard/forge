import type { CrudEntityType, Note } from "@/lib/types";

export type KnowledgeGraphView = "graph" | "hierarchy";

export type KnowledgeGraphEntityType = CrudEntityType | "wiki_space" | "workbench_flow" | "workbench_surface";

export type KnowledgeGraphEntityKind =
  | "goal"
  | "project"
  | "task"
  | "strategy"
  | "habit"
  | "tag"
  | "note"
  | "wiki_page"
  | "wiki_space"
  | "insight"
  | "calendar_event"
  | "work_block"
  | "timebox"
  | "value"
  | "pattern"
  | "behavior"
  | "belief"
  | "mode"
  | "mode_session"
  | "report"
  | "event_type"
  | "emotion"
  | "workbench"
  | "functor"
  | "chat";

export type KnowledgeGraphRelationKind =
  | "goal_project"
  | "goal_task"
  | "project_task"
  | "tag_goal"
  | "tag_task"
  | "tag_strategy"
  | "value_goal"
  | "value_project"
  | "value_task"
  | "strategy_target"
  | "strategy_step"
  | "strategy_link"
  | "habit_link"
  | "note_link"
  | "wiki_parent"
  | "wiki_link"
  | "calendar_link"
  | "timebox_task"
  | "timebox_project"
  | "pattern_value"
  | "pattern_belief"
  | "pattern_mode"
  | "behavior_pattern"
  | "behavior_value"
  | "behavior_belief"
  | "behavior_mode"
  | "belief_value"
  | "belief_behavior"
  | "belief_mode"
  | "belief_report"
  | "mode_pattern"
  | "mode_behavior"
  | "mode_value"
  | "report_value"
  | "report_pattern"
  | "report_goal"
  | "report_project"
  | "report_task"
  | "report_behavior"
  | "report_belief"
  | "report_mode"
  | "report_event_type"
  | "report_emotion"
  | "mode_session_mode"
  | "workbench_flow"
  | "workbench_surface"
  | "workbench_route";

export type KnowledgeGraphRelationFamily =
  | "structural"
  | "contextual"
  | "taxonomy"
  | "workspace";

export type KnowledgeGraphPreviewStat = {
  label: string;
  value: string;
};

export type KnowledgeGraphTagRef = {
  id: string;
  label: string;
};

export type KnowledgeGraphNodeOwner = {
  userId: string | null;
  displayName: string | null;
  accentColor: string | null;
  kind: "human" | "bot" | null;
};

export type KnowledgeGraphNodeGraphStats = {
  degree: number;
  structuralDegree: number;
  contextualDegree: number;
  taxonomyDegree: number;
  workspaceDegree: number;
};

export type KnowledgeGraphNode = {
  id: string;
  entityType: KnowledgeGraphEntityType;
  entityId: string;
  entityKind: KnowledgeGraphEntityKind;
  title: string;
  subtitle: string;
  description: string;
  searchText?: string | null;
  href: string | null;
  graphHref: string;
  iconName: string | null;
  accentToken: string | null;
  size: number;
  importance: number;
  previewStats: KnowledgeGraphPreviewStat[];
  owner: KnowledgeGraphNodeOwner | null;
  tags: KnowledgeGraphTagRef[];
  updatedAt: string | null;
  graphStats: KnowledgeGraphNodeGraphStats;
};

export type KnowledgeGraphEdge = {
  id: string;
  source: string;
  target: string;
  relationKind: KnowledgeGraphRelationKind;
  family: KnowledgeGraphRelationFamily;
  label: string;
  strength: number;
  directional: boolean;
  structural: boolean;
};

export type KnowledgeGraphQuery = {
  q?: string | null;
  entityKinds?: KnowledgeGraphEntityKind[];
  relationKinds?: KnowledgeGraphRelationKind[];
  tags?: string[];
  owners?: string[];
  updatedFrom?: string | null;
  updatedTo?: string | null;
  limit?: number | null;
  focusNodeId?: string | null;
};

export type KnowledgeGraphFacetOption<T extends string = string> = {
  value: T;
  label: string;
  count: number;
};

export type KnowledgeGraphOwnerFacet = KnowledgeGraphNodeOwner & {
  userId: string;
  displayName: string;
  count: number;
};

export type KnowledgeGraphFacets = {
  entityKinds: KnowledgeGraphFacetOption<KnowledgeGraphEntityKind>[];
  relationKinds: KnowledgeGraphFacetOption<KnowledgeGraphRelationKind>[];
  tags: Array<KnowledgeGraphTagRef & { count: number }>;
  owners: KnowledgeGraphOwnerFacet[];
  updatedAt: {
    min: string | null;
    max: string | null;
  };
};

export type KnowledgeGraphPayload = {
  generatedAt: string;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  facets: KnowledgeGraphFacets;
  counts: {
    nodeCount: number;
    edgeCount: number;
    totalNodeCount: number;
    totalEdgeCount: number;
    filteredNodeCount: number;
    filteredEdgeCount: number;
    kinds: Record<string, number>;
    relationKinds: Record<string, number>;
    limited: boolean;
  };
};

export type KnowledgeGraphRelationGroup = {
  relationKind: KnowledgeGraphRelationKind;
  family: KnowledgeGraphRelationFamily;
  label: string;
  items: KnowledgeGraphNode[];
};

export type KnowledgeGraphFocusFamilyGroup = {
  family: KnowledgeGraphRelationFamily;
  label: string;
  relationCount: number;
  itemCount: number;
  relations: KnowledgeGraphRelationGroup[];
};

export type KnowledgeGraphFocusPayload = {
  generatedAt: string;
  focusNode: KnowledgeGraphNode | null;
  firstRingNodes: KnowledgeGraphNode[];
  neighborhoodEdges: KnowledgeGraphEdge[];
  familyGroups: KnowledgeGraphFocusFamilyGroup[];
  relationCounts: Record<KnowledgeGraphRelationFamily, number>;
  secondRingCounts: Record<KnowledgeGraphRelationFamily, number>;
};

export const KNOWLEDGE_GRAPH_HIERARCHY_LANES = [
  {
    id: "goals",
    label: "Goals",
    kinds: ["goal"]
  },
  {
    id: "strategies",
    label: "Strategies",
    kinds: ["strategy"]
  },
  {
    id: "projects",
    label: "Projects",
    kinds: ["project"]
  },
  {
    id: "tasks",
    label: "Tasks",
    kinds: ["task"]
  },
  {
    id: "wiki-spaces",
    label: "Wiki Spaces",
    kinds: ["wiki_space"]
  },
  {
    id: "knowledge",
    label: "Wiki Pages / Notes",
    kinds: ["wiki_page", "note"]
  },
  {
    id: "support",
    label: "Habits / Insights / Tags",
    kinds: ["habit", "insight", "tag"]
  },
  {
    id: "calendar",
    label: "Calendar",
    kinds: ["calendar_event", "work_block", "timebox"]
  },
  {
    id: "values",
    label: "Values",
    kinds: ["value"]
  },
  {
    id: "patterns",
    label: "Patterns",
    kinds: ["pattern"]
  },
  {
    id: "behaviors",
    label: "Behaviors",
    kinds: ["behavior"]
  },
  {
    id: "beliefs",
    label: "Beliefs",
    kinds: ["belief"]
  },
  {
    id: "modes",
    label: "Modes / Mode Sessions",
    kinds: ["mode", "mode_session"]
  },
  {
    id: "reports",
    label: "Reports / Event Types / Emotions",
    kinds: ["report", "event_type", "emotion"]
  },
  {
    id: "workbench",
    label: "Workbench / Functors / Chats",
    kinds: ["workbench", "functor", "chat"]
  }
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  kinds: readonly KnowledgeGraphEntityKind[];
}>;

export const KNOWLEDGE_GRAPH_HIERARCHY_ORDER: KnowledgeGraphEntityKind[] =
  KNOWLEDGE_GRAPH_HIERARCHY_LANES.flatMap((lane) => [...lane.kinds]);

export const KNOWLEDGE_GRAPH_RELATION_LABELS: Record<
  KnowledgeGraphRelationKind,
  string
> = {
  goal_project: "Goal to project",
  goal_task: "Goal to task",
  project_task: "Project to task",
  tag_goal: "Tag to goal",
  tag_task: "Tag to task",
  tag_strategy: "Tag to strategy",
  value_goal: "Value to goal",
  value_project: "Value to project",
  value_task: "Value to task",
  strategy_target: "Strategy target",
  strategy_step: "Strategy step",
  strategy_link: "Strategy context",
  habit_link: "Habit link",
  note_link: "Note link",
  wiki_parent: "Wiki parent",
  wiki_link: "Wiki link",
  calendar_link: "Calendar link",
  timebox_task: "Timebox to task",
  timebox_project: "Timebox to project",
  pattern_value: "Pattern to value",
  pattern_belief: "Pattern to belief",
  pattern_mode: "Pattern to mode",
  behavior_pattern: "Behavior to pattern",
  behavior_value: "Behavior to value",
  behavior_belief: "Behavior to belief",
  behavior_mode: "Behavior to mode",
  belief_value: "Belief to value",
  belief_behavior: "Belief to behavior",
  belief_mode: "Belief to mode",
  belief_report: "Belief to report",
  mode_pattern: "Mode to pattern",
  mode_behavior: "Mode to behavior",
  mode_value: "Mode to value",
  report_value: "Report to value",
  report_pattern: "Report to pattern",
  report_goal: "Report to goal",
  report_project: "Report to project",
  report_task: "Report to task",
  report_behavior: "Report to behavior",
  report_belief: "Report to belief",
  report_mode: "Report to mode",
  report_event_type: "Report to event type",
  report_emotion: "Report to emotion",
  mode_session_mode: "Mode session to mode",
  workbench_flow: "Workbench flow",
  workbench_surface: "Workbench surface",
  workbench_route: "Workbench route"
};

export const KNOWLEDGE_GRAPH_RELATION_FAMILY_LABELS: Record<
  KnowledgeGraphRelationFamily,
  string
> = {
  structural: "Structure",
  contextual: "Context",
  taxonomy: "Taxonomy",
  workspace: "Workspace"
};

export const KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP: Record<
  KnowledgeGraphRelationKind,
  KnowledgeGraphRelationFamily
> = {
  goal_project: "structural",
  goal_task: "structural",
  project_task: "structural",
  tag_goal: "taxonomy",
  tag_task: "taxonomy",
  tag_strategy: "taxonomy",
  value_goal: "contextual",
  value_project: "contextual",
  value_task: "contextual",
  strategy_target: "structural",
  strategy_step: "structural",
  strategy_link: "contextual",
  habit_link: "contextual",
  note_link: "contextual",
  wiki_parent: "structural",
  wiki_link: "contextual",
  calendar_link: "contextual",
  timebox_task: "structural",
  timebox_project: "contextual",
  pattern_value: "contextual",
  pattern_belief: "contextual",
  pattern_mode: "contextual",
  behavior_pattern: "structural",
  behavior_value: "contextual",
  behavior_belief: "contextual",
  behavior_mode: "contextual",
  belief_value: "contextual",
  belief_behavior: "contextual",
  belief_mode: "contextual",
  belief_report: "contextual",
  mode_pattern: "contextual",
  mode_behavior: "contextual",
  mode_value: "contextual",
  report_value: "contextual",
  report_pattern: "contextual",
  report_goal: "contextual",
  report_project: "contextual",
  report_task: "contextual",
  report_behavior: "contextual",
  report_belief: "contextual",
  report_mode: "contextual",
  report_event_type: "taxonomy",
  report_emotion: "taxonomy",
  mode_session_mode: "taxonomy",
  workbench_flow: "workspace",
  workbench_surface: "workspace",
  workbench_route: "workspace"
};

export function buildKnowledgeGraphNodeId(
  entityType: KnowledgeGraphEntityType,
  entityId: string
) {
  return `${entityType}:${entityId}`;
}

export function parseKnowledgeGraphFocusValue(
  value: string | null | undefined
): { entityType: KnowledgeGraphEntityType; entityId: string } | null {
  if (!value) {
    return null;
  }
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return null;
  }
  return {
    entityType: value.slice(0, separatorIndex) as KnowledgeGraphEntityType,
    entityId: value.slice(separatorIndex + 1)
  };
}

export function formatKnowledgeGraphFocusValue(
  entityType: KnowledgeGraphEntityType,
  entityId: string
) {
  return `${entityType}:${entityId}`;
}

export function getKnowledgeGraphEntityHref(
  entityType: KnowledgeGraphEntityType,
  entityId: string,
  options?: {
    noteKind?: Note["kind"] | null;
    noteSlug?: string | null;
    noteSpaceId?: string | null;
    workbenchKind?: "functor" | "chat" | null;
  }
) {
  switch (entityType) {
    case "goal":
      return `/goals/${entityId}`;
    case "project":
      return `/projects/${entityId}`;
    case "task":
      return `/tasks/${entityId}`;
    case "strategy":
      return `/strategies/${entityId}`;
    case "habit":
      return `/habits?focus=${encodeURIComponent(entityId)}`;
    case "tag":
      return `/tags?focus=${encodeURIComponent(entityId)}`;
    case "insight":
      return `/insights`;
    case "calendar_event":
    case "work_block_template":
    case "task_timebox":
      return `/calendar`;
    case "event_type":
    case "emotion_definition":
      return "/psyche/reports";
    case "psyche_value":
      return `/psyche/values?focus=${encodeURIComponent(entityId)}#values-atlas`;
    case "behavior_pattern":
      return `/psyche/patterns?focus=${encodeURIComponent(entityId)}#pattern-lanes`;
    case "behavior":
      return `/psyche/behaviors?focus=${encodeURIComponent(entityId)}#behavior-columns`;
    case "belief_entry":
      return `/psyche/schemas-beliefs?focus=${encodeURIComponent(entityId)}`;
    case "mode_profile":
      return `/psyche/modes?focus=${encodeURIComponent(entityId)}`;
    case "mode_guide_session":
      return `/psyche/modes`;
    case "trigger_report":
      return `/psyche/reports/${encodeURIComponent(entityId)}`;
    case "note":
      if (options?.noteKind === "wiki" && options.noteSlug) {
        const search =
          options.noteSpaceId && options.noteSpaceId.trim().length > 0
            ? `?spaceId=${encodeURIComponent(options.noteSpaceId)}`
            : "";
        return `/wiki/page/${encodeURIComponent(options.noteSlug)}${search}`;
      }
      return `/notes?entityType=note&entityId=${encodeURIComponent(entityId)}`;
    case "wiki_space":
      return `/wiki?spaceId=${encodeURIComponent(entityId)}`;
    case "workbench_flow":
      return `/workbench/${encodeURIComponent(entityId)}`;
    case "workbench_surface":
      return entityId === "workbench"
        ? "/workbench"
        : `/workbench?surface=${encodeURIComponent(entityId)}`;
    default:
      return null;
  }
}

export function buildKnowledgeGraphFocusHref(
  entityType: KnowledgeGraphEntityType,
  entityId: string,
  options?: {
    view?: KnowledgeGraphView | null;
    kinds?: Iterable<KnowledgeGraphEntityKind> | null;
    relations?: Iterable<KnowledgeGraphRelationKind> | null;
    query?: string | null;
  }
) {
  const search = new URLSearchParams();
  search.set("focus", formatKnowledgeGraphFocusValue(entityType, entityId));
  if (options?.view && options.view !== "graph") {
    search.set("view", options.view);
  }
  if (options?.query?.trim()) {
    search.set("q", options.query.trim());
  }
  for (const kind of options?.kinds ?? []) {
    search.append("kind", kind);
  }
  for (const relation of options?.relations ?? []) {
    search.append("relation", relation);
  }
  const query = search.toString();
  return query.length > 0 ? `/knowledge-graph?${query}` : "/knowledge-graph";
}
