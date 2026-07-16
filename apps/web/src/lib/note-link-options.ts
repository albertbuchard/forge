import { searchEntities } from "./api";
import {
  getEntityKindForCrudEntityType,
  type EntityKind
} from "./entity-visuals";
import type { CrudEntityType } from "./types";

export type NoteLinkOption = {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
  kind?: EntityKind;
};

export const NOTE_LINK_ENTITY_TYPES = [
  "goal",
  "project",
  "task",
  "strategy",
  "habit",
  "tag",
  "note",
  "person",
  "insight",
  "calendar_event",
  "work_block_template",
  "task_timebox",
  "life_event",
  "artifact",
  "psyche_value",
  "behavior_pattern",
  "behavior",
  "belief_entry",
  "mode_profile",
  "mode_guide_session",
  "flashcard",
  "event_type",
  "emotion_definition",
  "trigger_report",
  "preference_catalog",
  "preference_catalog_item",
  "preference_context",
  "preference_item",
  "questionnaire_instrument",
  "sleep_session",
  "workout_session"
] as const satisfies readonly CrudEntityType[];

type MissingNoteLinkEntityType = Exclude<
  CrudEntityType,
  (typeof NOTE_LINK_ENTITY_TYPES)[number]
>;
const noteLinkEntityTypeCatalogIsComplete: MissingNoteLinkEntityType extends never
  ? true
  : never = true;
void noteLinkEntityTypeCatalogIsComplete;

const NOTE_LINK_ENTITY_TYPE_SET = new Set<CrudEntityType>(
  NOTE_LINK_ENTITY_TYPES
);
const MAX_NOTE_LINK_RESULTS = 40;

export function encodeNoteLinkOptionValue(
  entityType: CrudEntityType,
  entityId: string
) {
  return `${entityType}:${entityId}`;
}

export function decodeNoteLinkOptionValue(value: string): {
  entityType: CrudEntityType;
  entityId: string;
} | null {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return null;
  }
  const entityType = value.slice(0, separatorIndex) as CrudEntityType;
  const entityId = value.slice(separatorIndex + 1).trim();
  if (!NOTE_LINK_ENTITY_TYPE_SET.has(entityType) || !entityId) {
    return null;
  }
  return { entityType, entityId };
}

