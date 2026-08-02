import type {
  KnowledgeGraphEdge,
  KnowledgeGraphEntityKind,
  KnowledgeGraphFacets,
  KnowledgeGraphNode,
  KnowledgeGraphPayload,
  KnowledgeGraphRelationKind
} from "../../apps/web/src/lib/knowledge-graph-types";
import { KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP } from "../../apps/web/src/lib/knowledge-graph-types";
import { getKnowledgeGraphEntityHref } from "../../apps/web/src/lib/knowledge-graph-types";

export const PERFORMANCE_GRAPH_SIZES = {
  small: { nodes: 120, edges: 240 },
  medium: { nodes: 800, edges: 1_800 },
  large: { nodes: 2_500, edges: 6_000 }
} as const;

export type PerformanceGraphSize = keyof typeof PERFORMANCE_GRAPH_SIZES;

export const PERFORMANCE_NODE_KINDS = [
  "goal",
  "project",
  "task",
  "strategy",
  "habit",
  "tag",
  "note",
  "person",
  "wiki_page",
  "wiki_space",
  "insight",
  "calendar_event",
  "work_block",
  "timebox",
  "artifact",
  "value",
  "pattern",
  "behavior",
  "belief",
  "mode",
  "mode_session",
  "flashcard",
  "report",
  "event_type",
  "emotion",
  "workbench",
  "functor",
  "chat"
] as const satisfies readonly KnowledgeGraphEntityKind[];

export const PERFORMANCE_RELATION_KINDS = [
  "goal_project",
  "goal_task",
  "project_task",
  "tag_goal",
  "tag_task",
  "tag_strategy",
  "value_goal",
  "value_project",
  "value_task",
  "strategy_target",
  "strategy_step",
  "strategy_link",
  "habit_link",
  "entity_link",
  "note_link",
  "wiki_parent",
  "wiki_link",
  "calendar_link",
  "timebox_task",
  "timebox_project",
  "pattern_value",
  "pattern_belief",
  "pattern_mode",
  "behavior_pattern",
  "behavior_value",
  "behavior_belief",
  "behavior_mode",
  "belief_value",
  "belief_behavior",
  "belief_mode",
  "belief_report",
  "mode_pattern",
  "mode_behavior",
  "mode_value",
  "flashcard_value",
  "flashcard_behavior",
  "flashcard_pattern",
  "flashcard_belief",
  "flashcard_mode",
  "flashcard_report",
  "report_value",
  "report_pattern",
  "report_goal",
  "report_project",
  "report_task",
  "report_behavior",
  "report_belief",
  "report_mode",
  "report_event_type",
  "report_emotion",
  "mode_session_mode",
  "workbench_flow",
  "workbench_surface",
  "workbench_route"
] as const satisfies readonly KnowledgeGraphRelationKind[];

function entityTypeForKind(
  kind: KnowledgeGraphEntityKind
): KnowledgeGraphNode["entityType"] {
  if (kind === "wiki_space") return "wiki_space" as const;
  if (kind === "workbench") return "workbench_flow" as const;
  // The sealed performance fixture predates the narrower entity-type union.
  // Preserve its exact payload; the visual-story variant repairs story nodes
  // to their production entity type below.
  return kind as KnowledgeGraphNode["entityType"];
}

