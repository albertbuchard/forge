import { getDatabase } from "../db.js";
import { HttpError } from "../errors.js";
import {
  crudEntityTypeSchema,
  type CrudEntityType
} from "../types.js";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphEntityKind,
  KnowledgeGraphNode
} from "@/lib/knowledge-graph-types.js";

export const LOCAL_SEARCH_MAX_DOCUMENTS = 750;
export const LOCAL_SEARCH_MAX_QUERY_LENGTH = 200;
export const LOCAL_SEARCH_MAX_RESULTS = 20;
export const LOCAL_SEARCH_MAX_EVIDENCE = 3;
export const LOCAL_SEARCH_MAX_DOCUMENT_CHARACTERS = 6_000;
export const LOCAL_SEARCH_MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
export const LOCAL_SEARCH_MAX_RELATIONSHIPS = 750;

export type WorkSearchEntityType =
  | "work_organization"
  | "work_engagement"
  | "opportunity_campaign"
  | "job_opportunity"
  | "job_application"
  | "job_interview"
  | "job_offer"
  | "work_outreach";

export type LocalSearchEntityType = CrudEntityType | WorkSearchEntityType;

export const LOCAL_SEARCH_WORK_ENTITY_TYPES = [
  "work_organization",
  "work_engagement",
  "opportunity_campaign",
  "job_opportunity",
  "job_application",
  "job_interview",
  "job_offer",
  "work_outreach"
] as const satisfies readonly WorkSearchEntityType[];

export const LOCAL_SEARCH_GRAPH_ENTITY_TYPES = [
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
  "trigger_report"
] as const satisfies readonly CrudEntityType[];

export const LOCAL_SEARCH_SUPPLEMENTAL_ENTITY_TYPES = [
  "life_event",
  "preference_catalog",
  "preference_catalog_item",
  "preference_context",
  "preference_item",
  "questionnaire_instrument",
  "sleep_session",
  "workout_session"
] as const satisfies readonly CrudEntityType[];

export const LOCAL_SEARCH_ELIGIBLE_ENTITY_TYPES = Object.freeze([
  ...crudEntityTypeSchema.options,
  ...LOCAL_SEARCH_WORK_ENTITY_TYPES
]);

const ELIGIBLE_ENTITY_TYPE_SET = new Set<LocalSearchEntityType>(
  LOCAL_SEARCH_ELIGIBLE_ENTITY_TYPES
);

const LOCAL_SEARCH_SOURCE_TABLES = [
  "goals",
  "projects",
  "tasks",
  "strategies",
  "habits",
  "tags",
  "notes",
  "people",
  "insights",
  "calendar_events",
  "work_block_templates",
  "task_timeboxes",
  "life_events",
  "artifacts",
  "psyche_values",
  "behavior_patterns",
  "psyche_behaviors",
  "belief_entries",
  "mode_profiles",
  "mode_guide_sessions",
  "psyche_flashcards",
  "event_types",
  "emotion_definitions",
  "trigger_reports",
  "preference_catalogs",
  "preference_catalog_items",
  "preference_contexts",
  "preference_items",
  "questionnaire_instruments",
  "health_sleep_sessions",
  "health_workout_sessions",
  "work_organizations",
  "work_engagements",
  "opportunity_campaigns",
  "job_opportunities",
  "job_applications",
  "job_interviews",
  "job_offers",
  "work_outreach"
] as const;

type LocalSearchField = {
  key: string;
  label: string;
  value: string;
  weight: number;
};

export type LocalSearchDocument = {
  key: string;
  entityType: LocalSearchEntityType;
  entityId: string;
  entityKind: KnowledgeGraphEntityKind | null;
  title: string;
  detail: string;
  category: string;
  sourceHref: string;
  graphHref: string | null;
  updatedAt: string | null;
  importance: number;
  fields: LocalSearchField[];
};

export type LocalSearchTextEvidence = {
  kind: "text";
  label: string;
  field: string;
  excerpt: string;
  matchedTerms: string[];
};

export type LocalSearchRelationshipEvidence = {
  kind: "relationship";
  label: string;
  excerpt: string;
  relationKind: string;
  relatedEntityType: LocalSearchEntityType;
  relatedEntityId: string;
};

export type LocalSearchEvidence =
  | LocalSearchTextEvidence
  | LocalSearchRelationshipEvidence;

export type LocalSearchResult = {
  entityType: LocalSearchEntityType;
  entityId: string;
  entityKind: KnowledgeGraphEntityKind | null;
  title: string;
  detail: string;
  category: string;
  sourceHref: string;
  graphHref: string | null;
  score: number;
  evidence: LocalSearchEvidence[];
};

export type LocalSearchResponse = {
  query: string;
  retrievalMode: "local_lexical_structural";
  results: LocalSearchResult[];
  coverage: {
    eligibleEntityTypes: LocalSearchEntityType[];
    indexedDocuments: number;
    indexedRelationships: number;
    deletionTombstonesApplied: number;
    scopeTombstonesApplied: number;
    truncated: false;
  };
};

type IndexedField = LocalSearchField & {
  normalized: string;
  tokens: string[];
};

