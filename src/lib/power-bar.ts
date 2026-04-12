import {
  getEntityKindForCrudEntityType,
  type EntityKind
} from "@/lib/entity-visuals";
import type { CrudEntityType, UserSummary } from "@/lib/types";
import { formatUserSummaryLine } from "@/lib/user-ownership";

export const POWER_BAR_SEARCH_ENTITY_TYPES: CrudEntityType[] = [
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

  if (
    !id ||
    !displayName ||
    (kind !== "human" && kind !== "bot")
  ) {
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

export function normalizePowerBarQuery(value: string) {
  return value.trim().toLowerCase();
}

export function powerBarEntityTypeToKind(
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

export function powerBarEntityTypeLabel(
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

export function inferPowerBarTitle(
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
    `${powerBarEntityTypeLabel(entityType, entity)} ${String(entity.id ?? "")}`
  );
}

export function inferPowerBarDetail(
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

  const context = [
    entity.goalTitle,
    entity.projectTitle,
    entity.status,
    entity.kind
  ]
    .map(readString)
    .find(Boolean);

  const ownerLine = formatUserSummaryLine(readUserSummary(entity.user));
  const fallback = compactParts([
    entityType === "note" ? powerBarEntityTypeLabel(entityType, entity) : null,
    ownerLine || null
  ]).join(" · ");

  return compactParts([summary, context, ownerLine || null]).join(" · ") || fallback;
}

export function buildPowerBarSearchText(
  entityType: CrudEntityType,
  entity: Record<string, unknown>
) {
  return compactParts([
    inferPowerBarTitle(entityType, entity),
    inferPowerBarDetail(entityType, entity),
    powerBarEntityTypeLabel(entityType, entity),
    readString(entity.slug),
    readString(entity.handle)
  ])
    .join(" ")
    .toLowerCase();
}

export function buildPowerBarHref(
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
      if (noteKind === "wiki" && slug) {
        return `/wiki/page/${encodeURIComponent(slug)}`;
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

export function scorePowerBarMatch(
  query: string,
  title: string,
  searchText: string
) {
  const normalizedQuery = normalizePowerBarQuery(query);
  if (!normalizedQuery) {
    return 0;
  }

  const normalizedTitle = normalizePowerBarQuery(title);
  const normalizedSearchText = normalizePowerBarQuery(searchText);
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
