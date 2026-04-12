import {
  getEntityKindForCrudEntityType,
  type EntityKind
} from "@/lib/entity-visuals";
import type { CrudEntityType, UserSummary } from "@/lib/types";
import { formatUserSummaryLine } from "@/lib/user-ownership";

export const ACTION_BAR_SEARCH_ENTITY_TYPES: CrudEntityType[] = [
  "goal",
  "project",
  "task",
  "strategy",
  "habit",
  "note",
  "insight",
  "calendar_event",
  "work_block_template",
  "task_timebox",
  "psyche_value",
  "behavior_pattern",
  "behavior",
  "belief_entry",
  "mode_profile",
  "trigger_report"
];

export type ActionBarFilterFamily = "entity-type";

export type ActionBarFilterId =
  | "goal"
  | "project"
  | "task"
  | "strategy"
  | "habit"
  | "note"
  | "wiki_page"
  | "calendar_event"
  | "psyche_value"
  | "behavior_pattern"
  | "behavior"
  | "belief_entry"
  | "mode_profile"
  | "trigger_report";

export type ActionBarFilterToken = {
  id: ActionBarFilterId;
  family: ActionBarFilterFamily;
  label: string;
  kind: EntityKind;
  searchText: string;
  entityTypes: CrudEntityType[];
};

export type ActionBarCreateActionCandidate = {
  id: string;
  title: string;
  quickActionTitle: string;
  description: string;
  aliases: string[];
  filterIds: ActionBarFilterId[];
};

function compactParts(parts: Array<string | null | undefined>) {
  return parts.map((value) => value?.trim() ?? "").filter(Boolean);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readUserSummary(value: unknown): UserSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const id = readString(candidate.id);
  const kind = readString(candidate.kind);
  const displayName = readString(candidate.displayName);

  if (!id || !displayName || (kind !== "human" && kind !== "bot")) {
    return null;
  }

  return {
    id,
    kind: kind as UserSummary["kind"],
    displayName,
    handle: readString(candidate.handle) ?? "",
    description: readString(candidate.description) ?? "",
    accentColor: readString(candidate.accentColor) ?? "",
    createdAt: readString(candidate.createdAt) ?? "",
    updatedAt: readString(candidate.updatedAt) ?? ""
  };
}

function isCreateIntent(normalizedQuery: string) {
  return (
    normalizedQuery === "create" ||
    normalizedQuery === "new" ||
    normalizedQuery.startsWith("create ") ||
    normalizedQuery.startsWith("new ")
  );
}

function readCreateIntentTarget(normalizedQuery: string) {
  if (normalizedQuery === "create" || normalizedQuery === "new") {
    return "";
  }
  if (normalizedQuery.startsWith("create ")) {
    return normalizedQuery.slice("create ".length).trim();
  }
  if (normalizedQuery.startsWith("new ")) {
    return normalizedQuery.slice("new ".length).trim();
  }
  return null;
}

export function normalizeActionBarQuery(value: string) {
  return value.trim().toLowerCase();
}

export function actionBarEntityTypeToKind(
  entityType: CrudEntityType,
  entity?: Record<string, unknown>
): EntityKind | null {
  if (entityType === "note") {
    return getEntityKindForCrudEntityType(entityType, {
      noteKind: readString(entity?.kind) === "wiki" ? "wiki" : "evidence"
    });
  }
  return getEntityKindForCrudEntityType(entityType);
}

export function actionBarEntityTypeLabel(
  entityType: CrudEntityType,
  entity?: Record<string, unknown>
) {
  switch (entityType) {
    case "goal":
      return "Goal";
    case "project":
      return "Project";
    case "task":
      return "Task";
    case "strategy":
      return "Strategy";
    case "habit":
      return "Habit";
    case "note":
      return readString(entity?.kind) === "wiki" ? "Wiki page" : "Note";
    case "insight":
      return "Insight";
    case "calendar_event":
      return "Calendar event";
    case "work_block_template":
      return "Work block";
    case "task_timebox":
      return "Timebox";
    case "psyche_value":
      return "Value";
    case "behavior_pattern":
      return "Pattern";
    case "behavior":
      return "Behavior";
    case "belief_entry":
      return "Belief";
    case "mode_profile":
      return "Mode";
    case "trigger_report":
      return "Report";
    default:
      return entityType.replaceAll("_", " ");
  }
}