type IndexedDocument = LocalSearchDocument & {
  indexedFields: IndexedField[];
  allTokens: Set<string>;
};

type LexicalCandidate = {
  document: IndexedDocument;
  score: number;
  coverage: number;
  evidence: LocalSearchTextEvidence[];
};

const GENERIC_SEARCH_FIELDS = [
  ["title", "Title", 9],
  ["name", "Name", 9],
  ["label", "Label", 9],
  ["question", "Question", 9],
  ["summary", "Summary", 5],
  ["description", "Description", 4],
  ["notes", "Notes", 3],
  ["type", "Type", 2],
  ["kind", "Kind", 2],
  ["status", "Status", 1.5],
  ["category", "Category", 2],
  ["source", "Source", 1.25],
  ["instrumentKey", "Instrument key", 1.25]
] as const;

function normalizeTextWithRawOffsets(value: string) {
  let normalized = "";
  const rawOffsets: number[] = [];
  let rawOffset = 0;

  for (const rawCharacter of value) {
    const folded = rawCharacter
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("en");
    for (const foldedCharacter of folded) {
      if (/[a-z0-9]/.test(foldedCharacter)) {
        normalized += foldedCharacter;
        rawOffsets.push(rawOffset);
      } else if (normalized.length > 0 && !normalized.endsWith(" ")) {
        normalized += " ";
        rawOffsets.push(rawOffset);
      }
    }
    rawOffset += rawCharacter.length;
  }

  if (normalized.endsWith(" ")) {
    normalized = normalized.slice(0, -1);
    rawOffsets.pop();
  }
  return { normalized, rawOffsets };
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenizeNormalized(normalized: string) {
  return normalized.length === 0
    ? []
    : normalized
        .split(/\s+/)
        .filter((token) => token.length >= 2)
        .slice(0, 800);
}

function tokenize(value: string) {
  return tokenizeNormalized(normalizeText(value));
}

function readText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.replace(/\s+/g, " ").trim()
    : null;
}

