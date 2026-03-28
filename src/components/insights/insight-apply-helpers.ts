import type { GoalMutationInput, ProjectMutationInput, QuickTaskInput } from "@/lib/schemas";
import type { CrudEntityType, Goal, Insight, NoteLink, ProjectSummary, Task } from "@/lib/types";

export type ApplyInsightKind = "task" | "project" | "goal" | "note";

export type InsightSourceLink = NoteLink | null;

const DEFAULT_TASK_VALUES: QuickTaskInput = {
  title: "",
  description: "",
  owner: "Albert",
  goalId: "",
  projectId: "",
  priority: "medium",
  status: "focus",
  effort: "deep",
  energy: "steady",
  dueDate: "",
  points: 60,
  tagIds: []
};

const DEFAULT_PROJECT_VALUES: ProjectMutationInput = {
  goalId: "",
  title: "",
  description: "",
  status: "active",
  targetPoints: 240,
  themeColor: "#c0c1ff"
};

const DEFAULT_GOAL_VALUES: GoalMutationInput = {
  title: "",
  description: "",
  horizon: "year",
  status: "active",
  targetPoints: 400,
  themeColor: "#c8a46b",
  tagIds: []
};

const SUPPORTED_SOURCE_ENTITY_TYPES: CrudEntityType[] = [
  "goal",
  "project",
  "task",
  "tag",
  "note",
  "insight",
  "psyche_value",
  "behavior_pattern",
  "behavior",
  "belief_entry",
  "mode_profile",
  "mode_guide_session",
  "event_type",
  "emotion_definition",
  "trigger_report"
];

function isSupportedSourceEntityType(value: string | null): value is CrudEntityType {
  return value !== null && SUPPORTED_SOURCE_ENTITY_TYPES.includes(value as CrudEntityType);
}

function compactSentence(value: string, fallback: string, maxLength = 96) {
  const normalized = value.trim() || fallback.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildStructuredDescription(insight: Insight) {
  const parts = [insight.summary.trim(), insight.rationale.trim() ? `Why it matters: ${insight.rationale.trim()}` : ""].filter(Boolean);
  return parts.join("\n\n");
}

export function getInsightSourceLink(insight: Insight): InsightSourceLink {
  if (!isSupportedSourceEntityType(insight.entityType) || !insight.entityId) {
    return null;
  }

  return {
    entityType: insight.entityType,
    entityId: insight.entityId,
    anchorKey: null
  };
}

export function getInsightSourceGoalId(insight: Insight, projects: ProjectSummary[], tasks: Task[]) {
  if (insight.entityType === "goal" && insight.entityId) {
    return insight.entityId;
  }

  if (insight.entityType === "project" && insight.entityId) {
    return projects.find((project) => project.id === insight.entityId)?.goalId ?? "";
  }

  if (insight.entityType === "task" && insight.entityId) {
    return tasks.find((task) => task.id === insight.entityId)?.goalId ?? "";
  }

  return "";
}

export function getInsightSourceProjectId(insight: Insight, tasks: Task[]) {
  if (insight.entityType === "project" && insight.entityId) {
    return insight.entityId;
  }

  if (insight.entityType === "task" && insight.entityId) {
    return tasks.find((task) => task.id === insight.entityId)?.projectId ?? "";
  }

  return "";
}

export function getAvailableApplyKinds(insight: Insight, goals: Goal[], projects: ProjectSummary[]): ApplyInsightKind[] {
  const kinds: ApplyInsightKind[] = [];

  if (projects.length > 0) {
    kinds.push("task");
  }

  if (goals.length > 0) {
    kinds.push("project");
  }

  kinds.push("goal");

  if (getInsightSourceLink(insight)) {
    kinds.push("note");
  }

  return kinds;
}

export function getRecommendedApplyKind(insight: Insight, goals: Goal[], projects: ProjectSummary[]): ApplyInsightKind {
  const availableKinds = getAvailableApplyKinds(insight, goals, projects);

  if (availableKinds.includes("task") && (insight.entityType === "task" || insight.entityType === "project")) {
    return "task";
  }

  if (availableKinds.includes("project") && insight.entityType === "goal") {
    return "project";
  }

  return availableKinds[0] ?? "goal";
}

export function buildInsightTaskDefaults(insight: Insight, projects: ProjectSummary[], tasks: Task[]): QuickTaskInput {
  const sourceGoalId = getInsightSourceGoalId(insight, projects, tasks);
  const sourceProjectId = getInsightSourceProjectId(insight, tasks);
  const resolvedProjectId =
    sourceProjectId ||
    (sourceGoalId ? projects.find((project) => project.goalId === sourceGoalId)?.id ?? "" : "") ||
    projects[0]?.id ||
    "";
  const resolvedGoalId = resolvedProjectId ? projects.find((project) => project.id === resolvedProjectId)?.goalId ?? sourceGoalId : sourceGoalId;

  return {
    ...DEFAULT_TASK_VALUES,
    title: compactSentence(insight.recommendation, insight.title),
    description: buildStructuredDescription(insight),
    goalId: resolvedGoalId,
    projectId: resolvedProjectId
  };
}

export function buildInsightProjectDefaults(insight: Insight, goals: Goal[], projects: ProjectSummary[], tasks: Task[]): ProjectMutationInput {
  const sourceGoalId = getInsightSourceGoalId(insight, projects, tasks);
  const resolvedGoalId = sourceGoalId || goals[0]?.id || "";

  return {
    ...DEFAULT_PROJECT_VALUES,
    goalId: resolvedGoalId,
    title: compactSentence(insight.title, insight.recommendation),
    description: `${insight.summary.trim()}\n\nRecommendation: ${insight.recommendation.trim()}`.trim()
  };
}

export function buildInsightGoalDefaults(insight: Insight): GoalMutationInput {
  return {
    ...DEFAULT_GOAL_VALUES,
    title: compactSentence(insight.title, insight.recommendation),
    description: `${insight.summary.trim()}\n\nRecommendation: ${insight.recommendation.trim()}`.trim()
  };
}

export function buildInsightNoteMarkdown(insight: Insight) {
  return [
    `## ${insight.title.trim()}`,
    "",
    insight.summary.trim(),
    "",
    "### Recommendation",
    "",
    insight.recommendation.trim(),
    insight.rationale.trim() ? "" : null,
    insight.rationale.trim() ? "### Why this matters" : null,
    insight.rationale.trim() || null
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");
}