export const ACTION_BAR_FILTER_TOKENS: ActionBarFilterToken[] = [
  {
    id: "goal",
    family: "entity-type",
    label: "Goal",
    kind: "goal",
    searchText: "goal life goal direction",
    entityTypes: ["goal"]
  },
  {
    id: "project",
    family: "entity-type",
    label: "Project",
    kind: "project",
    searchText: "project initiative",
    entityTypes: ["project"]
  },
  {
    id: "task",
    family: "entity-type",
    label: "Task",
    kind: "task",
    searchText: "task action work item",
    entityTypes: ["task"]
  },
  {
    id: "strategy",
    family: "entity-type",
    label: "Strategy",
    kind: "strategy",
    searchText: "strategy plan sequence roadmap",
    entityTypes: ["strategy"]
  },
  {
    id: "habit",
    family: "entity-type",
    label: "Habit",
    kind: "habit",
    searchText: "habit recurring routine",
    entityTypes: ["habit"]
  },
  {
    id: "note",
    family: "entity-type",
    label: "Note",
    kind: "note",
    searchText: "note evidence scratch note",
    entityTypes: ["note"]
  },
  {
    id: "wiki_page",
    family: "entity-type",
    label: "Wiki page",
    kind: "wiki_page",
    searchText: "wiki page karpawiki article knowledge page",
    entityTypes: ["note"]
  },
  {
    id: "calendar_event",
    family: "entity-type",
    label: "Calendar event",
    kind: "calendar_event",
    searchText: "calendar event meeting block schedule",
    entityTypes: ["calendar_event"]
  },
  {
    id: "psyche_value",
    family: "entity-type",
    label: "Value",
    kind: "value",
    searchText: "value psyche value",
    entityTypes: ["psyche_value"]
  },
  {
    id: "behavior_pattern",
    family: "entity-type",
    label: "Pattern",
    kind: "pattern",
    searchText: "pattern loop psyche pattern",
    entityTypes: ["behavior_pattern"]
  },
  {
    id: "behavior",
    family: "entity-type",
    label: "Behavior",
    kind: "behavior",
    searchText: "behavior psyche behavior",
    entityTypes: ["behavior"]
  },
  {
    id: "belief_entry",
    family: "entity-type",
    label: "Belief",
    kind: "belief",
    searchText: "belief schema belief entry",
    entityTypes: ["belief_entry"]
  },
  {
    id: "mode_profile",
    family: "entity-type",
    label: "Mode",
    kind: "mode",
    searchText: "mode profile psyche mode",
    entityTypes: ["mode_profile"]
  },
  {
    id: "trigger_report",
    family: "entity-type",
    label: "Report",
    kind: "report",
    searchText: "report trigger report psyche report",
    entityTypes: ["trigger_report"]
  }
];

export function getActionBarFilterToken(
  filterId: ActionBarFilterId
): ActionBarFilterToken | undefined {
  return ACTION_BAR_FILTER_TOKENS.find((filter) => filter.id === filterId);
}

export function inferActionBarTitle(
  entityType: CrudEntityType,
  entity: Record<string, unknown>
) {
  const candidates =
    entityType === "belief_entry"
      ? [entity.statement, entity.title, entity.name]
      : entityType === "note"
        ? [entity.title, entity.slug]
        : [
            entity.title,
            entity.displayName,
            entity.statement,
            entity.name,
            entity.label,
            entity.slug
          ];

  return (
    candidates.map(readString).find(Boolean) ??
    `${actionBarEntityTypeLabel(entityType, entity)} ${String(entity.id ?? "")}`
  );
}

export function inferActionBarDetail(
  entityType: CrudEntityType,
  entity: Record<string, unknown>
) {
  const summary = [
    entity.summary,
    entity.description,
    entity.overview,
    entity.flexibleAlternative,
    entity.originNote,
    entity.endState,
    entity.whyItMatters,
    entity.valuedDirection,
    entity.contentPlain
  ]
    .map(readString)
    .find(Boolean);

  const context = [entity.goalTitle, entity.projectTitle, entity.status, entity.kind]
    .map(readString)
    .find(Boolean);

  const ownerLine = formatUserSummaryLine(readUserSummary(entity.user));
  const fallback = compactParts([
    entityType === "note" ? actionBarEntityTypeLabel(entityType, entity) : null,
    ownerLine || null
  ]).join(" · ");

  return compactParts([summary, context, ownerLine || null]).join(" · ") || fallback;
}

export function buildActionBarSearchText(
  entityType: CrudEntityType,
  entity: Record<string, unknown>
) {
  return compactParts([
    inferActionBarTitle(entityType, entity),
    inferActionBarDetail(entityType, entity),
    actionBarEntityTypeLabel(entityType, entity),
    readString(entity.slug),
    readString(entity.handle)
  ])
    .join(" ")
    .toLowerCase();
}

export function buildActionBarHref(
  entityType: CrudEntityType,
  id: string,
  entity: Record<string, unknown>
) {
  switch (entityType) {
    case "goal":
      return `/goals/${encodeURIComponent(id)}`;
    case "project":
      return `/projects/${encodeURIComponent(id)}`;
    case "task":
      return `/tasks/${encodeURIComponent(id)}`;
    case "strategy":
      return `/strategies/${encodeURIComponent(id)}`;
    case "habit":
      return `/habits?focus=${encodeURIComponent(id)}`;
    case "note": {
      const noteKind = readString(entity.kind);
      const slug = readString(entity.slug);
      const spaceId = readString(entity.spaceId);
      if (noteKind === "wiki" && slug) {
        const suffix = spaceId
          ? `?spaceId=${encodeURIComponent(spaceId)}`
          : "";
        return `/wiki/page/${encodeURIComponent(slug)}${suffix}`;
      }
      return "/notes";
    }
    case "insight":
      return "/insights";
    case "calendar_event":
    case "work_block_template":
    case "task_timebox":
      return "/calendar";
    case "psyche_value":
      return `/psyche/values?focus=${encodeURIComponent(id)}`;
    case "behavior_pattern":
      return `/psyche/patterns?focus=${encodeURIComponent(id)}`;
    case "behavior":
      return `/psyche/behaviors?focus=${encodeURIComponent(id)}`;
    case "belief_entry":
      return `/psyche/schemas-beliefs?focus=${encodeURIComponent(id)}`;
    case "mode_profile":
      return `/psyche/modes?focus=${encodeURIComponent(id)}`;
    case "trigger_report":
      return `/psyche/reports/${encodeURIComponent(id)}`;
    default:
      return null;
  }
}