function truncate(value: string, maximum: number) {
  if (value.length <= maximum) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function humanizeEntityType(entityType: LocalSearchEntityType) {
  return entityType
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isLocalSearchEntityType(value: unknown): value is LocalSearchEntityType {
  return (
    typeof value === "string" &&
    ELIGIBLE_ENTITY_TYPE_SET.has(value as LocalSearchEntityType)
  );
}

function pushField(
  fields: LocalSearchField[],
  field: Omit<LocalSearchField, "value"> & { value: unknown },
  remainingCharacters: { value: number }
) {
  const text = readText(field.value);
  if (!text || remainingCharacters.value <= 0) {
    return;
  }
  const value = truncate(text, remainingCharacters.value);
  remainingCharacters.value -= value.length;
  fields.push({ ...field, value });
}

function buildGraphFields(node: KnowledgeGraphNode) {
  const fields: LocalSearchField[] = [];
  const remaining = { value: LOCAL_SEARCH_MAX_DOCUMENT_CHARACTERS };
  pushField(
    fields,
    { key: "title", label: "Title", value: node.title, weight: 9 },
    remaining
  );
  pushField(
    fields,
    { key: "subtitle", label: "Subtitle", value: node.subtitle, weight: 5 },
    remaining
  );
  pushField(
    fields,
    {
      key: "description",
      label: "Description",
      value: node.description,
      weight: 4
    },
    remaining
  );
  for (const tag of node.tags.slice(0, 20)) {
    pushField(
      fields,
      { key: "tag", label: "Tag", value: tag.label, weight: 4.5 },
      remaining
    );
  }
  pushField(
    fields,
    {
      key: "owner",
      label: "Person",
      value: node.owner?.displayName,
      weight: 2
    },
    remaining
  );
  for (const stat of node.previewStats.slice(0, 3)) {
    pushField(
      fields,
      {
        key: `preview:${stat.label}`,
        label: stat.label,
        value: stat.value,
        weight: 1.5
      },
      remaining
    );
  }
  pushField(
    fields,
    {
      key: "source_text",
      label: "Source text",
      value: node.searchText,
      weight: 1
    },
    remaining
  );
  return fields;
}

function firstFieldValue(
  entity: Record<string, unknown>,
  keys: readonly string[]
) {
  for (const key of keys) {
    const value = readText(entity[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function buildSupplementalFields(entity: Record<string, unknown>) {
  const fields: LocalSearchField[] = [];
  const remaining = { value: LOCAL_SEARCH_MAX_DOCUMENT_CHARACTERS };
  for (const [key, label, weight] of GENERIC_SEARCH_FIELDS) {
    pushField(fields, { key, label, value: entity[key], weight }, remaining);
  }
  const tags = Array.isArray(entity.tags) ? entity.tags : [];
  for (const tag of tags.slice(0, 20)) {
    pushField(
      fields,
      {
        key: "tag",
        label: "Tag",
        value:
          typeof tag === "string"
            ? tag
            : tag && typeof tag === "object"
              ? (tag as Record<string, unknown>).label
              : null,
        weight: 4.5
      },
      remaining
    );
  }
  return fields;
}

type SupplementalLocalSearchMatch = {
  entityType: CrudEntityType;
  id: string;
  entity: Record<string, unknown>;
  deleted: false;
};

function parseStringArray(value: unknown) {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function selectedUserClause(
  selectedUserIds: string[],
  column: string,
  parameters: string[]
) {
  if (selectedUserIds.length === 0) {
    return "";
  }
  parameters.push(...selectedUserIds);
  return `AND ${column} IN (${selectedUserIds.map(() => "?").join(", ")})`;
}

function selectedOwnedEntityClause(
  selectedUserIds: string[],
  entityType: CrudEntityType,
  idColumn: string,
  parameters: string[]
) {
  if (selectedUserIds.length === 0) {
    return "";
  }
  const placeholders = selectedUserIds.map(() => "?").join(", ");
  parameters.push(
    entityType,
    ...selectedUserIds,
    entityType,
    ...selectedUserIds
  );
  return `AND (
    EXISTS (
      SELECT 1
      FROM entity_owners owner
      WHERE owner.entity_type = ?
        AND owner.entity_id = ${idColumn}
        AND owner.role = 'owner'
        AND owner.user_id IN (${placeholders})
    )
    OR EXISTS (
      SELECT 1
      FROM entity_assignments assignment
      WHERE assignment.entity_type = ?
        AND assignment.entity_id = ${idColumn}
        AND assignment.role = 'assignee'
        AND assignment.user_id IN (${placeholders})
    )
  )`;
}

/**
 * Builds the eight non-graph search families from narrow public projections.
 *
 * The route checks the shared 3,000-record ceiling before this function runs.
 * Each query applies its canonical owner or embedded-user scope in SQL, so
 * records outside the selected people scope are never hydrated or tokenized.
 * Health projections deliberately omit provider payloads, measurements,
 * annotations, provenance, and derived JSON.
 */
export function listSupplementalLocalSearchDocuments(userIds?: string[]) {
  const selectedUserIds = Array.from(
    new Set((userIds ?? []).map((value) => value.trim()).filter(Boolean))
  );
  const database = getDatabase();
  const matches: SupplementalLocalSearchMatch[] = [];

  const lifeEventParameters: string[] = [];
  const lifeEventScope = selectedOwnedEntityClause(
    selectedUserIds,
    "life_event",
    "life_events.id",
    lifeEventParameters
  );
  const lifeEvents = database
    .prepare(
      `SELECT id, title, short_description, description, event_type, status,
              importance, starts_at, place_label, origin_label,
              destination_label, transport_mode, updated_at
       FROM life_events
       WHERE deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM deleted_entities deleted
           WHERE deleted.entity_type = 'life_event'
             AND deleted.entity_id = life_events.id
         )
         ${lifeEventScope}
       ORDER BY updated_at DESC, id ASC`
    )
    .all(...lifeEventParameters) as Array<Record<string, unknown>>;
  for (const row of lifeEvents) {
    const id = String(row.id);
    matches.push({
      entityType: "life_event",
      id,
      deleted: false,
      entity: {
        title: row.title,
        summary: row.short_description,
        description: row.description,
        type: row.event_type,
        status: row.status,
        category: row.importance,
        notes: [
          row.place_label,
          row.origin_label,
          row.destination_label,
          row.transport_mode
        ]
          .filter((value) => typeof value === "string" && value.length > 0)
          .join(" · "),
        startedAt: row.starts_at,
        updatedAt: row.updated_at
      }
    });
  }

  const catalogParameters: string[] = [];
  const catalogScope = selectedUserClause(
    selectedUserIds,
    "profiles.user_id",
    catalogParameters
  );
  const catalogs = database
    .prepare(
      `SELECT catalogs.id, catalogs.title, catalogs.description,
              catalogs.domain, catalogs.source, catalogs.updated_at
       FROM preference_catalogs catalogs
       INNER JOIN preference_profiles profiles
         ON profiles.id = catalogs.profile_id
       WHERE catalogs.archived = 0
         ${catalogScope}
       ORDER BY catalogs.updated_at DESC, catalogs.id ASC`
    )
    .all(...catalogParameters) as Array<Record<string, unknown>>;
  for (const row of catalogs) {
    matches.push({
      entityType: "preference_catalog",
      id: String(row.id),
      deleted: false,
      entity: {
        title: row.title,
        description: row.description,
        category: row.domain,
        source: row.source,
        updatedAt: row.updated_at
      }
    });
  }

  const catalogItemParameters: string[] = [];
  const catalogItemScope = selectedUserClause(
    selectedUserIds,
    "profiles.user_id",
    catalogItemParameters
  );
  const catalogItems = database
    .prepare(
      `SELECT items.id, items.label, items.description, items.tags_json,
              items.updated_at
       FROM preference_catalog_items items
       INNER JOIN preference_catalogs catalogs ON catalogs.id = items.catalog_id
       INNER JOIN preference_profiles profiles ON profiles.id = catalogs.profile_id
       WHERE items.archived = 0
         AND catalogs.archived = 0
         ${catalogItemScope}
       ORDER BY items.updated_at DESC, items.id ASC`
    )
    .all(...catalogItemParameters) as Array<Record<string, unknown>>;
  for (const row of catalogItems) {
    matches.push({
      entityType: "preference_catalog_item",
      id: String(row.id),
      deleted: false,
      entity: {
        label: row.label,
        description: row.description,
        tags: parseStringArray(row.tags_json),
        updatedAt: row.updated_at
      }
    });
  }

  const contextParameters: string[] = [];
  const contextScope = selectedUserClause(
    selectedUserIds,
    "profiles.user_id",
    contextParameters
  );
  const contexts = database
    .prepare(
      `SELECT contexts.id, contexts.name, contexts.description,
              contexts.share_mode, contexts.active, contexts.updated_at
       FROM preference_contexts contexts
       INNER JOIN preference_profiles profiles ON profiles.id = contexts.profile_id
       WHERE 1 = 1
         ${contextScope}
       ORDER BY contexts.updated_at DESC, contexts.id ASC`
    )
    .all(...contextParameters) as Array<Record<string, unknown>>;
  for (const row of contexts) {
    matches.push({
      entityType: "preference_context",
      id: String(row.id),
      deleted: false,
      entity: {
        name: row.name,
        description: row.description,
        type: row.share_mode,
        status: Number(row.active) === 1 ? "active" : "inactive",
        updatedAt: row.updated_at
      }
    });
  }

  const preferenceItemParameters: string[] = [];
  const preferenceItemScope = selectedUserClause(
    selectedUserIds,
    "profiles.user_id",
    preferenceItemParameters
  );
  const preferenceItems = database
    .prepare(
      `SELECT items.id, items.label, items.description, items.tags_json,
              items.source_entity_type, items.updated_at
       FROM preference_items items
       INNER JOIN preference_profiles profiles ON profiles.id = items.profile_id
       WHERE 1 = 1
         ${preferenceItemScope}
       ORDER BY items.updated_at DESC, items.id ASC`
    )
    .all(...preferenceItemParameters) as Array<Record<string, unknown>>;
  for (const row of preferenceItems) {
    matches.push({
      entityType: "preference_item",
      id: String(row.id),
      deleted: false,
      entity: {
        label: row.label,
        description: row.description,
        tags: parseStringArray(row.tags_json),
        type: row.source_entity_type,
        updatedAt: row.updated_at
      }
    });
  }

  const questionnaireParameters: string[] = [];
  const questionnaireScope =
    selectedUserIds.length === 0
      ? ""
      : `AND (
          instruments.is_system = 1
          OR instruments.owner_user_id IN (${selectedUserIds.map(() => "?").join(", ")})
        )`;
  questionnaireParameters.push(...selectedUserIds);
  const instruments = database
    .prepare(
      `SELECT instruments.id, instruments.key, instruments.title,
              instruments.subtitle, instruments.description,
              instruments.aliases_json, instruments.symptom_domains_json,
              instruments.tags_json, instruments.source_class,
              instruments.availability, instruments.status,
              instruments.updated_at
       FROM questionnaire_instruments instruments
       WHERE instruments.status != 'archived'
         ${questionnaireScope}
       ORDER BY instruments.updated_at DESC, instruments.id ASC`
    )
    .all(...questionnaireParameters) as Array<Record<string, unknown>>;
  for (const row of instruments) {
    matches.push({
      entityType: "questionnaire_instrument",
      id: String(row.id),
      deleted: false,
      entity: {
        title: row.title,
        summary: row.subtitle,
        description: row.description,
        tags: [
          ...parseStringArray(row.aliases_json),
          ...parseStringArray(row.symptom_domains_json),
          ...parseStringArray(row.tags_json)
        ].slice(0, 20),
        category: row.source_class,
        type: row.availability,
        status: row.status,
        instrumentKey: row.key,
        updatedAt: row.updated_at
      }
    });
  }

  const sleepParameters: string[] = [];
  const sleepScope = selectedUserClause(
    selectedUserIds,
    "sessions.user_id",
    sleepParameters
  );
  const sleepSessions = database
    .prepare(
      `SELECT sessions.id, sessions.source, sessions.source_type,
              sessions.started_at, sessions.ended_at, sessions.updated_at
       FROM health_sleep_sessions sessions
       WHERE 1 = 1
         ${sleepScope}
       ORDER BY sessions.updated_at DESC, sessions.id ASC`
    )
    .all(...sleepParameters) as Array<Record<string, unknown>>;
  for (const row of sleepSessions) {
    matches.push({
      entityType: "sleep_session",
      id: String(row.id),
      deleted: false,
      entity: {
        title: `Sleep on ${String(row.started_at).slice(0, 10)}`,
        summary: `Sleep from ${String(row.started_at)} to ${String(row.ended_at)}`,
        type: row.source_type,
        source: row.source,
        startedAt: row.started_at,
        updatedAt: row.updated_at
      }
    });
  }

  const workoutParameters: string[] = [];
  const workoutScope = selectedUserClause(
    selectedUserIds,
    "sessions.user_id",
    workoutParameters
  );
  const workoutSessions = database
    .prepare(
      `SELECT sessions.id, sessions.source, sessions.source_type,
              sessions.workout_type, sessions.started_at, sessions.ended_at,
              sessions.updated_at
       FROM health_workout_sessions sessions
       WHERE 1 = 1
         ${workoutScope}
       ORDER BY sessions.updated_at DESC, sessions.id ASC`
    )
    .all(...workoutParameters) as Array<Record<string, unknown>>;
  for (const row of workoutSessions) {
    const workoutType = readText(row.workout_type) ?? "Workout";
    matches.push({
      entityType: "workout_session",
      id: String(row.id),
      deleted: false,
      entity: {
        title: `${workoutType.replaceAll("_", " ")} workout`,
        summary: `Workout from ${String(row.started_at)} to ${String(row.ended_at)}`,
        type: row.source_type,
        category: workoutType,
        source: row.source,
        startedAt: row.started_at,
        updatedAt: row.updated_at
      }
    });
  }

  return buildSupplementalLocalSearchDocuments(matches);
}

export function buildLocalSearchSourceHref(
  entityType: LocalSearchEntityType,
  entityId: string,
  entity: Record<string, unknown> = {}
) {
  const id = encodeURIComponent(entityId);
  switch (entityType) {
    case "goal":
      return `/goals/${id}`;
    case "project":
      return `/projects/${id}`;
    case "task":
      return `/tasks/${id}`;
    case "strategy":
      return `/strategies/${id}`;
    case "habit":
      return `/habits?focus=${id}`;
    case "tag":
      return `/tags?focus=${id}`;
    case "note": {
      const kind = readText(entity.kind);
      const slug = readText(entity.slug);
      const spaceId = readText(entity.spaceId);
      if (kind === "wiki" && slug) {
        return `/wiki/page/${encodeURIComponent(slug)}${
          spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ""
        }`;
      }
      return `/notes?focus=${id}`;
    }
    case "person":
      return `/people/${id}`;
    case "insight":
      return `/knowledge-graph?focus=${encodeURIComponent(`insight:${entityId}`)}`;
    case "calendar_event":
    case "work_block_template":
    case "task_timebox":
      return `/calendar?focus=${id}&focusType=${entityType}`;
    case "life_event":
      return `/life-events?focus=${id}`;
    case "artifact":
      return `/artifacts/${id}`;
    case "psyche_value":
      return `/psyche/values?focus=${id}#values-atlas`;
    case "behavior_pattern":
      return `/psyche/patterns?focus=${id}#pattern-lanes`;
    case "behavior":
      return `/psyche/behaviors?focus=${id}#behavior-columns`;
    case "belief_entry":
      return `/psyche/schemas-beliefs?focus=${id}`;
    case "mode_profile":
      return `/psyche/modes?focus=${id}`;
    case "mode_guide_session":
      return `/psyche/modes/guide?focus=${id}`;
    case "flashcard":
      return `/psyche/flashcards?focus=${id}`;
    case "event_type":
    case "emotion_definition":
      return `/knowledge-graph?focus=${encodeURIComponent(`${entityType}:${entityId}`)}`;
    case "trigger_report":
      return `/psyche/reports/${id}`;
    case "preference_catalog":
      return `/preferences?focusCatalog=${id}`;
    case "preference_catalog_item":
      return `/preferences?focusCatalogItem=${id}`;
    case "preference_context":
      return `/preferences?focusContext=${id}`;
    case "preference_item":
      return `/preferences?focusItem=${id}`;
    case "questionnaire_instrument":
      return `/psyche/questionnaires/${id}`;
    case "sleep_session":
      return `/sleep?focus=${id}`;
    case "workout_session":
      return `/sports/workouts/${id}`;
    case "work_organization":
      return `/work/organizations/${id}`;
    case "work_engagement":
      return `/work/engagements/${id}`;
    case "opportunity_campaign":
      return `/work/campaigns/${id}`;
    case "job_opportunity":
      return `/work/opportunities/${id}`;
    case "job_application":
      return `/work/applications/${id}`;
    case "job_interview":
      return `/work/interviews/${id}`;
    case "job_offer":
      return `/work/offers/${id}`;
    case "work_outreach":
      return `/work/outreach/${id}`;
  }
}

export function buildGraphLocalSearchDocuments(nodes: KnowledgeGraphNode[]) {
  return nodes.flatMap((node): LocalSearchDocument[] => {
    if (!isLocalSearchEntityType(node.entityType)) {
      return [];
    }
    const fields = buildGraphFields(node);
    const sourceHref =
      node.href ??
      buildLocalSearchSourceHref(node.entityType, node.entityId, {
        kind: node.entityKind === "wiki_page" ? "wiki" : null
      });
    return [
      {
        key: node.id,
        entityType: node.entityType,
        entityId: node.entityId,
        entityKind: node.entityKind,
        title: node.title,
        detail: node.description || node.subtitle || "Open the source record.",
        category: humanizeEntityType(node.entityType),
        sourceHref,
        graphHref: node.graphHref,
        updatedAt: node.updatedAt,
        importance: Number.isFinite(node.importance) ? node.importance : 0,
        fields
      }
    ];
  });
}

export function buildSupplementalLocalSearchDocuments(
  matches: Array<{
    entityType?: unknown;
    id?: unknown;
    entity?: unknown;
    deleted?: unknown;
  }>
) {
  return matches.flatMap((match): LocalSearchDocument[] => {
    if (
      match.deleted === true ||
      !isLocalSearchEntityType(match.entityType) ||
      typeof match.id !== "string" ||
      !match.entity ||
      typeof match.entity !== "object" ||
      Array.isArray(match.entity)
    ) {
      return [];
    }
    const entity = match.entity as Record<string, unknown>;
    const fields = buildSupplementalFields(entity);
    const title =
      firstFieldValue(entity, ["title", "name", "label", "question"]) ??
      `${humanizeEntityType(match.entityType)} ${match.id}`;
    const detail =
      firstFieldValue(entity, ["summary", "description", "notes", "type"]) ??
      "Open the source record.";
    return [
      {
        key: `${match.entityType}:${match.id}`,
        entityType: match.entityType,
        entityId: match.id,
        entityKind: null,
        title: truncate(title, 120),
        detail: truncate(detail, 220),
        category: humanizeEntityType(match.entityType),
        sourceHref: buildLocalSearchSourceHref(
          match.entityType,
          match.id,
          entity
        ),
        graphHref: null,
        updatedAt:
          firstFieldValue(entity, ["updatedAt", "createdAt", "startedAt"]) ??
          null,
        importance: 0,
        fields
      }
    ];
  });
}

export function getLocalSearchSourceRecordCount() {
  const union = LOCAL_SEARCH_SOURCE_TABLES.map(
    (table) => `SELECT COUNT(*) AS count FROM ${table}`
  ).join(" UNION ALL ");
  const row = getDatabase()
    .prepare(`SELECT COALESCE(SUM(count), 0) AS count FROM (${union})`)
    .get() as { count: number };
  return Number(row.count);
}

export function assertLocalSearchCapacity() {
  const sourceRecords = getLocalSearchSourceRecordCount();
  if (sourceRecords > LOCAL_SEARCH_MAX_DOCUMENTS) {
    throw new HttpError(
      413,
      "local_search_capacity_exceeded",
      `Forge has ${sourceRecords} searchable local records. Local search is limited to ${LOCAL_SEARCH_MAX_DOCUMENTS} records so it does not consume unbounded memory. Narrow the data set before searching.`
    );
  }
  return sourceRecords;
}

export function listLocalSearchDeletionTombstones() {
  const rows = getDatabase()
    .prepare(
      `SELECT entity_type, entity_id
       FROM deleted_entities
       ORDER BY entity_type, entity_id`
    )
    .all() as Array<{ entity_type: string; entity_id: string }>;
  return new Set(
    rows
      .filter((row) => isLocalSearchEntityType(row.entity_type))
      .map((row) => `${row.entity_type}:${row.entity_id}`)
  );
}

export function listLocalSearchScopeTombstones(userIds?: string[]) {
  const selected = Array.from(
    new Set((userIds ?? []).map((value) => value.trim()).filter(Boolean))
  );
  if (selected.length === 0) {
    return new Set<string>();
  }
  const placeholders = selected.map(() => "?").join(", ");
  const rows = getDatabase()
    .prepare(
      `SELECT owner.entity_type, owner.entity_id
       FROM entity_owners owner
       WHERE owner.role = 'owner'
         AND owner.user_id NOT IN (${placeholders})
         AND NOT EXISTS (
           SELECT 1
           FROM entity_assignments assignment
           WHERE assignment.entity_type = owner.entity_type
             AND assignment.entity_id = owner.entity_id
             AND assignment.role = 'assignee'
             AND assignment.user_id IN (${placeholders})
         )
       ORDER BY owner.entity_type, owner.entity_id`
    )
    .all(...selected, ...selected) as Array<{
    entity_type: string;
    entity_id: string;
  }>;
  return new Set(
    rows
      .filter((row) => isLocalSearchEntityType(row.entity_type))
      .map((row) => `${row.entity_type}:${row.entity_id}`)
  );
}

function indexDocument(document: LocalSearchDocument): IndexedDocument {
  const indexedFields = document.fields
    .map((field) => {
      const normalized = normalizeText(field.value);
      return {
        ...field,
        normalized,
        tokens: tokenizeNormalized(normalized)
      };
    })
    .filter((field) => field.normalized.length > 0);
  return {
    ...document,
    indexedFields,
    allTokens: new Set(indexedFields.flatMap((field) => field.tokens))
  };
}

function termMatches(fieldToken: string, queryToken: string) {
  return (
    fieldToken === queryToken ||
    (queryToken.length >= 4 && fieldToken.startsWith(queryToken))
  );
}

function matchedTerms(field: IndexedField, queryTokens: string[]) {
  return queryTokens.filter((queryToken) =>
    field.tokens.some((fieldToken) => termMatches(fieldToken, queryToken))
  );
}

function documentMatchesTerm(document: IndexedDocument, queryToken: string) {
  for (const fieldToken of document.allTokens) {
    if (termMatches(fieldToken, queryToken)) {
      return true;
    }
  }
  return false;
}

function buildExcerpt(value: string, terms: string[]) {
  const { normalized, rawOffsets } = normalizeTextWithRawOffsets(value);
  const firstTerm = terms[0] ?? "";
  const normalizedIndex = firstTerm ? normalized.indexOf(firstTerm) : 0;
  if (normalizedIndex <= 70) {
    return truncate(value, 180);
  }
  const normalizedStart = Math.max(0, normalizedIndex - 60);
  const rawStart = rawOffsets[normalizedStart] ?? 0;
  return `…${truncate(value.slice(rawStart), 178)}`;
}

function measureIndexableDocumentBytes(document: LocalSearchDocument) {
  return document.fields.reduce(
    (total, field) => total + Buffer.byteLength(field.value, "utf8"),
    0
  );
}

function measureDocumentBytes(documents: LocalSearchDocument[]) {
  let bytes = 0;
  for (const document of documents) {
    bytes += measureIndexableDocumentBytes(document);
    if (bytes > LOCAL_SEARCH_MAX_DOCUMENT_BYTES) {
      throw new HttpError(
        413,
        "local_search_capacity_exceeded",
        `Local search received more than ${LOCAL_SEARCH_MAX_DOCUMENT_BYTES} bytes of authorized indexable record text, above its transient indexing limit.`
      );
    }
  }
  return bytes;
}

function scoreLexicalDocuments(
  documents: IndexedDocument[],
  query: string
): LexicalCandidate[] {
  const queryTokens = Array.from(new Set(tokenize(query))).slice(0, 20);
  if (queryTokens.length === 0) {
    return documents.map((document) => ({
      document,
      score: Math.max(0.01, document.importance / 100),
      coverage: 1,
      evidence: [
        {
          kind: "text",
          label: document.fields[0]?.label ?? "Source record",
          field: document.fields[0]?.key ?? "source",
          excerpt: truncate(document.fields[0]?.value ?? document.title, 180),
          matchedTerms: []
        }
      ]
    }));
  }

  const documentFrequency = new Map<string, number>();
  for (const token of queryTokens) {
    let frequency = 0;
    for (const document of documents) {
      if (documentMatchesTerm(document, token)) {
        frequency += 1;
      }
    }
    documentFrequency.set(token, frequency);
  }

  const normalizedQuery = normalizeText(query);
  return documents.flatMap((document): LexicalCandidate[] => {
    const evidenceWithScore = document.indexedFields.flatMap((field) => {
      const terms = matchedTerms(field, queryTokens);
      if (terms.length === 0) {
        return [];
      }
      const contribution = terms.reduce((total, term) => {
        const frequency = documentFrequency.get(term) ?? 0;
        const inverseFrequency =
          Math.log((documents.length + 1) / (frequency + 1)) + 1;
        return total + field.weight * inverseFrequency;
      }, 0);
      const phraseBonus = field.normalized.includes(normalizedQuery)
        ? field.weight * 1.75
        : 0;
      return [
        {
          score: contribution + phraseBonus,
          evidence: {
            kind: "text" as const,
            label: field.label,
            field: field.key,
            excerpt: buildExcerpt(field.value, terms),
            matchedTerms: terms
          }
        }
      ];
    });
    if (evidenceWithScore.length === 0) {
      return [];
    }
    const matched = new Set(
      evidenceWithScore.flatMap((entry) => entry.evidence.matchedTerms)
    );
    const coverage = matched.size / queryTokens.length;
    const score =
      evidenceWithScore.reduce((total, entry) => total + entry.score, 0) *
      (0.55 + coverage * 0.45);
    return [
      {
        document,
        score,
        coverage,
        evidence: evidenceWithScore
          .sort((left, right) => right.score - left.score)
          .slice(0, LOCAL_SEARCH_MAX_EVIDENCE)
          .map((entry) => entry.evidence)
      }
    ];
  });
}

function relationshipCandidate(
  edge: KnowledgeGraphEdge,
  seed: LexicalCandidate
): LocalSearchRelationshipEvidence {
  return {
    kind: "relationship",
    label: edge.label,
    excerpt: `${edge.label}: ${seed.document.title}`,
    relationKind: edge.relationKind,
    relatedEntityType: seed.document.entityType,
    relatedEntityId: seed.document.entityId
  };
}

export function searchLocalDocuments(input: {
  query?: string | null;
  documents: LocalSearchDocument[];
  edges?: KnowledgeGraphEdge[];
  deletionTombstones?: Set<string>;
  scopeTombstones?: Set<string>;
  entityTypes?: LocalSearchEntityType[];
  entityKinds?: KnowledgeGraphEntityKind[];
  limit?: number;
}): LocalSearchResponse {
  const query = input.query?.replace(/\s+/g, " ").trim() ?? "";
  if (query.length > LOCAL_SEARCH_MAX_QUERY_LENGTH) {
    throw new HttpError(
      400,
      "local_search_query_too_long",
      `Search text must be ${LOCAL_SEARCH_MAX_QUERY_LENGTH} characters or fewer.`
    );
  }
  const limit = Math.max(
    1,
    Math.min(LOCAL_SEARCH_MAX_RESULTS, Math.round(input.limit ?? 12))
  );
  const deletionTombstones = input.deletionTombstones ?? new Set<string>();
  const scopeTombstones = input.scopeTombstones ?? new Set<string>();
  const typeFilter = new Set(input.entityTypes ?? []);
  const kindFilter = new Set(input.entityKinds ?? []);
  const seen = new Set<string>();
  let deletionTombstonesApplied = 0;
  let scopeTombstonesApplied = 0;
  const liveDocuments = input.documents.filter((document) => {
    if (seen.has(document.key)) {
      return false;
    }
    seen.add(document.key);
    if (deletionTombstones.has(document.key)) {
      deletionTombstonesApplied += 1;
      return false;
    }
    if (scopeTombstones.has(document.key)) {
      scopeTombstonesApplied += 1;
      return false;
    }
    if (typeFilter.size > 0 && !typeFilter.has(document.entityType)) {
      return false;
    }
    if (
      kindFilter.size > 0 &&
      (!document.entityKind || !kindFilter.has(document.entityKind))
    ) {
      return false;
    }
    return true;
  });
  if (liveDocuments.length > LOCAL_SEARCH_MAX_DOCUMENTS) {
    throw new HttpError(
      413,
      "local_search_capacity_exceeded",
      `Local search received ${liveDocuments.length} records, above its ${LOCAL_SEARCH_MAX_DOCUMENTS}-record memory limit.`
    );
  }

  measureDocumentBytes(liveDocuments);
  const liveDocumentKeys = new Set(
    liveDocuments.map((document) => document.key)
  );
  const liveEdges = (input.edges ?? []).filter(
    (edge) =>
      liveDocumentKeys.has(edge.source) && liveDocumentKeys.has(edge.target)
  );
  if (liveEdges.length > LOCAL_SEARCH_MAX_RELATIONSHIPS) {
    throw new HttpError(
      413,
      "local_search_capacity_exceeded",
      `Local search received ${liveEdges.length} authorized relationships, above its ${LOCAL_SEARCH_MAX_RELATIONSHIPS}-relationship transient indexing limit.`
    );
  }

  const indexed = liveDocuments.map(indexDocument);
  const indexedByKey = new Map(
    indexed.map((document) => [document.key, document])
  );
  const lexical = scoreLexicalDocuments(indexed, query);
  const candidateByKey = new Map<
    string,
    LexicalCandidate & {
      relationshipEvidence: LocalSearchRelationshipEvidence[];
    }
  >(
    lexical.map((candidate) => [
      candidate.document.key,
      { ...candidate, relationshipEvidence: [] }
    ])
  );

  if (query.length > 0) {
    const seeds = [...lexical]
      .sort((left, right) => right.score - left.score)
      .slice(0, 8);
    const seedByKey = new Map(seeds.map((seed) => [seed.document.key, seed]));
    for (const edge of liveEdges) {
      const sourceSeed = seedByKey.get(edge.source);
      const targetSeed = seedByKey.get(edge.target);
      const seed = sourceSeed ?? targetSeed;
      const relatedKey = sourceSeed
        ? edge.target
        : targetSeed
          ? edge.source
          : null;
      if (!seed || !relatedKey) {
        continue;
      }
      const related = indexedByKey.get(relatedKey);
      if (!related || seed.document.key === related.key) {
        continue;
      }
      const structuralScore = seed.score * 0.18;
      const existing = candidateByKey.get(related.key);
      const evidence = relationshipCandidate(edge, seed);
      if (existing) {
        existing.score += structuralScore;
        if (existing.relationshipEvidence.length < LOCAL_SEARCH_MAX_EVIDENCE) {
          existing.relationshipEvidence.push(evidence);
        }
      } else {
        candidateByKey.set(related.key, {
          document: related,
          score: structuralScore,
          coverage: 0,
          evidence: [],
          relationshipEvidence: [evidence]
        });
      }
    }
  }

  const results = [...candidateByKey.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.coverage - left.coverage ||
        right.document.importance - left.document.importance ||
        left.document.title.localeCompare(right.document.title) ||
        left.document.key.localeCompare(right.document.key)
    )
    .slice(0, limit)
    .map((candidate) => ({
      entityType: candidate.document.entityType,
      entityId: candidate.document.entityId,
      entityKind: candidate.document.entityKind,
      title: candidate.document.title,
      detail: candidate.document.detail,
      category: candidate.document.category,
      sourceHref: candidate.document.sourceHref,
      graphHref: candidate.document.graphHref,
      score: Number(candidate.score.toFixed(6)),
      evidence: [
        ...candidate.evidence,
        ...candidate.relationshipEvidence
      ].slice(0, LOCAL_SEARCH_MAX_EVIDENCE)
    }));

  return {
    query,
    retrievalMode: "local_lexical_structural",
    results,
    coverage: {
      eligibleEntityTypes: [...LOCAL_SEARCH_ELIGIBLE_ENTITY_TYPES],
      indexedDocuments: indexed.length,
      indexedRelationships: liveEdges.length,
      deletionTombstonesApplied,
      scopeTombstonesApplied,
      truncated: false
    }
  };
}