export function buildPerformanceGraphFixture(
  size: PerformanceGraphSize
): KnowledgeGraphPayload {
  const dimensions = PERFORMANCE_GRAPH_SIZES[size];
  const nodes: KnowledgeGraphNode[] = Array.from(
    { length: dimensions.nodes },
    (_, index) => {
      const kind =
        PERFORMANCE_NODE_KINDS[index % PERFORMANCE_NODE_KINDS.length]!;
      const entityId = `${size}-${kind}-${String(index).padStart(4, "0")}`;
      const importance = 1 - (index % 97) / 120;
      return {
        id: `${entityTypeForKind(kind)}:${entityId}`,
        entityType: entityTypeForKind(kind),
        entityId,
        entityKind: kind,
        title: `${kind.replaceAll("_", " ")} ${index + 1}`,
        subtitle:
          index % 11 === 0 ? "Exact benchmark target" : "Deterministic fixture",
        description: `Stable ${size} graph fixture node ${index + 1}.`,
        searchText: `${kind} benchmark target ${index + 1}`,
        href: kind === "tag" ? null : `/forge/${kind}/${entityId}`,
        graphHref: `/forge/knowledge-graph?focus=${encodeURIComponent(
          `${entityTypeForKind(kind)}:${entityId}`
        )}`,
        iconName: null,
        accentToken: null,
        size: 28 + Math.round(importance * 18),
        importance,
        previewStats: [{ label: "Fixture", value: size }],
        owner: null,
        tags: [],
        updatedAt: "2026-08-01T00:00:00.000Z",
        graphStats: {
          degree: 0,
          structuralDegree: 0,
          contextualDegree: 0,
          taxonomyDegree: 0,
          workspaceDegree: 0
        }
      };
    }
  );

  const edges: KnowledgeGraphEdge[] = [];
  for (let index = 0; index < dimensions.edges; index += 1) {
    const sourceIndex = index % nodes.length;
    let targetIndex =
      (sourceIndex +
        1 +
        ((index * 37 + Math.floor(index / 11)) % (nodes.length - 1))) %
      nodes.length;
    if (targetIndex === sourceIndex)
      targetIndex = (targetIndex + 1) % nodes.length;
    const relationKind =
      PERFORMANCE_RELATION_KINDS[index % PERFORMANCE_RELATION_KINDS.length]!;
    const family = KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP[relationKind];
    const edge: KnowledgeGraphEdge = {
      id: `fixture:${size}:edge:${index}`,
      source: nodes[sourceIndex]!.id,
      target: nodes[targetIndex]!.id,
      relationKind,
      family,
      label: relationKind.replaceAll("_", " "),
      strength: 0.55 + (index % 9) / 20,
      directional: index % 3 !== 0,
      structural: family === "structural"
    };
    edges.push(edge);
    const sourceStats = nodes[sourceIndex]!.graphStats;
    const targetStats = nodes[targetIndex]!.graphStats;
    sourceStats.degree += 1;
    targetStats.degree += 1;
    const key = `${family}Degree` as const;
    sourceStats[key] += 1;
    targetStats[key] += 1;
  }

  const facets: KnowledgeGraphFacets = {
    entityKinds: PERFORMANCE_NODE_KINDS.map((kind) => ({
      value: kind,
      label: kind.replaceAll("_", " "),
      count: nodes.filter((node) => node.entityKind === kind).length
    })),
    relationKinds: PERFORMANCE_RELATION_KINDS.map((relationKind) => ({
      value: relationKind,
      label: relationKind.replaceAll("_", " "),
      count: edges.filter((edge) => edge.relationKind === relationKind).length
    })),
    tags: [],
    owners: [],
    updatedAt: {
      min: "2026-08-01T00:00:00.000Z",
      max: "2026-08-01T00:00:00.000Z"
    }
  };

  return {
    generatedAt: "2026-08-01T00:00:00.000Z",
    nodes,
    edges,
    facets,
    counts: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      totalNodeCount: nodes.length,
      totalEdgeCount: edges.length,
      filteredNodeCount: nodes.length,
      filteredEdgeCount: edges.length,
      kinds: Object.fromEntries(
        facets.entityKinds.map((option) => [option.value, option.count])
      ),
      relationKinds: Object.fromEntries(
        facets.relationKinds.map((option) => [option.value, option.count])
      ),
      limited: false
    }
  };
}

const VISUAL_STORY_EDGE_SPECS = [
  {
    suffix: "goal-project",
    sourceIndex: 0,
    targetIndex: 1,
    relationKind: "goal_project"
  },
  {
    suffix: "project-task",
    sourceIndex: 1,
    targetIndex: 2,
    relationKind: "project_task"
  },
  {
    suffix: "task-note",
    sourceIndex: 2,
    targetIndex: 6,
    relationKind: "entity_link"
  },
  {
    suffix: "goal-task",
    sourceIndex: 0,
    targetIndex: 2,
    relationKind: "goal_task"
  },
  {
    suffix: "strategy-goal",
    sourceIndex: 3,
    targetIndex: 0,
    relationKind: "strategy_target"
  },
  {
    suffix: "value-goal",
    sourceIndex: 15,
    targetIndex: 0,
    relationKind: "value_goal"
  }
] as const satisfies ReadonlyArray<{
  suffix: string;
  sourceIndex: number;
  targetIndex: number;
  relationKind: KnowledgeGraphRelationKind;
}>;

