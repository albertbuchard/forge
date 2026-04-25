import { getDatabase } from "../db.js";
import { listInsights } from "../repositories/collaboration.js";
import {
  listCalendarEvents,
  listTaskTimeboxes,
  listWorkBlockTemplates
} from "../repositories/calendar.js";
import { filterOwnedEntities } from "../repositories/entity-ownership.js";
import { listGoals } from "../repositories/goals.js";
import { listHabits } from "../repositories/habits.js";
import { listNotes } from "../repositories/notes.js";
import {
  listBehaviors,
  listBehaviorPatterns,
  listBeliefEntries,
  listEmotionDefinitions,
  listEventTypes,
  listModeGuideSessions,
  listModeProfiles,
  listPsycheValues,
  listTriggerReports
} from "../repositories/psyche.js";
import { listStrategies } from "../repositories/strategies.js";
import { listTags } from "../repositories/tags.js";
import { listTasks } from "../repositories/tasks.js";
import {
  listWikiSpaces
} from "../repositories/wiki-memory.js";
import { listProjectSummaries } from "./projects.js";
import { listAiConnectors } from "../repositories/ai-connectors.js";
import {
  buildKnowledgeGraphFacets,
  buildKnowledgeGraphFocusPayload,
  filterKnowledgeGraphData,
  selectKnowledgeGraphVisibleNodeIds
} from "../../../src/lib/knowledge-graph.js";
import { getEntityVisual } from "../../../src/lib/entity-visuals.js";
import {
  KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP,
  KNOWLEDGE_GRAPH_RELATION_LABELS,
  buildKnowledgeGraphFocusHref,
  buildKnowledgeGraphNodeId,
  getKnowledgeGraphEntityHref,
  type KnowledgeGraphEdge,
  type KnowledgeGraphEntityKind,
  type KnowledgeGraphEntityType,
  type KnowledgeGraphFocusPayload,
  type KnowledgeGraphNode,
  type KnowledgeGraphPayload,
  type KnowledgeGraphQuery,
  type KnowledgeGraphRelationGroup,
  type KnowledgeGraphRelationKind
} from "../../../src/lib/knowledge-graph-types.js";

type OwnedLike = {
  userId?: string | null;
  user?: {
    displayName: string;
    accentColor: string;
    kind: "human" | "bot";
  } | null;
};

type WikiLinkRow = {
  source_note_id: string;
  target_type: "page" | "entity" | "unresolved";
  target_note_id: string | null;
  target_entity_type: KnowledgeGraphEntityType | null;
  target_entity_id: string | null;
};

const GRAPH_RANGE = {
  from: "2000-01-01T00:00:00.000Z",
  to: "2100-01-01T00:00:00.000Z"
} as const;

const KNOWLEDGE_GRAPH_NOTE_LIMIT = 2000;

const BASE_NODE_SIZE: Record<KnowledgeGraphEntityKind, number> = {
  goal: 56,
  strategy: 52,
  project: 48,
  task: 42,
  tag: 30,
  wiki_space: 40,
  wiki_page: 38,
  note: 34,
  habit: 36,
  insight: 34,
  calendar_event: 34,
  work_block: 32,
  timebox: 33,
  value: 38,
  pattern: 38,
  behavior: 38,
  belief: 38,
  mode: 38,
  mode_session: 34,
  report: 40,
  event_type: 32,
  emotion: 30,
  workbench: 42,
  functor: 36,
  chat: 36
};

const WORKBENCH_SURFACE_ROUTES: Record<
  string,
  { title: string; subtitle: string; href: string }
> = {
  workbench: {
    title: "Workbench",
    subtitle: "Global graph flows",
    href: "/workbench"
  },
  overview: {
    title: "Overview Surface",
    subtitle: "Operator overview workspace",
    href: "/overview"
  },
  today: {
    title: "Today Surface",
    subtitle: "Execution workspace",
    href: "/today"
  },
  goals: {
    title: "Goals Surface",
    subtitle: "Goal planning workspace",
    href: "/goals"
  },
  projects: {
    title: "Projects Surface",
    subtitle: "Project execution workspace",
    href: "/projects"
  },
  kanban: {
    title: "Kanban Surface",
    subtitle: "Task board workspace",
    href: "/kanban"
  },
  notes: {
    title: "Notes Surface",
    subtitle: "Notes and evidence workspace",
    href: "/notes"
  },
  calendar: {
    title: "Calendar Surface",
    subtitle: "Calendar planning workspace",
    href: "/calendar"
  },
  psyche: {
    title: "Psyche Surface",
    subtitle: "Psyche workspace",
    href: "/psyche"
  },
  wiki: {
    title: "KarpaWiki Surface",
    subtitle: "KarpaWiki memory workspace",
    href: "/wiki"
  },
  strategies: {
    title: "Strategies Surface",
    subtitle: "Strategy design workspace",
    href: "/strategies"
  },
  preferences: {
    title: "Preferences Surface",
    subtitle: "Preference workspace",
    href: "/preferences"
  },
  questionnaires: {
    title: "Questionnaires Surface",
    subtitle: "Questionnaire workspace",
    href: "/questionnaires"
  },
  review: {
    title: "Review Surface",
    subtitle: "Weekly review workspace",
    href: "/weekly-review"
  },
  movement: {
    title: "Movement Surface",
    subtitle: "Movement workspace",
    href: "/movement"
  },
  sleep: {
    title: "Sleep Surface",
    subtitle: "Sleep workspace",
    href: "/sleep"
  },
  sports: {
    title: "Sports Surface",
    subtitle: "Sports workspace",
    href: "/sports"
  }
};