export function scoreActionBarMatch(
  query: string,
  title: string,
  searchText: string
) {
  const normalizedQuery = normalizeActionBarQuery(query);
  if (!normalizedQuery) {
    return 0;
  }

  const normalizedTitle = normalizeActionBarQuery(title);
  const normalizedSearchText = normalizeActionBarQuery(searchText);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  let score = 0;

  if (normalizedTitle === normalizedQuery) {
    score += 400;
  }
  if (normalizedTitle.startsWith(normalizedQuery)) {
    score += 240;
  }
  if (normalizedTitle.includes(normalizedQuery)) {
    score += 180;
  }
  if (normalizedSearchText.startsWith(normalizedQuery)) {
    score += 32;
  }
  if (normalizedSearchText.includes(normalizedQuery)) {
    score += 20;
  }

  for (const token of tokens) {
    if (normalizedTitle.startsWith(token)) {
      score += 36;
    } else if (normalizedTitle.includes(token)) {
      score += 24;
    }

    if (normalizedSearchText.includes(token)) {
      score += 12;
    }
  }

  return score;
}

export function getActionBarEntityTypesForFilters(
  selectedFilters: ActionBarFilterToken[]
) {
  if (selectedFilters.length === 0) {
    return ACTION_BAR_SEARCH_ENTITY_TYPES;
  }

  const entityTypes = new Set<CrudEntityType>();
  selectedFilters.forEach((filter) => {
    filter.entityTypes.forEach((entityType) => entityTypes.add(entityType));
  });
  return Array.from(entityTypes);
}

function matchesEntityTypeFilter(
  filter: ActionBarFilterToken,
  entityType: CrudEntityType,
  entity: Record<string, unknown>
) {
  if (!filter.entityTypes.includes(entityType)) {
    return false;
  }

  if (entityType !== "note") {
    return true;
  }

  const noteKind = readString(entity.kind);
  if (filter.id === "wiki_page") {
    return noteKind === "wiki";
  }
  if (filter.id === "note") {
    return noteKind !== "wiki";
  }
  return true;
}

export function entityMatchesActionBarFilters(
  entityType: CrudEntityType,
  entity: Record<string, unknown>,
  selectedFilters: ActionBarFilterToken[]
) {
  if (selectedFilters.length === 0) {
    return true;
  }

  const filtersByFamily = new Map<ActionBarFilterFamily, ActionBarFilterToken[]>();
  selectedFilters.forEach((filter) => {
    const current = filtersByFamily.get(filter.family) ?? [];
    current.push(filter);
    filtersByFamily.set(filter.family, current);
  });

  for (const familyFilters of filtersByFamily.values()) {
    const matchesFamily = familyFilters.some((filter) =>
      matchesEntityTypeFilter(filter, entityType, entity)
    );
    if (!matchesFamily) {
      return false;
    }
  }

  return true;
}

export function createActionMatchesActionBarFilters(
  action: Pick<ActionBarCreateActionCandidate, "filterIds">,
  selectedFilters: ActionBarFilterToken[]
) {
  if (selectedFilters.length === 0) {
    return true;
  }

  const selectedTypeFilterIds = new Set(
    selectedFilters
      .filter((filter) => filter.family === "entity-type")
      .map((filter) => filter.id)
  );

  if (selectedTypeFilterIds.size === 0) {
    return true;
  }

  return action.filterIds.some((filterId) => selectedTypeFilterIds.has(filterId));
}

export function buildActionBarCreateActionMatches<
  T extends ActionBarCreateActionCandidate
>(query: string, createActions: T[]) {
  const normalizedQuery = normalizeActionBarQuery(query);
  if (!isCreateIntent(normalizedQuery)) {
    return [] as Array<T & { score: number }>;
  }

  const targetQuery = readCreateIntentTarget(normalizedQuery);
  if (targetQuery === null) {
    return [] as Array<T & { score: number }>;
  }

  return createActions
    .map((action) => {
      const searchText = [
        action.title,
        action.quickActionTitle,
        action.description,
        ...action.aliases
      ]
        .join(" ")
        .toLowerCase();
      const score =
        targetQuery.length === 0
          ? 1
          : scoreActionBarMatch(targetQuery, action.quickActionTitle, searchText);
      return {
        ...action,
        score
      };
    })
    .filter((action) => action.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.quickActionTitle.localeCompare(right.quickActionTitle)
    );
}