export const VISUAL_STORY_FIXTURE_VERSION = "visual-story-v2";

function productionEntityTypeForKind(
  kind: KnowledgeGraphEntityKind
): KnowledgeGraphNode["entityType"] {
  switch (kind) {
    case "wiki_page":
      return "note";
    case "work_block":
      return "work_block_template";
    case "timebox":
      return "task_timebox";
    case "value":
      return "psyche_value";
    case "pattern":
      return "behavior_pattern";
    case "belief":
      return "belief_entry";
    case "mode":
      return "mode_profile";
    case "mode_session":
      return "mode_guide_session";
    case "report":
      return "trigger_report";
    case "emotion":
      return "emotion_definition";
    case "workbench":
    case "functor":
    case "chat":
      return "workbench_flow";
    default:
      return kind;
  }
}

function resetVisualStoryGraphStats(nodes: KnowledgeGraphNode[]) {
  nodes.forEach((node) => {
    node.graphStats = {
      degree: 0,
      structuralDegree: 0,
      contextualDegree: 0,
      taxonomyDegree: 0,
      workspaceDegree: 0
    };
  });
}

function rebuildVisualStoryDerivedValues(payload: KnowledgeGraphPayload) {
  resetVisualStoryGraphStats(payload.nodes);
  const nodeById = new Map(payload.nodes.map((node) => [node.id, node]));
  payload.edges.forEach((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return;
    source.graphStats.degree += 1;
    target.graphStats.degree += 1;
    const degreeKey = `${edge.family}Degree` as const;
    source.graphStats[degreeKey] += 1;
    target.graphStats[degreeKey] += 1;
  });
  payload.facets.relationKinds = PERFORMANCE_RELATION_KINDS.map(
    (relationKind) => ({
      value: relationKind,
      label: relationKind.replaceAll("_", " "),
      count: payload.edges.filter((edge) => edge.relationKind === relationKind)
        .length
    })
  );
  payload.counts.relationKinds = Object.fromEntries(
    payload.facets.relationKinds.map((option) => [option.value, option.count])
  );
}

export function buildVisualStoryGraphFixture(
  size: PerformanceGraphSize
): KnowledgeGraphPayload {
  const payload = structuredClone(buildPerformanceGraphFixture(size));
  const productionNodeIds = new Map<string, string>();
  payload.nodes.forEach((node) => {
    const originalId = node.id;
    node.entityType = productionEntityTypeForKind(node.entityKind);
    node.id = `${node.entityType}:${node.entityId}`;
    node.href = getKnowledgeGraphEntityHref(node.entityType, node.entityId);
    node.graphHref = `/forge/knowledge-graph?focus=${encodeURIComponent(
      node.id
    )}`;
    productionNodeIds.set(originalId, node.id);
  });
  payload.edges.forEach((edge) => {
    edge.source = productionNodeIds.get(edge.source) ?? edge.source;
    edge.target = productionNodeIds.get(edge.target) ?? edge.target;
  });
  const storyEdges = VISUAL_STORY_EDGE_SPECS.map((spec) => {
    const source = payload.nodes[spec.sourceIndex]!;
    const target = payload.nodes[spec.targetIndex]!;
    const family = KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP[spec.relationKind];
    return {
      id: `fixture:${size}:story:${spec.suffix}`,
      source: source.id,
      target: target.id,
      relationKind: spec.relationKind,
      family,
      label: spec.relationKind.replaceAll("_", " "),
      strength: 1.15,
      directional: true,
      structural: family === "structural"
    } satisfies KnowledgeGraphEdge;
  });
  payload.edges.splice(0, storyEdges.length, ...storyEdges);
  rebuildVisualStoryDerivedValues(payload);
  return payload;
}