function truncate(value: string | null | undefined, max = 160) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1).trimEnd()}...`;
}

function buildOwner(owner: OwnedLike | null | undefined) {
  if (!owner?.user) {
    return null;
  }
  return {
    userId: owner.userId ?? null,
    displayName: owner.user.displayName,
    accentColor: owner.user.accentColor,
    kind: owner.user.kind
  };
}

function makeNode(input: {
  entityType: KnowledgeGraphEntityType;
  entityId: string;
  entityKind: KnowledgeGraphEntityKind;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  searchText?: string | null;
  previewStats?: Array<{ label: string; value: string | number | null | undefined }>;
  owner?: OwnedLike | null;
  tags?: Array<{ id: string; label: string }>;
  href?: string | null;
  updatedAt?: string | null;
}) {
  const previewStats = (input.previewStats ?? [])
    .filter((stat) => stat.value !== null && stat.value !== undefined && `${stat.value}`.trim().length > 0)
    .slice(0, 3)
    .map((stat) => ({
      label: stat.label,
      value: String(stat.value)
    }));

  return {
    id: buildKnowledgeGraphNodeId(input.entityType, input.entityId),
    entityType: input.entityType,
    entityId: input.entityId,
    entityKind: input.entityKind,
    title: truncate(input.title, 90) || input.entityId,
    subtitle: truncate(input.subtitle, 120),
    description: truncate(input.description, 220),
    searchText: truncate(input.searchText, 4000) || null,
    href: input.href ?? null,
    graphHref: buildKnowledgeGraphFocusHref(input.entityType, input.entityId),
    iconName: null,
    accentToken: null,
    size: BASE_NODE_SIZE[input.entityKind],
    importance: BASE_NODE_SIZE[input.entityKind],
    previewStats,
    owner: buildOwner(input.owner),
    tags: input.tags ?? [],
    updatedAt: input.updatedAt ?? null,
    graphStats: {
      degree: 0,
      structuralDegree: 0,
      contextualDegree: 0,
      taxonomyDegree: 0,
      workspaceDegree: 0
    }
  } satisfies KnowledgeGraphNode;
}

function addEdge(
  edgeIndex: Map<string, KnowledgeGraphEdge>,
  input: Omit<KnowledgeGraphEdge, "id" | "family">
) {
  if (input.source === input.target) {
    return;
  }
  const edgeId = [
    input.relationKind,
    input.source,
    input.target,
    input.label
  ].join("|");
  if (edgeIndex.has(edgeId)) {
    return;
  }
  edgeIndex.set(edgeId, {
    id: edgeId,
    family: KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP[input.relationKind],
    ...input
  });
}

function listWikiLinkRows(noteIds: string[]): WikiLinkRow[] {
  if (noteIds.length === 0) {
    return [];
  }
  const placeholders = noteIds.map(() => "?").join(", ");
  return getDatabase()
    .prepare(
      `SELECT source_note_id, target_type, target_note_id, target_entity_type, target_entity_id
       FROM wiki_link_edges
       WHERE source_note_id IN (${placeholders})`
    )
    .all(...noteIds) as WikiLinkRow[];
}

function buildFocusPayload(
  graph: KnowledgeGraphPayload,
  focusNodeId: string
): KnowledgeGraphFocusPayload {
  return buildKnowledgeGraphFocusPayload(graph.nodes, graph.edges, focusNodeId);
}

export function buildKnowledgeGraph(
  userIds?: string[],
  query: KnowledgeGraphQuery = {}
): KnowledgeGraphPayload {
  const goals = filterOwnedEntities("goal", listGoals(), userIds);
  const projects = listProjectSummaries({ userIds });
  const tasks = filterOwnedEntities("task", listTasks(), userIds);
  const tags = filterOwnedEntities("tag", listTags(), userIds);
  const strategies = listStrategies({ userIds });
  const habits = listHabits({ userIds });
  const selectedUserIds = new Set(userIds ?? []);
  const notes = listNotes({ limit: KNOWLEDGE_GRAPH_NOTE_LIMIT }).filter((note) => {
    if (selectedUserIds.size === 0) {
      return true;
    }
    if (note.userId && selectedUserIds.has(note.userId)) {
      return true;
    }
    return note.kind === "wiki" && note.userId === null;
  });
  const insights = listInsights({ userIds });
  const calendarEvents = listCalendarEvents({ ...GRAPH_RANGE, userIds });
  const workBlocks = listWorkBlockTemplates({ userIds });
  const timeboxes = listTaskTimeboxes({ ...GRAPH_RANGE, userIds });
  const eventTypes = filterOwnedEntities("event_type", listEventTypes(), userIds);
  const emotions = filterOwnedEntities(
    "emotion_definition",
    listEmotionDefinitions(),
    userIds
  );
  const values = filterOwnedEntities("psyche_value", listPsycheValues(), userIds);
  const patterns = filterOwnedEntities("behavior_pattern", listBehaviorPatterns(), userIds);
  const behaviors = filterOwnedEntities("behavior", listBehaviors(), userIds);
  const beliefs = filterOwnedEntities("belief_entry", listBeliefEntries(), userIds);
  const modes = filterOwnedEntities("mode_profile", listModeProfiles(), userIds);
  const modeSessions = filterOwnedEntities("mode_guide_session", listModeGuideSessions(), userIds);
  const reports = filterOwnedEntities("trigger_report", listTriggerReports(), userIds);
  const wikiSpaces = listWikiSpaces();
  const flows = listAiConnectors();

  const nodes = new Map<string, KnowledgeGraphNode>();
  const edges = new Map<string, KnowledgeGraphEdge>();

  const noteIds = notes.map((note) => note.id);
  const wikiLinkRows = listWikiLinkRows(noteIds);
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));

  for (const goal of goals) {
    nodes.set(
      buildKnowledgeGraphNodeId("goal", goal.id),
      makeNode({
        entityType: "goal",
        entityId: goal.id,
        entityKind: "goal",
        title: goal.title,
        subtitle: goal.horizon,
        description: goal.description,
        previewStats: [
          { label: "Horizon", value: goal.horizon },
          { label: "Status", value: goal.status },
          { label: "Target XP", value: goal.targetPoints }
        ],
        owner: goal,
        tags: goal.tagIds
          .map((tagId) => tagById.get(tagId))
          .filter(Boolean)
          .map((tag) => ({ id: tag!.id, label: tag!.name })),
        href: getKnowledgeGraphEntityHref("goal", goal.id),
        updatedAt: goal.updatedAt
      })
    );
    for (const tagId of goal.tagIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("tag", tagId),
        target: buildKnowledgeGraphNodeId("goal", goal.id),
        relationKind: "tag_goal",
        label: "Tags goal",
        strength: 0.7,
        directional: true,
        structural: false
      });
    }
  }

  for (const tag of tags) {
    nodes.set(
      buildKnowledgeGraphNodeId("tag", tag.id),
      makeNode({
        entityType: "tag",
        entityId: tag.id,
        entityKind: "tag",
        title: tag.name,
        subtitle: tag.kind,
        description: tag.description,
        previewStats: [
          { label: "Kind", value: tag.kind },
          { label: "Color", value: tag.color }
        ],
        owner: tag,
        href: "/tags"
      })
    );
  }

  for (const project of projects) {
    nodes.set(
      buildKnowledgeGraphNodeId("project", project.id),
      makeNode({
        entityType: "project",
        entityId: project.id,
        entityKind: "project",
        title: project.title,
        subtitle: project.goalTitle,
        description: project.description,
        previewStats: [
          { label: "Progress", value: `${project.progress}%` },
          { label: "Tasks", value: project.totalTasks },
          { label: "Status", value: project.status }
        ],
        owner: project,
        href: getKnowledgeGraphEntityHref("project", project.id),
        updatedAt: "updatedAt" in project ? project.updatedAt : null
      })
    );
    addEdge(edges, {
      source: buildKnowledgeGraphNodeId("goal", project.goalId),
      target: buildKnowledgeGraphNodeId("project", project.id),
      relationKind: "goal_project",
      label: "Supports goal",
      strength: 0.96,
      directional: true,
      structural: true
    });
  }

  for (const task of tasks) {
    nodes.set(
      buildKnowledgeGraphNodeId("task", task.id),
      makeNode({
        entityType: "task",
        entityId: task.id,
        entityKind: "task",
        title: task.title,
        subtitle: task.status.replaceAll("_", " "),
        description: task.description,
        previewStats: [
          { label: "Status", value: task.status.replaceAll("_", " ") },
          { label: "Priority", value: task.priority },
          { label: "XP", value: task.points }
        ],
        owner: task,
        tags: task.tagIds
          .map((tagId) => tagById.get(tagId))
          .filter(Boolean)
          .map((tag) => ({ id: tag!.id, label: tag!.name })),
        href: getKnowledgeGraphEntityHref("task", task.id),
        updatedAt: task.updatedAt
      })
    );
    if (task.projectId) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("project", task.projectId),
        target: buildKnowledgeGraphNodeId("task", task.id),
        relationKind: "project_task",
        label: "Contains task",
        strength: 0.98,
        directional: true,
        structural: true
      });
    }
    if (task.goalId && !task.projectId) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("goal", task.goalId),
        target: buildKnowledgeGraphNodeId("task", task.id),
        relationKind: "goal_task",
        label: "Direct goal task",
        strength: 0.8,
        directional: true,
        structural: false
      });
    }
    for (const tagId of task.tagIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("tag", tagId),
        target: buildKnowledgeGraphNodeId("task", task.id),
        relationKind: "tag_task",
        label: "Tags task",
        strength: 0.68,
        directional: true,
        structural: false
      });
    }
  }

  for (const strategy of strategies) {
    nodes.set(
      buildKnowledgeGraphNodeId("strategy", strategy.id),
      makeNode({
        entityType: "strategy",
        entityId: strategy.id,
        entityKind: "strategy",
        title: strategy.title,
        subtitle: `${strategy.metrics.alignmentScore}% aligned`,
        description: strategy.overview || strategy.endStateDescription,
        previewStats: [
          { label: "Aligned", value: `${strategy.metrics.alignmentScore}%` },
          { label: "Nodes", value: strategy.metrics.totalNodeCount },
          { label: "Status", value: strategy.status }
        ],
        owner: strategy,
        tags: strategy.linkedEntities
          .filter((link) => link.entityType === "tag")
          .map((link) => tagById.get(link.entityId))
          .filter(Boolean)
          .map((tag) => ({ id: tag!.id, label: tag!.name })),
        href: getKnowledgeGraphEntityHref("strategy", strategy.id),
        updatedAt: strategy.updatedAt
      })
    );
    for (const goalId of strategy.targetGoalIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("strategy", strategy.id),
        target: buildKnowledgeGraphNodeId("goal", goalId),
        relationKind: "strategy_target",
        label: "Targets goal",
        strength: 0.92,
        directional: true,
        structural: true
      });
    }
    for (const projectId of strategy.targetProjectIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("strategy", strategy.id),
        target: buildKnowledgeGraphNodeId("project", projectId),
        relationKind: "strategy_target",
        label: "Targets project",
        strength: 0.92,
        directional: true,
        structural: true
      });
    }
    for (const link of strategy.linkedEntities) {
      if (link.entityType === "tag") {
        addEdge(edges, {
          source: buildKnowledgeGraphNodeId("tag", link.entityId),
          target: buildKnowledgeGraphNodeId("strategy", strategy.id),
          relationKind: "tag_strategy",
          label: "Tags strategy",
          strength: 0.68,
          directional: true,
          structural: false
        });
        continue;
      }
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("strategy", strategy.id),
        target: buildKnowledgeGraphNodeId(link.entityType, link.entityId),
        relationKind: "strategy_link",
        label: "References entity",
        strength: 0.66,
        directional: true,
        structural: false
      });
    }
    for (const node of strategy.graph.nodes) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("strategy", strategy.id),
        target: buildKnowledgeGraphNodeId(node.entityType, node.entityId),
        relationKind: "strategy_step",
        label: "Uses plan step",
        strength: 0.82,
        directional: true,
        structural: true
      });
    }
  }

  for (const habit of habits) {
    nodes.set(
      buildKnowledgeGraphNodeId("habit", habit.id),
      makeNode({
        entityType: "habit",
        entityId: habit.id,
        entityKind: "habit",
        title: habit.title,
        subtitle: habit.frequency,
        description: habit.description,
        previewStats: [
          { label: "Frequency", value: habit.frequency },
          { label: "Streak", value: habit.streakCount },
          { label: "Completion", value: `${Math.round(habit.completionRate)}%` }
        ],
        owner: habit,
        href: getKnowledgeGraphEntityHref("habit", habit.id),
        updatedAt: habit.updatedAt
      })
    );
    for (const linkedId of habit.linkedGoalIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("habit", habit.id),
        target: buildKnowledgeGraphNodeId("goal", linkedId),
        relationKind: "habit_link",
        label: "Habit supports goal",
        strength: 0.76,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of habit.linkedProjectIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("habit", habit.id),
        target: buildKnowledgeGraphNodeId("project", linkedId),
        relationKind: "habit_link",
        label: "Habit supports project",
        strength: 0.76,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of habit.linkedTaskIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("habit", habit.id),
        target: buildKnowledgeGraphNodeId("task", linkedId),
        relationKind: "habit_link",
        label: "Habit supports task",
        strength: 0.76,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of habit.linkedValueIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("habit", habit.id),
        target: buildKnowledgeGraphNodeId("psyche_value", linkedId),
        relationKind: "habit_link",
        label: "Habit supports value",
        strength: 0.74,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of habit.linkedPatternIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("habit", habit.id),
        target: buildKnowledgeGraphNodeId("behavior_pattern", linkedId),
        relationKind: "habit_link",
        label: "Habit relates to pattern",
        strength: 0.74,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of habit.linkedBehaviorIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("habit", habit.id),
        target: buildKnowledgeGraphNodeId("behavior", linkedId),
        relationKind: "habit_link",
        label: "Habit relates to behavior",
        strength: 0.74,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of habit.linkedBeliefIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("habit", habit.id),
        target: buildKnowledgeGraphNodeId("belief_entry", linkedId),
        relationKind: "habit_link",
        label: "Habit relates to belief",
        strength: 0.72,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of habit.linkedModeIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("habit", habit.id),
        target: buildKnowledgeGraphNodeId("mode_profile", linkedId),
        relationKind: "habit_link",
        label: "Habit relates to mode",
        strength: 0.72,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of habit.linkedReportIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("habit", habit.id),
        target: buildKnowledgeGraphNodeId("trigger_report", linkedId),
        relationKind: "habit_link",
        label: "Habit relates to report",
        strength: 0.72,
        directional: true,
        structural: false
      });
    }
  }

  for (const note of notes) {
    const isWiki = note.kind === "wiki";
    const noteNodeId = buildKnowledgeGraphNodeId("note", note.id);
    nodes.set(
      noteNodeId,
      makeNode({
        entityType: "note",
        entityId: note.id,
        entityKind: isWiki ? "wiki_page" : "note",
        title: note.title,
        subtitle: isWiki ? note.slug : note.summary,
        description: note.summary || note.contentPlain,
        searchText: note.contentPlain,
        previewStats: [
          { label: "Kind", value: note.kind },
          { label: "Links", value: note.links.length },
          { label: "Tags", value: note.tags?.length ?? 0 }
        ],
        owner: note,
        tags: (note.tags ?? []).map((tag) => ({
          id: tag,
          label: tag
        })),
        href: getKnowledgeGraphEntityHref("note", note.id, {
          noteKind: note.kind,
          noteSlug: note.slug,
          noteSpaceId: note.spaceId
        }),
        updatedAt: note.updatedAt
      })
    );
    if (isWiki && note.spaceId) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("wiki_space", note.spaceId),
        target: noteNodeId,
        relationKind: "wiki_parent",
        label: "Contains page",
        strength: 0.72,
        directional: true,
        structural: true
      });
    }
    for (const link of note.links) {
      addEdge(edges, {
        source: noteNodeId,
        target: buildKnowledgeGraphNodeId(link.entityType, link.entityId),
        relationKind: "note_link",
        label: "Attached note",
        strength: isWiki ? 0.74 : 0.68,
        directional: true,
        structural: false
      });
    }
  }

  for (const space of wikiSpaces) {
    nodes.set(
      buildKnowledgeGraphNodeId("wiki_space", space.id),
      makeNode({
        entityType: "wiki_space",
        entityId: space.id,
        entityKind: "wiki_space",
        title: space.label,
        subtitle: space.visibility,
        description: space.description,
        previewStats: [
          { label: "Visibility", value: space.visibility },
          { label: "Slug", value: space.slug }
        ],
        href: getKnowledgeGraphEntityHref("wiki_space", space.id),
        updatedAt: space.updatedAt
      })
    );
  }

  for (const row of wikiLinkRows) {
    const sourceNote = noteById.get(row.source_note_id);
    if (!sourceNote) {
      continue;
    }
    if (row.target_type === "page" && row.target_note_id) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("note", row.source_note_id),
        target: buildKnowledgeGraphNodeId("note", row.target_note_id),
        relationKind: "wiki_link",
        label: "Wiki link",
        strength: 0.64,
        directional: true,
        structural: false
      });
    }
    if (row.target_type === "entity" && row.target_entity_type && row.target_entity_id) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("note", row.source_note_id),
        target: buildKnowledgeGraphNodeId(row.target_entity_type, row.target_entity_id),
        relationKind: "wiki_link",
        label: "Wiki entity link",
        strength: 0.64,
        directional: true,
        structural: false
      });
    }
  }

  for (const insight of insights) {
    nodes.set(
      buildKnowledgeGraphNodeId("insight", insight.id),
      makeNode({
        entityType: "insight",
        entityId: insight.id,
        entityKind: "insight",
        title: insight.title,
        subtitle: insight.status,
        description: insight.summary || insight.recommendation,
        previewStats: [
          { label: "Status", value: insight.status },
          { label: "Confidence", value: `${Math.round(insight.confidence * 100)}%` },
          { label: "Evidence", value: insight.evidence.length }
        ],
        owner: insight,
        href: getKnowledgeGraphEntityHref("insight", insight.id),
        updatedAt: insight.updatedAt
      })
    );
    if (insight.entityType && insight.entityId) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("insight", insight.id),
        target: buildKnowledgeGraphNodeId(
          insight.entityType as KnowledgeGraphEntityType,
          insight.entityId
        ),
        relationKind: "note_link",
        label: "Primary entity",
        strength: 0.7,
        directional: true,
        structural: false
      });
    }
    for (const evidence of insight.evidence) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("insight", insight.id),
        target: buildKnowledgeGraphNodeId(
          evidence.entityType as KnowledgeGraphEntityType,
          evidence.entityId
        ),
        relationKind: "note_link",
        label: "Evidence",
        strength: 0.66,
        directional: true,
        structural: false
      });
    }
  }

  for (const event of calendarEvents) {
    nodes.set(
      buildKnowledgeGraphNodeId("calendar_event", event.id),
      makeNode({
        entityType: "calendar_event",
        entityId: event.id,
        entityKind: "calendar_event",
        title: event.title,
        subtitle: event.eventType || event.originType,
        description: event.description || event.location,
        previewStats: [
          { label: "Origin", value: event.originType },
          { label: "Start", value: new Date(event.startAt).toLocaleDateString() },
          { label: "Links", value: event.links.length }
        ],
        owner: event,
        href: getKnowledgeGraphEntityHref("calendar_event", event.id),
        updatedAt: event.updatedAt
      })
    );
    for (const link of event.links) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("calendar_event", event.id),
        target: buildKnowledgeGraphNodeId(link.entityType, link.entityId),
        relationKind: "calendar_link",
        label: link.relationshipType || "Calendar link",
        strength: 0.7,
        directional: true,
        structural: false
      });
    }
  }

  for (const workBlock of workBlocks) {
    nodes.set(
      buildKnowledgeGraphNodeId("work_block_template", workBlock.id),
      makeNode({
        entityType: "work_block_template",
        entityId: workBlock.id,
        entityKind: "work_block",
        title: workBlock.title,
        subtitle: workBlock.kind.replaceAll("_", " "),
        description: `${workBlock.blockingState} block`,
        previewStats: [
          { label: "Kind", value: workBlock.kind.replaceAll("_", " ") },
          { label: "State", value: workBlock.blockingState },
          { label: "Days", value: workBlock.weekDays.length }
        ],
        owner: workBlock,
        href: getKnowledgeGraphEntityHref("work_block_template", workBlock.id),
        updatedAt: workBlock.updatedAt
      })
    );
  }

  for (const timebox of timeboxes) {
    nodes.set(
      buildKnowledgeGraphNodeId("task_timebox", timebox.id),
      makeNode({
        entityType: "task_timebox",
        entityId: timebox.id,
        entityKind: "timebox",
        title: timebox.title,
        subtitle: timebox.status,
        description: `${timebox.source} timebox`,
        previewStats: [
          { label: "Status", value: timebox.status },
          { label: "Source", value: timebox.source },
          { label: "Starts", value: new Date(timebox.startsAt).toLocaleDateString() }
        ],
        owner: timebox,
        href: getKnowledgeGraphEntityHref("task_timebox", timebox.id),
        updatedAt: timebox.updatedAt
      })
    );
    addEdge(edges, {
      source: buildKnowledgeGraphNodeId("task_timebox", timebox.id),
      target: buildKnowledgeGraphNodeId("task", timebox.taskId),
      relationKind: "timebox_task",
      label: "Timeboxes task",
      strength: 0.9,
      directional: true,
      structural: true
    });
    if (timebox.projectId) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("task_timebox", timebox.id),
        target: buildKnowledgeGraphNodeId("project", timebox.projectId),
        relationKind: "timebox_project",
        label: "Timeboxes project",
        strength: 0.78,
        directional: true,
        structural: false
      });
    }
  }

  for (const eventType of eventTypes) {
    nodes.set(
      buildKnowledgeGraphNodeId("event_type", eventType.id),
      makeNode({
        entityType: "event_type",
        entityId: eventType.id,
        entityKind: "event_type",
        title: eventType.label,
        subtitle: eventType.system ? "System type" : "Custom type",
        description: eventType.description,
        previewStats: [
          { label: "System", value: eventType.system ? "Yes" : "No" }
        ],
        owner: eventType,
        href: "/psyche/reports",
        updatedAt: eventType.updatedAt
      })
    );
  }

  for (const emotion of emotions) {
    nodes.set(
      buildKnowledgeGraphNodeId("emotion_definition", emotion.id),
      makeNode({
        entityType: "emotion_definition",
        entityId: emotion.id,
        entityKind: "emotion",
        title: emotion.label,
        subtitle: emotion.category,
        description: emotion.description,
        previewStats: [
          { label: "Category", value: emotion.category },
          { label: "System", value: emotion.system ? "Yes" : "No" }
        ],
        owner: emotion,
        href: "/psyche/reports",
        updatedAt: emotion.updatedAt
      })
    );
  }

  for (const value of values) {
    nodes.set(
      buildKnowledgeGraphNodeId("psyche_value", value.id),
      makeNode({
        entityType: "psyche_value",
        entityId: value.id,
        entityKind: "value",
        title: value.title,
        subtitle: value.valuedDirection,
        description: value.description || value.whyItMatters,
        previewStats: [
          { label: "Goals", value: value.linkedGoalIds.length },
          { label: "Projects", value: value.linkedProjectIds.length },
          { label: "Tasks", value: value.linkedTaskIds.length }
        ],
        owner: value,
        href: getKnowledgeGraphEntityHref("psyche_value", value.id),
        updatedAt: value.updatedAt
      })
    );
    for (const goalId of value.linkedGoalIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("psyche_value", value.id),
        target: buildKnowledgeGraphNodeId("goal", goalId),
        relationKind: "value_goal",
        label: "Anchors goal",
        strength: 0.72,
        directional: true,
        structural: false
      });
    }
    for (const projectId of value.linkedProjectIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("psyche_value", value.id),
        target: buildKnowledgeGraphNodeId("project", projectId),
        relationKind: "value_project",
        label: "Anchors project",
        strength: 0.72,
        directional: true,
        structural: false
      });
    }
    for (const taskId of value.linkedTaskIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("psyche_value", value.id),
        target: buildKnowledgeGraphNodeId("task", taskId),
        relationKind: "value_task",
        label: "Anchors task",
        strength: 0.72,
        directional: true,
        structural: false
      });
    }
  }

  for (const pattern of patterns) {
    nodes.set(
      buildKnowledgeGraphNodeId("behavior_pattern", pattern.id),
      makeNode({
        entityType: "behavior_pattern",
        entityId: pattern.id,
        entityKind: "pattern",
        title: pattern.title,
        subtitle: pattern.targetBehavior,
        description: pattern.description,
        previewStats: [
          { label: "Values", value: pattern.linkedValueIds.length },
          { label: "Beliefs", value: pattern.linkedBeliefIds.length },
          { label: "Modes", value: pattern.linkedModeIds.length }
        ],
        owner: pattern,
        href: getKnowledgeGraphEntityHref("behavior_pattern", pattern.id),
        updatedAt: pattern.updatedAt
      })
    );
    for (const linkedId of pattern.linkedValueIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("behavior_pattern", pattern.id),
        target: buildKnowledgeGraphNodeId("psyche_value", linkedId),
        relationKind: "pattern_value",
        label: "Pattern to value",
        strength: 0.78,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of pattern.linkedBeliefIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("behavior_pattern", pattern.id),
        target: buildKnowledgeGraphNodeId("belief_entry", linkedId),
        relationKind: "pattern_belief",
        label: "Pattern to belief",
        strength: 0.76,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of pattern.linkedModeIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("behavior_pattern", pattern.id),
        target: buildKnowledgeGraphNodeId("mode_profile", linkedId),
        relationKind: "pattern_mode",
        label: "Pattern to mode",
        strength: 0.76,
        directional: true,
        structural: false
      });
    }
  }

  for (const behavior of behaviors) {
    nodes.set(
      buildKnowledgeGraphNodeId("behavior", behavior.id),
      makeNode({
        entityType: "behavior",
        entityId: behavior.id,
        entityKind: "behavior",
        title: behavior.title,
        subtitle: behavior.kind,
        description: behavior.description,
        previewStats: [
          { label: "Patterns", value: behavior.linkedPatternIds.length },
          { label: "Values", value: behavior.linkedValueIds.length },
          { label: "Modes", value: behavior.linkedModeIds.length }
        ],
        owner: behavior,
        href: getKnowledgeGraphEntityHref("behavior", behavior.id),
        updatedAt: behavior.updatedAt
      })
    );
    for (const linkedId of behavior.linkedPatternIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("behavior", behavior.id),
        target: buildKnowledgeGraphNodeId("behavior_pattern", linkedId),
        relationKind: "behavior_pattern",
        label: "Behavior to pattern",
        strength: 0.8,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of behavior.linkedValueIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("behavior", behavior.id),
        target: buildKnowledgeGraphNodeId("psyche_value", linkedId),
        relationKind: "behavior_value",
        label: "Behavior to value",
        strength: 0.76,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of behavior.linkedSchemaIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("behavior", behavior.id),
        target: buildKnowledgeGraphNodeId("belief_entry", linkedId),
        relationKind: "behavior_belief",
        label: "Behavior to belief",
        strength: 0.74,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of behavior.linkedModeIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("behavior", behavior.id),
        target: buildKnowledgeGraphNodeId("mode_profile", linkedId),
        relationKind: "behavior_mode",
        label: "Behavior to mode",
        strength: 0.74,
        directional: true,
        structural: false
      });
    }
  }

  for (const belief of beliefs) {
    nodes.set(
      buildKnowledgeGraphNodeId("belief_entry", belief.id),
      makeNode({
        entityType: "belief_entry",
        entityId: belief.id,
        entityKind: "belief",
        title: truncate(belief.statement, 82),
        subtitle: belief.beliefType,
        description: belief.flexibleAlternative || belief.originNote,
        previewStats: [
          { label: "Confidence", value: `${belief.confidence}%` },
          { label: "Values", value: belief.linkedValueIds.length },
          { label: "Reports", value: belief.linkedReportIds.length }
        ],
        owner: belief,
        href: getKnowledgeGraphEntityHref("belief_entry", belief.id),
        updatedAt: belief.updatedAt
      })
    );
    for (const linkedId of belief.linkedValueIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("belief_entry", belief.id),
        target: buildKnowledgeGraphNodeId("psyche_value", linkedId),
        relationKind: "belief_value",
        label: "Belief to value",
        strength: 0.76,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of belief.linkedBehaviorIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("belief_entry", belief.id),
        target: buildKnowledgeGraphNodeId("behavior", linkedId),
        relationKind: "belief_behavior",
        label: "Belief to behavior",
        strength: 0.74,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of belief.linkedModeIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("belief_entry", belief.id),
        target: buildKnowledgeGraphNodeId("mode_profile", linkedId),
        relationKind: "belief_mode",
        label: "Belief to mode",
        strength: 0.74,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of belief.linkedReportIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("belief_entry", belief.id),
        target: buildKnowledgeGraphNodeId("trigger_report", linkedId),
        relationKind: "belief_report",
        label: "Belief to report",
        strength: 0.72,
        directional: true,
        structural: false
      });
    }
  }

  for (const mode of modes) {
    nodes.set(
      buildKnowledgeGraphNodeId("mode_profile", mode.id),
      makeNode({
        entityType: "mode_profile",
        entityId: mode.id,
        entityKind: "mode",
        title: mode.title,
        subtitle: mode.family.replaceAll("_", " "),
        description: mode.persona || mode.protectiveJob,
        previewStats: [
          { label: "Family", value: mode.family.replaceAll("_", " ") },
          { label: "Patterns", value: mode.linkedPatternIds.length },
          { label: "Behaviors", value: mode.linkedBehaviorIds.length }
        ],
        owner: mode,
        href: getKnowledgeGraphEntityHref("mode_profile", mode.id),
        updatedAt: mode.updatedAt
      })
    );
    for (const linkedId of mode.linkedPatternIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("mode_profile", mode.id),
        target: buildKnowledgeGraphNodeId("behavior_pattern", linkedId),
        relationKind: "mode_pattern",
        label: "Mode to pattern",
        strength: 0.76,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of mode.linkedBehaviorIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("mode_profile", mode.id),
        target: buildKnowledgeGraphNodeId("behavior", linkedId),
        relationKind: "mode_behavior",
        label: "Mode to behavior",
        strength: 0.74,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of mode.linkedValueIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("mode_profile", mode.id),
        target: buildKnowledgeGraphNodeId("psyche_value", linkedId),
        relationKind: "mode_value",
        label: "Mode to value",
        strength: 0.74,
        directional: true,
        structural: false
      });
    }
  }

  const modeByGuideKey = new Map(
    modes.map((mode) => [
      `${mode.family}::${mode.archetype}`.toLowerCase(),
      mode
    ])
  );

  for (const session of modeSessions) {
    nodes.set(
      buildKnowledgeGraphNodeId("mode_guide_session", session.id),
      makeNode({
        entityType: "mode_guide_session",
        entityId: session.id,
        entityKind: "mode_session",
        title: truncate(session.summary, 84),
        subtitle: `${session.results.length} results`,
        description: session.summary,
        previewStats: [
          { label: "Results", value: session.results.length },
          { label: "Answers", value: session.answers.length }
        ],
        owner: session,
        href: getKnowledgeGraphEntityHref("mode_guide_session", session.id),
        updatedAt: session.updatedAt
      })
    );
    for (const result of session.results) {
      const matchedMode =
        modeByGuideKey.get(`${result.family}::${result.archetype}`.toLowerCase()) ??
        modes.find(
          (mode) =>
            mode.family === result.family &&
            (mode.title.toLowerCase() === result.label.toLowerCase() ||
              mode.archetype.toLowerCase() === result.label.toLowerCase())
        );
      if (!matchedMode) {
        continue;
      }
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("mode_guide_session", session.id),
        target: buildKnowledgeGraphNodeId("mode_profile", matchedMode.id),
        relationKind: "mode_session_mode",
        label: "Session suggests mode",
        strength: Math.max(0.6, Math.min(1, result.confidence)),
        directional: true,
        structural: false
      });
    }
  }

  for (const report of reports) {
    nodes.set(
      buildKnowledgeGraphNodeId("trigger_report", report.id),
      makeNode({
        entityType: "trigger_report",
        entityId: report.id,
        entityKind: "report",
        title: report.title,
        subtitle: report.status,
        description: report.eventSituation,
        previewStats: [
          { label: "Status", value: report.status },
          { label: "Occurred", value: report.occurredAt ? new Date(report.occurredAt).toLocaleDateString() : "Draft" },
          { label: "Next moves", value: report.nextMoves.length }
        ],
        owner: report,
        href: getKnowledgeGraphEntityHref("trigger_report", report.id),
        updatedAt: report.updatedAt
      })
    );
    if (report.eventTypeId) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("trigger_report", report.id),
        target: buildKnowledgeGraphNodeId("event_type", report.eventTypeId),
        relationKind: "report_event_type",
        label: "Categorized as event type",
        strength: 0.84,
        directional: true,
        structural: false
      });
    }
    for (const emotion of report.emotions) {
      if (!emotion.emotionDefinitionId) {
        continue;
      }
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("trigger_report", report.id),
        target: buildKnowledgeGraphNodeId(
          "emotion_definition",
          emotion.emotionDefinitionId
        ),
        relationKind: "report_emotion",
        label: "Records emotion",
        strength: Math.max(0.64, Math.min(0.92, emotion.intensity / 10)),
        directional: true,
        structural: false
      });
    }
    for (const linkedId of report.linkedValueIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("trigger_report", report.id),
        target: buildKnowledgeGraphNodeId("psyche_value", linkedId),
        relationKind: "report_value",
        label: "Report to value",
        strength: 0.8,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of report.linkedPatternIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("trigger_report", report.id),
        target: buildKnowledgeGraphNodeId("behavior_pattern", linkedId),
        relationKind: "report_pattern",
        label: "Report to pattern",
        strength: 0.78,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of report.linkedGoalIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("trigger_report", report.id),
        target: buildKnowledgeGraphNodeId("goal", linkedId),
        relationKind: "report_goal",
        label: "Report to goal",
        strength: 0.78,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of report.linkedProjectIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("trigger_report", report.id),
        target: buildKnowledgeGraphNodeId("project", linkedId),
        relationKind: "report_project",
        label: "Report to project",
        strength: 0.78,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of report.linkedTaskIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("trigger_report", report.id),
        target: buildKnowledgeGraphNodeId("task", linkedId),
        relationKind: "report_task",
        label: "Report to task",
        strength: 0.78,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of report.linkedBehaviorIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("trigger_report", report.id),
        target: buildKnowledgeGraphNodeId("behavior", linkedId),
        relationKind: "report_behavior",
        label: "Report to behavior",
        strength: 0.76,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of report.linkedBeliefIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("trigger_report", report.id),
        target: buildKnowledgeGraphNodeId("belief_entry", linkedId),
        relationKind: "report_belief",
        label: "Report to belief",
        strength: 0.76,
        directional: true,
        structural: false
      });
    }
    for (const linkedId of report.linkedModeIds) {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("trigger_report", report.id),
        target: buildKnowledgeGraphNodeId("mode_profile", linkedId),
        relationKind: "report_mode",
        label: "Report to mode",
        strength: 0.76,
        directional: true,
        structural: false
      });
    }
  }

  const discoveredWorkbenchSurfaceIds = new Set<string>(["workbench"]);
  for (const flow of flows) {
    if (flow.homeSurfaceId) {
      discoveredWorkbenchSurfaceIds.add(flow.homeSurfaceId);
    }
  }

  for (const surfaceId of discoveredWorkbenchSurfaceIds) {
    const surfaceMeta = WORKBENCH_SURFACE_ROUTES[surfaceId] ?? {
      title: surfaceId.replace(/[-_]+/g, " ").replace(/\b\w/g, (value) => value.toUpperCase()),
      subtitle: "Workbench route surface",
      href: `/workbench?surface=${encodeURIComponent(surfaceId)}`
    };
    nodes.set(
      buildKnowledgeGraphNodeId("workbench_surface", surfaceId),
      makeNode({
        entityType: "workbench_surface",
        entityId: surfaceId,
        entityKind: "workbench",
        title: surfaceMeta.title,
        subtitle: surfaceMeta.subtitle,
        description:
          surfaceId === "workbench"
            ? "Forge's top-level graph-flow workspace for functors, chats, and published outputs."
            : `Workbench surface routed into ${surfaceMeta.href}.`,
        previewStats: surfaceId === "workbench" ? [{ label: "Flows", value: flows.length }] : [],
        href: surfaceMeta.href
      })
    );
    if (surfaceId !== "workbench") {
      addEdge(edges, {
        source: buildKnowledgeGraphNodeId("workbench_surface", "workbench"),
        target: buildKnowledgeGraphNodeId("workbench_surface", surfaceId),
        relationKind: "workbench_route",
        label: "Route surface",
        strength: 0.82,
        directional: true,
        structural: true
      });
    }
  }

  for (const flow of flows) {
    const entityKind = flow.kind === "chat" ? "chat" : "functor";
    nodes.set(
      buildKnowledgeGraphNodeId("workbench_flow", flow.id),
      makeNode({
        entityType: "workbench_flow",
        entityId: flow.id,
        entityKind,
        title: flow.title,
        subtitle: flow.kind,
        description: flow.description,
        previewStats: [
          { label: "Kind", value: flow.kind },
          { label: "Nodes", value: flow.graph.nodes.length },
          { label: "Public inputs", value: flow.publicInputs.length }
        ],
        href: getKnowledgeGraphEntityHref("workbench_flow", flow.id, {
          workbenchKind: flow.kind
        }),
        updatedAt: flow.updatedAt
      })
    );
    addEdge(edges, {
      source: buildKnowledgeGraphNodeId(
        "workbench_surface",
        flow.homeSurfaceId ?? "workbench"
      ),
      target: buildKnowledgeGraphNodeId("workbench_flow", flow.id),
      relationKind: "workbench_flow",
      label: flow.homeSurfaceId ? "Home surface flow" : "Contains flow",
      strength: 0.88,
      directional: true,
      structural: true
    });
  }

  const graphNodes = [...nodes.values()];
  const validNodeIds = new Set(graphNodes.map((node) => node.id));
  const graphEdges = [...edges.values()].filter(
    (edge) => validNodeIds.has(edge.source) && validNodeIds.has(edge.target)
  );
  const degreeById = new Map<
    string,
    {
      degree: number;
      structuralDegree: number;
      contextualDegree: number;
      taxonomyDegree: number;
      workspaceDegree: number;
    }
  >();

  for (const edge of graphEdges) {
    for (const nodeId of [edge.source, edge.target]) {
      const current = degreeById.get(nodeId) ?? {
        degree: 0,
        structuralDegree: 0,
        contextualDegree: 0,
        taxonomyDegree: 0,
        workspaceDegree: 0
      };
      current.degree += 1;
      if (edge.family === "structural") {
        current.structuralDegree += 1;
      } else if (edge.family === "contextual") {
        current.contextualDegree += 1;
      } else if (edge.family === "taxonomy") {
        current.taxonomyDegree += 1;
      } else if (edge.family === "workspace") {
        current.workspaceDegree += 1;
      }
      degreeById.set(nodeId, current);
    }
  }

  const sizedNodes = graphNodes.map((node) => {
    const degreeStats = degreeById.get(node.id) ?? {
      degree: 0,
      structuralDegree: 0,
      contextualDegree: 0,
      taxonomyDegree: 0,
      workspaceDegree: 0
    };
    const visual = getEntityVisual(node.entityKind);
    const importance = node.importance + degreeStats.degree * 1.6;
    const size = Math.min(88, node.size + degreeStats.degree * 1.35);
    return {
      ...node,
      graphHref: buildKnowledgeGraphFocusHref(node.entityType, node.entityId),
      iconName: visual.iconName,
      accentToken: visual.colorToken.cssVariable,
      graphStats: degreeStats,
      importance,
      size
    };
  });

  const kinds = sizedNodes.reduce<Record<string, number>>((counts, node) => {
    counts[node.entityKind] = (counts[node.entityKind] ?? 0) + 1;
    return counts;
  }, {});
  const relationKinds = graphEdges.reduce<Record<string, number>>((counts, edge) => {
    counts[edge.relationKind] = (counts[edge.relationKind] ?? 0) + 1;
    return counts;
  }, {});
  const baseGraph = {
    generatedAt: new Date().toISOString(),
    nodes: sizedNodes,
    edges: graphEdges,
    facets: buildKnowledgeGraphFacets(sizedNodes, graphEdges),
    counts: {
      nodeCount: sizedNodes.length,
      edgeCount: graphEdges.length,
      totalNodeCount: sizedNodes.length,
      totalEdgeCount: graphEdges.length,
      filteredNodeCount: sizedNodes.length,
      filteredEdgeCount: graphEdges.length,
      kinds,
      relationKinds,
      limited: false
    }
  } satisfies KnowledgeGraphPayload;

  const filteredGraph = filterKnowledgeGraphData(baseGraph, query);
  const visibleNodeIds = selectKnowledgeGraphVisibleNodeIds({
    nodes: filteredGraph.nodes,
    edges: filteredGraph.edges,
    limit: query.limit,
    focusNodeId: query.focusNodeId
  });
  const visibleNodes = filteredGraph.nodes.filter((node) =>
    visibleNodeIds.has(node.id)
  );
  const visibleEdges = filteredGraph.edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  );
  const visibleKinds = visibleNodes.reduce<Record<string, number>>(
    (counts, node) => {
      counts[node.entityKind] = (counts[node.entityKind] ?? 0) + 1;
      return counts;
    },
    {}
  );
  const visibleRelationKinds = visibleEdges.reduce<Record<string, number>>(
    (counts, edge) => {
      counts[edge.relationKind] = (counts[edge.relationKind] ?? 0) + 1;
      return counts;
    },
    {}
  );

  return {
    generatedAt: new Date().toISOString(),
    nodes: visibleNodes,
    edges: visibleEdges,
    facets: buildKnowledgeGraphFacets(filteredGraph.nodes, filteredGraph.edges),
    counts: {
      nodeCount: visibleNodes.length,
      edgeCount: visibleEdges.length,
      totalNodeCount: baseGraph.counts.totalNodeCount,
      totalEdgeCount: baseGraph.counts.totalEdgeCount,
      filteredNodeCount: filteredGraph.nodes.length,
      filteredEdgeCount: filteredGraph.edges.length,
      kinds: visibleKinds,
      relationKinds: visibleRelationKinds,
      limited: visibleNodes.length < filteredGraph.nodes.length
    }
  };
}

export function buildKnowledgeGraphFocus(
  entityType: KnowledgeGraphEntityType,
  entityId: string,
  userIds?: string[]
) {
  const graph = buildKnowledgeGraph(userIds);
  return buildFocusPayload(graph, buildKnowledgeGraphNodeId(entityType, entityId));
}