function readText(entity: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = entity[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function compactText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
    : normalized;
}

function formatEntityType(entityType: CrudEntityType) {
  return entityType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseSearchError(result: Record<string, unknown>) {
  if (result.ok !== false) {
    return null;
  }
  const error = result.error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  return "Forge could not search linked records.";
}

export function parseNoteLinkSearchResults(
  results: unknown,
  maxResults = MAX_NOTE_LINK_RESULTS
): NoteLinkOption[] {
  const options = new Map<string, NoteLinkOption>();
  if (!Array.isArray(results)) {
    return [];
  }

  for (const rawResult of results) {
    if (
      !rawResult ||
      typeof rawResult !== "object" ||
      Array.isArray(rawResult)
    ) {
      continue;
    }
    const result = rawResult as Record<string, unknown>;
    const error = parseSearchError(result);
    if (error) {
      throw new Error(error);
    }
    const matches = Array.isArray(result.matches) ? result.matches : [];
    for (const match of matches) {
      if (!match || typeof match !== "object" || Array.isArray(match)) {
        continue;
      }
      const candidate = match as {
        entityType?: unknown;
        id?: unknown;
        entity?: unknown;
      };
      if (
        typeof candidate.entityType !== "string" ||
        !NOTE_LINK_ENTITY_TYPE_SET.has(
          candidate.entityType as CrudEntityType
        ) ||
        typeof candidate.id !== "string" ||
        !candidate.id.trim() ||
        !candidate.entity ||
        typeof candidate.entity !== "object" ||
        Array.isArray(candidate.entity)
      ) {
        continue;
      }

      const entityType = candidate.entityType as CrudEntityType;
      const entityId = candidate.id.trim();
      const entity = candidate.entity as Record<string, unknown>;
      const rawLabel = readText(entity, [
        "title",
        "name",
        "label",
        "statement",
        "displayName",
        "shortDescription",
        "slug",
        "contentPlain"
      ]);
      const label = compactText(
        rawLabel || `${formatEntityType(entityType)} ${entityId}`,
        120
      );
      const rawDescription = readText(entity, [
        "shortDescription",
        "description",
        "summary",
        "overview",
        "eventSituation",
        "contentPlain",
        "sourcePath",
        "kind"
      ]);
      const description = compactText(
        rawDescription && rawDescription !== rawLabel
          ? rawDescription
          : formatEntityType(entityType),
        180
      );
      const value = encodeNoteLinkOptionValue(entityType, entityId);
      options.set(value, {
        value,
        label,
        description,
        searchText: `${label} ${description}`,
        kind: getEntityKindForCrudEntityType(entityType) ?? undefined
      });
    }
  }

  return Array.from(options.values()).slice(0, Math.max(0, maxResults));
}

export function buildFallbackNoteLinkOptions(values: string[]) {
  const options = new Map<string, NoteLinkOption>();
  for (const value of values) {
    const decoded = decodeNoteLinkOptionValue(value);
    if (!decoded) {
      continue;
    }
    options.set(value, {
      value,
      label: `${formatEntityType(decoded.entityType)} · ${decoded.entityId}`,
      description: "Linked Forge record",
      searchText: `${formatEntityType(decoded.entityType)} ${decoded.entityId}`,
      kind: getEntityKindForCrudEntityType(decoded.entityType) ?? undefined
    });
  }
  return Array.from(options.values());
}

export function mergeNoteLinkOptions(
  ...groups: ReadonlyArray<ReadonlyArray<NoteLinkOption>>
) {
  const options = new Map<string, NoteLinkOption>();
  for (const group of groups) {
    for (const option of group) {
      options.set(option.value, option);
    }
  }
  return Array.from(options.values()).sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

export async function searchNoteLinkOptions(
  query: string,
  userIds: string[] = []
) {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) {
    return [];
  }
  const response = await searchEntities({
    searches: [
      {
        entityTypes: [...NOTE_LINK_ENTITY_TYPES],
        query: normalizedQuery,
        userIds: userIds.length > 0 ? userIds : undefined,
        limit: MAX_NOTE_LINK_RESULTS,
        clientRef: "note-links"
      }
    ]
  });
  return parseNoteLinkSearchResults(response.results);
}

export async function resolveSelectedNoteLinkOptions(
  values: string[],
  userIds: string[] = []
) {
  const decodedValues = Array.from(
    new Map(
      values
        .map(decodeNoteLinkOptionValue)
        .filter((value) => value !== null)
        .map((value) => [
          encodeNoteLinkOptionValue(value.entityType, value.entityId),
          value
        ])
    ).values()
  );
  if (decodedValues.length === 0) {
    return [];
  }

  const byType = new Map<CrudEntityType, string[]>();
  for (const value of decodedValues) {
    const ids = byType.get(value.entityType) ?? [];
    ids.push(value.entityId);
    byType.set(value.entityType, ids);
  }
  const searches = Array.from(byType.entries()).flatMap(([entityType, ids]) =>
    Array.from(
      { length: Math.ceil(ids.length / MAX_NOTE_LINK_RESULTS) },
      (_, index) => {
        const chunk = ids.slice(
          index * MAX_NOTE_LINK_RESULTS,
          (index + 1) * MAX_NOTE_LINK_RESULTS
        );
        return {
          entityTypes: [entityType],
          ids: chunk,
          userIds: userIds.length > 0 ? userIds : undefined,
          limit: chunk.length,
          clientRef: `note-link-selection-${entityType}-${index}`
        };
      }
    )
  );
  const response = await searchEntities({ searches });
  return parseNoteLinkSearchResults(response.results, decodedValues.length);
}
