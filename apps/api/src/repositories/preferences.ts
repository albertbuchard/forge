import { createHash, randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import {
  absoluteSignalSchema,
  PREFERENCE_SIGNAL_MODEL_WEIGHTS,
  createPreferenceCatalogItemSchema,
  createPreferenceCatalogSchema,
  createPreferenceContextSchema,
  createPreferenceItemSchema,
  enqueueEntityPreferenceItemSchema,
  mergePreferenceContextsSchema,
  pairwiseJudgmentSchema,
  preferenceCatalogItemSchema,
  preferenceCatalogSchema,
  preferenceContextSchema,
  preferenceDimensionIdSchema,
  preferenceDimensionSummarySchema,
  preferenceItemSchema,
  preferenceItemScoreSchema,
  preferenceProfileSchema,
  preferenceCatalogSourceSchema,
  preferenceSnapshotSchema,
  preferenceWorkspacePayloadSchema,
  preferenceWorkspaceQuerySchema,
  startPreferenceGameSchema,
  submitAbsoluteSignalSchema,
  submitPairwiseJudgmentSchema,
  updatePreferenceCatalogItemSchema,
  updatePreferenceCatalogSchema,
  updatePreferenceContextSchema,
  updatePreferenceItemSchema,
  updatePreferenceScoreSchema,
  type AbsoluteSignal,
  type CreatePreferenceCatalogInput,
  type CreatePreferenceCatalogItemInput,
  type CreatePreferenceContextInput,
  type CreatePreferenceItemInput,
  type EnqueueEntityPreferenceItemInput,
  type MergePreferenceContextsInput,
  type PairwiseJudgment,
  type PreferenceCatalog,
  type PreferenceCatalogItem,
  type PreferenceCatalogSource,
  type PreferenceComparePair,
  type PreferenceContext,
  type PreferenceDimensionId,
  type PreferenceDimensionSummary,
  type PreferenceDimensionVector,
  type PreferenceDomain,
  type PreferenceItem,
  type PreferenceItemScore,
  type PreferenceItemStatus,
  type PreferenceProfile,
  type PreferenceSnapshot,
  type PreferenceWorkspacePayload,
  type PreferenceWorkspaceQuery,
  type StartPreferenceGameInput,
  type SubmitAbsoluteSignalInput,
  type SubmitPairwiseJudgmentInput,
  type UpdatePreferenceCatalogInput,
  type UpdatePreferenceCatalogItemInput,
  type UpdatePreferenceContextInput,
  type UpdatePreferenceItemInput,
  type UpdatePreferenceScoreInput
} from "../preferences-types.js";
import { getPreferenceCatalogSeeds } from "../preferences-seeds.js";
import { getUserById, getDefaultUser, listUsersByIds } from "./users.js";
import { clearEntityOwner, setEntityOwner } from "./entity-ownership.js";
import { recordActivityEvent } from "./activity-events.js";
import {
  deleteEntityLinksForEntity,
  listEntityLinksForSources,
  normalizeEntityLinks,
  replaceEntityLinksForSource
} from "./entity-links.js";
import { getGoalById } from "./goals.js";
import { getProjectById } from "./projects.js";
import { getTaskById } from "./tasks.js";
import { getStrategyById } from "./strategies.js";
import { getHabitById } from "./habits.js";
import { getNoteById } from "./notes.js";
import { getInsightById } from "./collaboration.js";
import {
  getCalendarEventById,
  getTaskTimeboxById,
  getWorkBlockTemplateById
} from "./calendar.js";
import {
  getBehaviorById,
  getBehaviorPatternById,
  getBeliefEntryById,
  getEmotionDefinitionById,
  getEventTypeById,
  getModeGuideSessionById,
  getModeProfileById,
  getPsycheValueById,
  getTriggerReportById
} from "./psyche.js";
import type { ActivitySource, CrudEntityType, UserSummary } from "../types.js";

const PREFERENCE_MODEL_VERSION = "pref-v1-bt-lite";
const DEFAULT_PREFERENCE_DOMAIN: PreferenceDomain = "projects";
const DIMENSION_IDS = preferenceDimensionIdSchema.options;
const PREFERENCE_CATALOG_ITEM_EMBED_LIMIT = 24;
const PREFERENCE_WORKSPACE_CATALOG_LIMIT = 24;
const PREFERENCE_SEARCH_FILTER_VALUE_LIMIT = 200;
const PREFERENCE_SEARCH_QUERY_LENGTH_LIMIT = 200;
const PREFERENCE_SEARCH_RESULT_LIMIT = 201;
const PREFERENCE_WORKSPACE_HISTORY_LIMIT = 100;
const PREFERENCE_MODEL_JUDGMENT_LIMIT_PER_CONTEXT = 1_000;

function normalizePreferenceSearchValues(
  values: string[] | undefined,
  fieldName: string
): string[] {
  const normalized = Array.from(
    new Set((values ?? []).map((value) => value.trim()).filter(Boolean))
  );
  if (normalized.length > PREFERENCE_SEARCH_FILTER_VALUE_LIMIT) {
    throw new HttpError(
      400,
      "preferences_search_filter_limit_exceeded",
      `${fieldName} accepts at most ${PREFERENCE_SEARCH_FILTER_VALUE_LIMIT} distinct values.`
    );
  }
  return normalized;
}

function normalizePreferenceSearchQuery(query: string | undefined) {
  const normalized = query?.trim();
  if (normalized && normalized.length > PREFERENCE_SEARCH_QUERY_LENGTH_LIMIT) {
    throw new HttpError(
      400,
      "preferences_search_query_too_long",
      `Preference search queries accept at most ${PREFERENCE_SEARCH_QUERY_LENGTH_LIMIT} characters.`
    );
  }
  return normalized;
}

type ProfileRow = {
  id: string;
  user_id: string;
  domain: PreferenceDomain;
  default_context_id: string | null;
  model_version: string;
  created_at: string;
  updated_at: string;
};

type ContextRow = {
  id: string;
  profile_id: string;
  name: string;
  description: string;
  share_mode: PreferenceContext["shareMode"];
  active: number;
  is_default: number;
  decay_days: number;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  profile_id: string;
  label: string;
  description: string;
  tags_json: string;
  feature_weights_json: string;
  source_entity_type: CrudEntityType | null;
  source_entity_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type CatalogRow = {
  id: string;
  profile_id: string;
  user_id: string;
  domain: PreferenceDomain;
  slug: string;
  title: string;
  description: string;
  scope_in: string;
  scope_out: string;
  source: PreferenceCatalogSource;
  created_source: PreferenceCatalog["createdSource"];
  created_by_actor: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
};

type PreferenceMutationContext = {
  source: ActivitySource;
  actor?: string | null;
};

type CatalogItemRow = {
  id: string;
  catalog_id: string;
  label: string;
  description: string;
  tags_json: string;
  feature_weights_json: string;
  position: number;
  archived: number;
  created_at: string;
  updated_at: string;
};

type PreferenceCatalogCursor = {
  version: 1;
  kind: "catalog";
  scope: string;
  snapshotAt: string;
  snapshotRowId: number;
  seen: number;
  after: { updatedAt: string; id: string };
};

type PreferenceCatalogItemCursor = {
  version: 1;
  kind: "catalog-item";
  scope: string;
  snapshotAt: string;
  snapshotRowId: number;
  seen: number;
  after: { catalogId: string; position: number; id: string };
};

export type PreferenceCatalogPage = {
  catalogs: PreferenceCatalog[];
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  previousOffset: number | null;
  snapshotAt: string;
  nextCursor: string | null;
};

export type PreferenceCatalogItemPage = {
  items: PreferenceCatalogItem[];
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  previousOffset: number | null;
  snapshotAt: string;
  nextCursor: string | null;
};

type JudgmentRow = {
  id: string;
  profile_id: string;
  context_id: string;
  user_id: string;
  left_item_id: string;
  right_item_id: string;
  outcome: PairwiseJudgment["outcome"];
  strength: number;
  response_time_ms: number | null;
  source: string;
  reason_tags_json: string;
  created_at: string;
};

type SignalRow = {
  id: string;
  profile_id: string;
  context_id: string;
  user_id: string;
  item_id: string;
  signal_type: AbsoluteSignal["signalType"];
  strength: number;
  source: string;
  actor: string | null;
  created_at: string;
};

type ScoreRow = {
  id: string;
  profile_id: string;
  context_id: string;
  item_id: string;
  latent_score: number;
  confidence: number;
  uncertainty: number;
  evidence_count: number;
  pairwise_wins: number;
  pairwise_losses: number;
  pairwise_ties: number;
  signal_count: number;
  conflict_count: number;
  status: PreferenceItemStatus;
  dominant_dimensions_json: string;
  explanation_json: string;
  manual_status: PreferenceItemStatus | null;
  manual_score: number | null;
  confidence_lock: number | null;
  bookmarked: number;
  compare_later: number;
  frozen: number;
  last_inferred_at: string;
  last_judgment_at: string | null;
  updated_at: string;
};

type DimensionRow = {
  id: string;
  profile_id: string;
  context_id: string;
  dimension_id: PreferenceDimensionId;
  leaning: number;
  confidence: number;
  movement: number;
  context_sensitivity: number;
  evidence_count: number;
  updated_at: string;
};

type SnapshotRow = {
  id: string;
  profile_id: string;
  context_id: string;
  summary_metrics_json: string;
  serialized_model_state_json: string;
  created_at: string;
};

type ScoreComputation = {
  itemId: string;
  latentScore: number;
  confidence: number;
  uncertainty: number;
  evidenceCount: number;
  pairwiseWins: number;
  pairwiseLosses: number;
  pairwiseTies: number;
  signalCount: number;
  conflictCount: number;
  status: PreferenceItemStatus;
  dominantDimensions: PreferenceDimensionId[];
  explanation: string[];
  manualStatus: PreferenceItemStatus | null;
  manualScore: number | null;
  confidenceLock: number | null;
  bookmarked: boolean;
  compareLater: boolean;
  frozen: boolean;
  lastInferredAt: string;
  lastJudgmentAt: string | null;
  updatedAt: string;
};

const DEFAULT_DIMENSIONS: PreferenceDimensionVector = {
  novelty: 0,
  simplicity: 0,
  rigor: 0,
  aesthetics: 0,
  depth: 0,
  structure: 0,
  familiarity: 0,
  surprise: 0
};

const DEFAULT_CONTEXT_TEMPLATES = [
  {
    key: "default",
    name: "Default",
    description: "General preference state for this domain.",
    shareMode: "shared" as const,
    active: true,
    isDefault: true,
    decayDays: 90
  },
  {
    key: "work",
    name: "Work",
    description: "Work-specific tradeoffs and constraints.",
    shareMode: "blended" as const,
    active: true,
    isDefault: false,
    decayDays: 75
  },
  {
    key: "personal",
    name: "Personal",
    description: "Personal-life preferences outside explicit work mode.",
    shareMode: "blended" as const,
    active: true,
    isDefault: false,
    decayDays: 90
  },
  {
    key: "discovery",
    name: "Discovery",
    description: "A looser context for sampling and calibration.",
    shareMode: "isolated" as const,
    active: true,
    isDefault: false,
    decayDays: 45
  }
];

function nowIso() {
  return new Date().toISOString();
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function tanhScale(value: number, divisor: number) {
  return Math.tanh(value / divisor);
}

function ageInDays(dateText: string | null | undefined) {
  if (!dateText) {
    return Number.POSITIVE_INFINITY;
  }
  const timestamp = Date.parse(dateText);
  if (Number.isNaN(timestamp)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60 * 24));
}

function timeDecay(ageDays: number, decayDays: number) {
  if (!Number.isFinite(ageDays)) {
    return 0;
  }
  return Math.exp(-ageDays / Math.max(7, decayDays));
}

function parseJsonArray<T>(value: string, fallback: T[] = []) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function catalogFingerprint(input: CreatePreferenceCatalogInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...input,
        links: normalizeEntityLinks(input.links).sort((left, right) =>
          `${left.entityType}:${left.entityId}:${left.anchorKey}:${left.relationship}`.localeCompare(
            `${right.entityType}:${right.entityId}:${right.anchorKey}:${right.relationship}`
          )
        )
      })
    )
    .digest("hex");
}

function judgmentFingerprint(input: SubmitPairwiseJudgmentInput) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function signalFingerprint(input: SubmitAbsoluteSignalInput) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function assertCatalogTitleAvailable(
  profileId: string,
  title: string,
  exceptCatalogId?: string
) {
  const existing = getDatabase()
    .prepare(
      `SELECT id
       FROM preference_catalogs
       WHERE profile_id = ?
         AND archived = 0
         AND lower(trim(title)) = lower(trim(?))
         AND (? IS NULL OR id <> ?)
       LIMIT 1`
    )
    .get(profileId, title, exceptCatalogId ?? null, exceptCatalogId ?? null) as
    | { id: string }
    | undefined;
  if (existing) {
    throw new HttpError(
      409,
      "preferences_catalog_duplicate",
      "An active preference catalog with this title already exists for the selected user and domain.",
      { existingCatalogId: existing.id }
    );
  }
}

function normalizeCatalogUniqueText(value: string) {
  return value.trim().toLowerCase();
}

function assertCatalogItemLabelAvailable(
  catalogId: string,
  label: string,
  exceptItemId?: string
) {
  const existing = getDatabase()
    .prepare(
      `SELECT id
       FROM preference_catalog_items
       WHERE catalog_id = ?
         AND archived = 0
         AND lower(trim(label)) = lower(trim(?))
         AND (? IS NULL OR id <> ?)
       LIMIT 1`
    )
    .get(catalogId, label, exceptItemId ?? null, exceptItemId ?? null) as
    | { id: string }
    | undefined;
  if (existing) {
    throw new HttpError(
      409,
      "preferences_catalog_item_duplicate",
      "This preference catalog already contains an active concept with the same label.",
      { existingCatalogItemId: existing.id }
    );
  }
}

function escapeSqlLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function nextCatalogSlug(
  profileId: string,
  requested: string,
  exceptCatalogId?: string
) {
  const baseSlug = slugify(requested) || "concept-list";
  const existingSlugs = new Set(
    (
      getDatabase()
        .prepare(
          `SELECT slug
           FROM preference_catalogs
           WHERE profile_id = ? AND (? IS NULL OR id <> ?)`
        )
        .all(
          profileId,
          exceptCatalogId ?? null,
          exceptCatalogId ?? null
        ) as Array<{ slug: string }>
    ).map((row) => row.slug)
  );
  let slug = baseSlug;
  let index = 2;
  while (existingSlugs.has(slug)) {
    slug = `${baseSlug}-${index}`;
    index += 1;
  }
  return slug;
}

function parseJsonObject<T extends Record<string, unknown>>(
  value: string,
  fallback: T
) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : fallback;
  } catch {
    return fallback;
  }
}

function normalizeDimensionVector(value: unknown): PreferenceDimensionVector {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    novelty: clamp(Number(source.novelty ?? 0), -1, 1),
    simplicity: clamp(Number(source.simplicity ?? 0), -1, 1),
    rigor: clamp(Number(source.rigor ?? 0), -1, 1),
    aesthetics: clamp(Number(source.aesthetics ?? 0), -1, 1),
    depth: clamp(Number(source.depth ?? 0), -1, 1),
    structure: clamp(Number(source.structure ?? 0), -1, 1),
    familiarity: clamp(Number(source.familiarity ?? 0), -1, 1),
    surprise: clamp(Number(source.surprise ?? 0), -1, 1)
  };
}

function vectorDistance(
  left: PreferenceDimensionVector,
  right: PreferenceDimensionVector
) {
  const squared = DIMENSION_IDS.reduce((sum, dimensionId) => {
    const delta = left[dimensionId] - right[dimensionId];
    return sum + delta * delta;
  }, 0);
  return Math.sqrt(squared / DIMENSION_IDS.length);
}

function mapProfile(row: ProfileRow): PreferenceProfile {
  return preferenceProfileSchema.parse({
    id: row.id,
    userId: row.user_id,
    domain: row.domain,
    defaultContextId: row.default_context_id,
    modelVersion: row.model_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    user: getUserById(row.user_id) ?? null
  });
}

function mapContext(row: ContextRow): PreferenceContext {
  return preferenceContextSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    description: row.description,
    shareMode: row.share_mode,
    active: row.active === 1,
    isDefault: row.is_default === 1,
    decayDays: row.decay_days,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapItem(row: ItemRow): PreferenceItem {
  return preferenceItemSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    label: row.label,
    description: row.description,
    tags: parseJsonArray<string>(row.tags_json).filter(Boolean),
    featureWeights: normalizeDimensionVector(
      parseJsonObject<Record<string, unknown>>(row.feature_weights_json, {})
    ),
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    linkedEntity:
      row.source_entity_type && row.source_entity_id
        ? {
            entityType: row.source_entity_type,
            entityId: row.source_entity_id
          }
        : null,
    metadata: parseJsonObject<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapCatalogItem(row: CatalogItemRow): PreferenceCatalogItem {
  return preferenceCatalogItemSchema.parse({
    id: row.id,
    catalogId: row.catalog_id,
    label: row.label,
    description: row.description,
    tags: parseJsonArray<string>(row.tags_json).filter(Boolean),
    featureWeights: normalizeDimensionVector(
      parseJsonObject<Record<string, unknown>>(row.feature_weights_json, {})
    ),
    position: row.position,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapCatalog(
  row: CatalogRow,
  items: PreferenceCatalogItem[],
  links = listEntityLinksForSources("preference_catalog", [row.id]),
  user: UserSummary | null = getUserById(row.user_id) ?? null,
  itemCount = items.length,
  matchingItemCount?: number
): PreferenceCatalog {
  return preferenceCatalogSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    userId: row.user_id,
    user,
    domain: row.domain,
    slug: row.slug,
    title: row.title,
    description: row.description,
    scopeIn: row.scope_in,
    scopeOut: row.scope_out,
    source: row.source,
    createdSource: row.created_source,
    createdByActor: row.created_by_actor,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    links,
    items,
    itemCount,
    matchingItemCount,
    itemsTruncated: (matchingItemCount ?? itemCount) > items.length
  });
}

function mapCatalogRows(
  catalogRows: CatalogRow[],
  options: { itemQuery?: string } = {}
): PreferenceCatalog[] {
  if (catalogRows.length === 0) {
    return [];
  }
  const catalogIds = catalogRows.map((row) => row.id);
  const placeholders = catalogIds.map(() => "?").join(", ");
  const itemQuery = options.itemQuery?.trim();
  const escapedItemQuery = itemQuery ? escapeSqlLike(itemQuery) : null;
  const itemQueryFilter = escapedItemQuery
    ? ` AND (
         label LIKE ? ESCAPE '\\'
         OR description LIKE ? ESCAPE '\\'
         OR tags_json LIKE ? ESCAPE '\\'
       )`
    : "";
  const itemQueryParameters = escapedItemQuery
    ? [
        `%${escapedItemQuery}%`,
        `%${escapedItemQuery}%`,
        `%${escapedItemQuery}%`
      ]
    : [];
  const itemRows = getDatabase()
    .prepare(
      `WITH ranked_items AS (
         SELECT id, catalog_id, label, description, tags_json,
                feature_weights_json, position, archived, created_at,
                updated_at,
                ROW_NUMBER() OVER (
                  PARTITION BY catalog_id
                  ORDER BY position ASC, label ASC, id ASC
                ) AS item_rank
         FROM preference_catalog_items
         WHERE catalog_id IN (${placeholders}) AND archived = 0${itemQueryFilter}
       )
       SELECT id, catalog_id, label, description, tags_json,
              feature_weights_json, position, archived, created_at, updated_at
       FROM ranked_items
       WHERE item_rank <= ?
       ORDER BY catalog_id ASC, position ASC, label ASC, id ASC`
    )
    .all(
      ...catalogIds,
      ...itemQueryParameters,
      PREFERENCE_CATALOG_ITEM_EMBED_LIMIT
    ) as CatalogItemRow[];

  const itemCounts = new Map(
    (
      getDatabase()
        .prepare(
          `SELECT catalog_id, COUNT(*) AS item_count
           FROM preference_catalog_items
           WHERE catalog_id IN (${placeholders}) AND archived = 0
           GROUP BY catalog_id`
        )
        .all(...catalogIds) as Array<{ catalog_id: string; item_count: number }>
    ).map((row) => [row.catalog_id, row.item_count])
  );
  const matchingItemCounts = escapedItemQuery
    ? new Map(
        (
          getDatabase()
            .prepare(
              `SELECT catalog_id, COUNT(*) AS item_count
               FROM preference_catalog_items
               WHERE catalog_id IN (${placeholders})
                 AND archived = 0${itemQueryFilter}
               GROUP BY catalog_id`
            )
            .all(...catalogIds, ...itemQueryParameters) as Array<{
            catalog_id: string;
            item_count: number;
          }>
        ).map((row) => [row.catalog_id, row.item_count])
      )
    : null;

  const itemsByCatalogId = new Map<string, PreferenceCatalogItem[]>();
  for (const row of itemRows) {
    const items = itemsByCatalogId.get(row.catalog_id) ?? [];
    items.push(mapCatalogItem(row));
    itemsByCatalogId.set(row.catalog_id, items);
  }

  const linksByCatalogId = new Map<
    string,
    ReturnType<typeof listEntityLinksForSources>
  >();
  for (const link of listEntityLinksForSources(
    "preference_catalog",
    catalogIds
  )) {
    const links = linksByCatalogId.get(link.sourceEntityId) ?? [];
    links.push(link);
    linksByCatalogId.set(link.sourceEntityId, links);
  }

  const usersById = new Map(
    listUsersByIds(
      Array.from(new Set(catalogRows.map((row) => row.user_id)))
    ).map((user) => [user.id, user])
  );

  return catalogRows.map((row) =>
    mapCatalog(
      row,
      itemsByCatalogId.get(row.id) ?? [],
      linksByCatalogId.get(row.id) ?? [],
      usersById.get(row.user_id) ?? null,
      itemCounts.get(row.id) ?? 0,
      matchingItemCounts ? (matchingItemCounts.get(row.id) ?? 0) : undefined
    )
  );
}

function mapJudgment(row: JudgmentRow): PairwiseJudgment {
  return pairwiseJudgmentSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    contextId: row.context_id,
    userId: row.user_id,
    leftItemId: row.left_item_id,
    rightItemId: row.right_item_id,
    outcome: row.outcome,
    strength: row.strength,
    responseTimeMs: row.response_time_ms,
    source: row.source,
    reasonTags: parseJsonArray<string>(row.reason_tags_json).filter(Boolean),
    createdAt: row.created_at
  });
}

function mapSignal(row: SignalRow): AbsoluteSignal {
  return absoluteSignalSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    contextId: row.context_id,
    userId: row.user_id,
    ownerUserId: row.user_id,
    itemId: row.item_id,
    signalType: row.signal_type,
    strength: row.strength,
    modelWeight:
      PREFERENCE_SIGNAL_MODEL_WEIGHTS[row.signal_type] * row.strength,
    source: row.source,
    actor: row.actor,
    createdAt: row.created_at
  });
}

function mapScore(
  row: ScoreRow,
  item: PreferenceItem,
  effectiveSignal: AbsoluteSignal | null = null
): PreferenceItemScore {
  return preferenceItemScoreSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    contextId: row.context_id,
    itemId: row.item_id,
    latentScore: row.latent_score,
    confidence: row.confidence,
    uncertainty: row.uncertainty,
    evidenceCount: row.evidence_count,
    pairwiseWins: row.pairwise_wins,
    pairwiseLosses: row.pairwise_losses,
    pairwiseTies: row.pairwise_ties,
    signalCount: row.signal_count,
    effectiveSignal,
    conflictCount: row.conflict_count,
    status: row.status,
    dominantDimensions: parseJsonArray<PreferenceDimensionId>(
      row.dominant_dimensions_json
    ),
    explanation: parseJsonArray<string>(row.explanation_json),
    manualStatus: row.manual_status,
    manualScore: row.manual_score,
    confidenceLock: row.confidence_lock,
    bookmarked: row.bookmarked === 1,
    compareLater: row.compare_later === 1,
    frozen: row.frozen === 1,
    lastInferredAt: row.last_inferred_at,
    lastJudgmentAt: row.last_judgment_at,
    updatedAt: row.updated_at,
    item
  });
}

function mapDimension(row: DimensionRow): PreferenceDimensionSummary {
  return preferenceDimensionSummarySchema.parse({
    id: row.id,
    profileId: row.profile_id,
    contextId: row.context_id,
    dimensionId: row.dimension_id,
    leaning: row.leaning,
    confidence: row.confidence,
    movement: row.movement,
    contextSensitivity: row.context_sensitivity,
    evidenceCount: row.evidence_count,
    updatedAt: row.updated_at
  });
}

function mapSnapshot(row: SnapshotRow): PreferenceSnapshot {
  return preferenceSnapshotSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    contextId: row.context_id,
    summaryMetrics: parseJsonObject(row.summary_metrics_json, {}),
    serializedModelState: parseJsonObject(row.serialized_model_state_json, {}),
    createdAt: row.created_at
  });
}

function readProfileByUserAndDomain(
  userId: string,
  domain: PreferenceDomain
): PreferenceProfile | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, user_id, domain, default_context_id, model_version, created_at, updated_at
       FROM preference_profiles
       WHERE user_id = ? AND domain = ?`
    )
    .get(userId, domain) as ProfileRow | undefined;
  return row ? mapProfile(row) : null;
}

export function getPreferenceProfileById(
  profileId: string
): PreferenceProfile | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, user_id, domain, default_context_id, model_version, created_at, updated_at
       FROM preference_profiles
       WHERE id = ?`
    )
    .get(profileId) as ProfileRow | undefined;
  return row ? mapProfile(row) : null;
}

function listContexts(profileId: string): PreferenceContext[] {
  return (
    getDatabase()
      .prepare(
        `SELECT id, profile_id, name, description, share_mode, active, is_default, decay_days, created_at, updated_at
         FROM preference_contexts
         WHERE profile_id = ?
         ORDER BY is_default DESC, active DESC, name ASC`
      )
      .all(profileId) as ContextRow[]
  ).map(mapContext);
}

function readContext(contextId: string): PreferenceContext | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, profile_id, name, description, share_mode, active, is_default, decay_days, created_at, updated_at
       FROM preference_contexts
       WHERE id = ?`
    )
    .get(contextId) as ContextRow | undefined;
  return row ? mapContext(row) : null;
}

function selectReplacementDefaultContext(
  profileId: string,
  excludedContextId?: string
): PreferenceContext | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, profile_id, name, description, share_mode, active, is_default,
              decay_days, created_at, updated_at
       FROM preference_contexts
       WHERE profile_id = ?
         AND (? IS NULL OR id <> ?)
       ORDER BY is_default DESC, active DESC, created_at ASC, id ASC
       LIMIT 1`
    )
    .get(
      profileId,
      excludedContextId ?? null,
      excludedContextId ?? null
    ) as ContextRow | undefined;
  return row ? mapContext(row) : null;
}

function setProfileDefaultContext(
  profileId: string,
  contextId: string,
  timestamp: string
) {
  const database = getDatabase();
  database
    .prepare(
      `UPDATE preference_contexts
       SET is_default = 0, updated_at = ?
       WHERE profile_id = ? AND is_default <> 0`
    )
    .run(timestamp, profileId);
  const result = database
    .prepare(
      `UPDATE preference_contexts
       SET is_default = 1, active = 1, updated_at = ?
       WHERE profile_id = ? AND id = ?`
    )
    .run(timestamp, profileId, contextId);
  if (result.changes !== 1) {
    throw new HttpError(
      500,
      "preferences_default_context_missing",
      `Preference context ${contextId} cannot be the default for profile ${profileId}.`
    );
  }
  database
    .prepare(
      `UPDATE preference_profiles
       SET default_context_id = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(contextId, timestamp, profileId);
}

function resolveContext(
  profile: PreferenceProfile,
  contextId?: string | null
): PreferenceContext {
  const contexts = listContexts(profile.id);
  const context =
    (contextId ? contexts.find((entry) => entry.id === contextId) : null) ??
    contexts.find((entry) => entry.isDefault) ??
    contexts[0];
  if (!context) {
    throw new HttpError(
      500,
      "preferences_missing_context",
      "Preference profile has no contexts"
    );
  }
  return context;
}

function listItems(profileId: string): PreferenceItem[] {
  return (
    getDatabase()
      .prepare(
        `SELECT id, profile_id, label, description, tags_json, feature_weights_json, source_entity_type, source_entity_id, metadata_json, created_at, updated_at
         FROM preference_items
         WHERE profile_id = ?
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(profileId) as ItemRow[]
  ).map(mapItem);
}

function getItemById(itemId: string): PreferenceItem | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, profile_id, label, description, tags_json, feature_weights_json, source_entity_type, source_entity_id, metadata_json, created_at, updated_at
       FROM preference_items
       WHERE id = ?`
    )
    .get(itemId) as ItemRow | undefined;
  return row ? mapItem(row) : null;
}

function listCatalogs(profileId: string): PreferenceCatalog[] {
  const catalogRows = (
    getDatabase()
      .prepare(
        `SELECT preference_catalogs.id, preference_catalogs.profile_id,
                preference_profiles.user_id, preference_catalogs.domain,
                preference_catalogs.slug, preference_catalogs.title,
                preference_catalogs.description, preference_catalogs.scope_in,
                preference_catalogs.scope_out, preference_catalogs.source,
                preference_catalogs.created_source,
                preference_catalogs.created_by_actor,
                preference_catalogs.archived, preference_catalogs.created_at,
                preference_catalogs.updated_at
         FROM preference_catalogs
         INNER JOIN preference_profiles
           ON preference_profiles.id = preference_catalogs.profile_id
         WHERE preference_catalogs.profile_id = ?
           AND preference_catalogs.archived = 0
         ORDER BY source ASC, title ASC, preference_catalogs.id ASC
         LIMIT ?`
      )
      .all(profileId, PREFERENCE_WORKSPACE_CATALOG_LIMIT) as CatalogRow[]
  ).filter((row) => row.archived === 0);

  return mapCatalogRows(catalogRows);
}

function getCatalogLibraryCounts(profileId: string) {
  const catalogCounts = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS total_catalogs,
              SUM(CASE WHEN source = 'seeded' THEN 1 ELSE 0 END) AS seeded_catalogs,
              SUM(CASE WHEN source = 'custom' THEN 1 ELSE 0 END) AS custom_catalogs
       FROM preference_catalogs
       WHERE profile_id = ? AND archived = 0`
    )
    .get(profileId) as {
    total_catalogs: number;
    seeded_catalogs: number | null;
    custom_catalogs: number | null;
  };
  const itemCount = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS total_items
       FROM preference_catalog_items
       INNER JOIN preference_catalogs
         ON preference_catalogs.id = preference_catalog_items.catalog_id
       WHERE preference_catalogs.profile_id = ?
         AND preference_catalogs.archived = 0
         AND preference_catalog_items.archived = 0`
    )
    .get(profileId) as { total_items: number };
  return {
    totalCatalogs: catalogCounts.total_catalogs,
    totalCatalogItems: itemCount.total_items,
    seededCatalogCount: catalogCounts.seeded_catalogs ?? 0,
    customCatalogCount: catalogCounts.custom_catalogs ?? 0
  };
}

function readCatalog(
  catalogId: string,
  options: { includeArchived?: boolean; itemLimit?: number | null } = {}
): PreferenceCatalog | null {
  const row = getDatabase()
    .prepare(
      `SELECT preference_catalogs.id, preference_catalogs.profile_id,
              preference_profiles.user_id, preference_catalogs.domain,
              preference_catalogs.slug, preference_catalogs.title,
              preference_catalogs.description, preference_catalogs.scope_in,
              preference_catalogs.scope_out, preference_catalogs.source,
              preference_catalogs.created_source,
              preference_catalogs.created_by_actor,
              preference_catalogs.archived, preference_catalogs.created_at,
              preference_catalogs.updated_at
       FROM preference_catalogs
       INNER JOIN preference_profiles
         ON preference_profiles.id = preference_catalogs.profile_id
       WHERE preference_catalogs.id = ?`
    )
    .get(catalogId) as CatalogRow | undefined;
  if (!row || (row.archived === 1 && !options.includeArchived)) {
    return null;
  }
  const itemLimit =
    options.itemLimit === undefined
      ? PREFERENCE_CATALOG_ITEM_EMBED_LIMIT
      : options.itemLimit;
  const archivedFilter = options.includeArchived ? "" : " AND archived = 0";
  const itemStatement = getDatabase().prepare(
    `SELECT id, catalog_id, label, description, tags_json, feature_weights_json, position, archived, created_at, updated_at
     FROM preference_catalog_items
     WHERE catalog_id = ?${archivedFilter}
     ORDER BY position ASC, label ASC, id ASC${itemLimit === null ? "" : " LIMIT ?"}`
  );
  const itemRows = (
    itemLimit === null
      ? itemStatement.all(catalogId)
      : itemStatement.all(catalogId, Math.max(1, itemLimit))
  ) as CatalogItemRow[];
  const items = itemRows.map(mapCatalogItem);
  const countRow = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS item_count
       FROM preference_catalog_items
       WHERE catalog_id = ?${archivedFilter}`
    )
    .get(catalogId) as { item_count: number };
  return mapCatalog(row, items, undefined, undefined, countRow.item_count);
}

function readCatalogItem(
  catalogItemId: string,
  includeArchived = false
): PreferenceCatalogItem | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, catalog_id, label, description, tags_json, feature_weights_json, position, archived, created_at, updated_at
       FROM preference_catalog_items
       WHERE id = ?`
    )
    .get(catalogItemId) as CatalogItemRow | undefined;
  return row && (includeArchived || row.archived === 0)
    ? mapCatalogItem(row)
    : null;
}

type PreferenceEvidenceCoverage =
  PreferenceWorkspacePayload["evidenceCoverage"];

function listJudgmentsForContexts(contextIds: string[]): {
  judgments: PairwiseJudgment[];
  coverage: PreferenceEvidenceCoverage;
} {
  if (contextIds.length === 0) {
    return {
      judgments: [],
      coverage: {
        judgmentLimitPerContext: PREFERENCE_MODEL_JUDGMENT_LIMIT_PER_CONTEXT,
        totalJudgments: 0,
        consideredJudgments: 0,
        truncated: false,
        contexts: []
      }
    };
  }
  const placeholders = contextIds.map(() => "?").join(", ");
  const rows = getDatabase()
    .prepare(
      `WITH ranked_judgments AS (
         SELECT pairwise_judgments.*,
                ROW_NUMBER() OVER (
                  PARTITION BY context_id
                  ORDER BY created_at DESC, rowid DESC
                ) AS context_rank,
                COUNT(*) OVER (PARTITION BY context_id) AS context_total
         FROM pairwise_judgments
         WHERE context_id IN (${placeholders})
       )
       SELECT id, profile_id, context_id, user_id, left_item_id, right_item_id,
              outcome, strength, response_time_ms, source, reason_tags_json,
              created_at, context_total
       FROM ranked_judgments
       WHERE context_rank <= ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(...contextIds, PREFERENCE_MODEL_JUDGMENT_LIMIT_PER_CONTEXT) as Array<
    JudgmentRow & { context_total: number }
  >;
  const totalByContext = new Map(
    rows.map((row) => [row.context_id, row.context_total] as const)
  );
  if (rows.length < contextIds.length) {
    const missingContextIds = contextIds.filter(
      (contextId) => !totalByContext.has(contextId)
    );
    for (const contextId of missingContextIds) {
      totalByContext.set(contextId, 0);
    }
  }
  const contexts = contextIds.map((contextId) => {
    const totalJudgments = totalByContext.get(contextId) ?? 0;
    const consideredJudgments = Math.min(
      totalJudgments,
      PREFERENCE_MODEL_JUDGMENT_LIMIT_PER_CONTEXT
    );
    return {
      contextId,
      totalJudgments,
      consideredJudgments,
      truncated: totalJudgments > consideredJudgments
    };
  });
  const totalJudgments = contexts.reduce(
    (sum, context) => sum + context.totalJudgments,
    0
  );
  const consideredJudgments = contexts.reduce(
    (sum, context) => sum + context.consideredJudgments,
    0
  );
  return {
    judgments: rows.map(mapJudgment),
    coverage: {
      judgmentLimitPerContext: PREFERENCE_MODEL_JUDGMENT_LIMIT_PER_CONTEXT,
      totalJudgments,
      consideredJudgments,
      truncated: totalJudgments > consideredJudgments,
      contexts
    }
  };
}

function listEffectiveSignalsForContexts(
  contextIds: string[]
): AbsoluteSignal[] {
  if (contextIds.length === 0) {
    return [];
  }
  const placeholders = contextIds.map(() => "?").join(", ");
  return (
    getDatabase()
      .prepare(
        `WITH ranked_signals AS (
           SELECT
             absolute_signals.*,
             absolute_signals.rowid AS signal_rowid,
             ROW_NUMBER() OVER (
               PARTITION BY absolute_signals.context_id, absolute_signals.item_id
               ORDER BY absolute_signals.created_at DESC, absolute_signals.rowid DESC
             ) AS signal_rank
           FROM absolute_signals
           WHERE absolute_signals.context_id IN (${placeholders})
         )
         SELECT
           ranked_signals.id,
           ranked_signals.profile_id,
           ranked_signals.context_id,
           ranked_signals.user_id,
           ranked_signals.item_id,
           ranked_signals.signal_type,
           ranked_signals.strength,
           ranked_signals.source,
           ranked_signals.created_at,
           (
             SELECT activity_events.actor
             FROM activity_events
             WHERE activity_events.entity_type = 'preference_item'
               AND activity_events.entity_id = ranked_signals.item_id
               AND json_extract(activity_events.metadata_json, '$.signalId') = ranked_signals.id
             ORDER BY activity_events.created_at DESC
             LIMIT 1
           ) AS actor
         FROM ranked_signals
         WHERE ranked_signals.signal_rank = 1
         ORDER BY ranked_signals.created_at DESC, ranked_signals.signal_rowid DESC`
      )
      .all(...contextIds) as SignalRow[]
  ).map(mapSignal);
}

function listEffectiveSignalsForItems(
  contextId: string,
  itemIds: string[]
): AbsoluteSignal[] {
  if (itemIds.length === 0) {
    return [];
  }
  const distinctItemIds = [...new Set(itemIds)];
  const placeholders = distinctItemIds.map(() => "?").join(", ");
  return (
    getDatabase()
      .prepare(
        `WITH ranked_signals AS (
           SELECT
             absolute_signals.*,
             absolute_signals.rowid AS signal_rowid,
             ROW_NUMBER() OVER (
               PARTITION BY absolute_signals.context_id, absolute_signals.item_id
               ORDER BY absolute_signals.created_at DESC, absolute_signals.rowid DESC
             ) AS signal_rank
           FROM absolute_signals
           WHERE absolute_signals.context_id = ?
             AND absolute_signals.item_id IN (${placeholders})
         )
         SELECT
           ranked_signals.id,
           ranked_signals.profile_id,
           ranked_signals.context_id,
           ranked_signals.user_id,
           ranked_signals.item_id,
           ranked_signals.signal_type,
           ranked_signals.strength,
           ranked_signals.source,
           ranked_signals.created_at,
           (
             SELECT activity_events.actor
             FROM activity_events
             WHERE activity_events.entity_type = 'preference_item'
               AND activity_events.entity_id = ranked_signals.item_id
               AND json_extract(activity_events.metadata_json, '$.signalId') = ranked_signals.id
             ORDER BY activity_events.created_at DESC
             LIMIT 1
           ) AS actor
         FROM ranked_signals
         WHERE ranked_signals.signal_rank = 1
         ORDER BY ranked_signals.created_at DESC, ranked_signals.signal_rowid DESC`
      )
      .all(contextId, ...distinctItemIds) as SignalRow[]
  ).map(mapSignal);
}

function listSignalHistory(
  contextId: string,
  limit = PREFERENCE_WORKSPACE_HISTORY_LIMIT
): AbsoluteSignal[] {
  return (
    getDatabase()
      .prepare(
        `SELECT
           absolute_signals.id,
           absolute_signals.profile_id,
           absolute_signals.context_id,
           absolute_signals.user_id,
           absolute_signals.item_id,
           absolute_signals.signal_type,
           absolute_signals.strength,
           absolute_signals.source,
           absolute_signals.created_at,
           (
             SELECT activity_events.actor
             FROM activity_events
             WHERE activity_events.entity_type = 'preference_item'
               AND activity_events.entity_id = absolute_signals.item_id
               AND json_extract(activity_events.metadata_json, '$.signalId') = absolute_signals.id
             ORDER BY activity_events.created_at DESC
             LIMIT 1
           ) AS actor
         FROM absolute_signals
         WHERE absolute_signals.context_id = ?
         ORDER BY absolute_signals.created_at DESC, absolute_signals.rowid DESC
         LIMIT ?`
      )
      .all(contextId, Math.max(1, limit)) as SignalRow[]
  ).map(mapSignal);
}

function getEffectiveSignals(signals: AbsoluteSignal[]) {
  const currentByContextAndItem = new Map<string, AbsoluteSignal>();
  for (const signal of signals) {
    const key = `${signal.contextId}\u0000${signal.itemId}`;
    if (!currentByContextAndItem.has(key)) {
      currentByContextAndItem.set(key, signal);
    }
  }
  return [...currentByContextAndItem.values()];
}

function listStoredScores(contextId: string): ScoreRow[] {
  return getDatabase()
    .prepare(
      `SELECT id, profile_id, context_id, item_id, latent_score, confidence, uncertainty, evidence_count, pairwise_wins, pairwise_losses, pairwise_ties, signal_count, conflict_count, status, dominant_dimensions_json, explanation_json, manual_status, manual_score, confidence_lock, bookmarked, compare_later, frozen, last_inferred_at, last_judgment_at, updated_at
       FROM preference_item_scores
       WHERE context_id = ?`
    )
    .all(contextId) as ScoreRow[];
}

export function getPreferenceItemScoreForContext(
  itemId: string,
  contextId: string
): PreferenceItemScore | undefined {
  const item = getItemById(itemId);
  if (!item) {
    return undefined;
  }
  const row = getDatabase()
    .prepare(
      `SELECT id, profile_id, context_id, item_id, latent_score, confidence,
              uncertainty, evidence_count, pairwise_wins, pairwise_losses,
              pairwise_ties, signal_count, conflict_count, status,
              dominant_dimensions_json, explanation_json, manual_status,
              manual_score, confidence_lock, bookmarked, compare_later,
              frozen, last_inferred_at, last_judgment_at, updated_at
       FROM preference_item_scores
       WHERE context_id = ? AND item_id = ?`
    )
    .get(contextId, itemId) as ScoreRow | undefined;
  if (!row) {
    return undefined;
  }
  return mapScore(
    row,
    item,
    listEffectiveSignalsForItems(contextId, [itemId])[0] ?? null
  );
}

export function listPreferenceContexts(
  options: {
    userIds?: string[];
    ids?: string[];
    query?: string;
    limit?: number;
  } = {}
): PreferenceContext[] {
  const userIds = normalizePreferenceSearchValues(options.userIds, "userIds");
  const ids = normalizePreferenceSearchValues(options.ids, "ids");
  const where: string[] = [];
  const parameters: Array<string | number> = [];
  if (userIds.length > 0) {
    where.push(
      `preference_profiles.user_id IN (${userIds.map(() => "?").join(", ")})`
    );
    parameters.push(...userIds);
  }
  if (ids.length > 0) {
    where.push(`preference_contexts.id IN (${ids.map(() => "?").join(", ")})`);
    parameters.push(...ids);
  }
  const query = normalizePreferenceSearchQuery(options.query);
  if (query) {
    const escaped = escapeSqlLike(query);
    where.push(
      "(preference_contexts.name LIKE ? ESCAPE '\\' OR preference_contexts.description LIKE ? ESCAPE '\\')"
    );
    parameters.push(`%${escaped}%`, `%${escaped}%`);
  }
  const limit = Math.min(
    Math.max(options.limit ?? 200, 1),
    PREFERENCE_SEARCH_RESULT_LIMIT
  );
  return (
    getDatabase()
      .prepare(
        `SELECT preference_contexts.id, preference_contexts.profile_id,
                preference_contexts.name, preference_contexts.description,
                preference_contexts.share_mode, preference_contexts.active,
                preference_contexts.is_default, preference_contexts.decay_days,
                preference_contexts.created_at, preference_contexts.updated_at
         FROM preference_contexts
         INNER JOIN preference_profiles
           ON preference_profiles.id = preference_contexts.profile_id
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY preference_contexts.updated_at DESC, preference_contexts.id ASC
         LIMIT ?`
      )
      .all(...parameters, limit) as ContextRow[]
  ).map(mapContext);
}

export function getPreferenceContextById(
  contextId: string
): PreferenceContext | undefined {
  return readContext(contextId) ?? undefined;
}

export function listPreferenceItems(
  options: {
    userIds?: string[];
    ids?: string[];
    query?: string;
    limit?: number;
  } = {}
): PreferenceItem[] {
  const userIds = normalizePreferenceSearchValues(options.userIds, "userIds");
  const ids = normalizePreferenceSearchValues(options.ids, "ids");
  const where: string[] = [];
  const parameters: Array<string | number> = [];
  if (userIds.length > 0) {
    where.push(
      `preference_profiles.user_id IN (${userIds.map(() => "?").join(", ")})`
    );
    parameters.push(...userIds);
  }
  if (ids.length > 0) {
    where.push(`preference_items.id IN (${ids.map(() => "?").join(", ")})`);
    parameters.push(...ids);
  }
  const query = normalizePreferenceSearchQuery(options.query);
  if (query) {
    const escaped = escapeSqlLike(query);
    where.push(
      "(preference_items.label LIKE ? ESCAPE '\\' OR preference_items.description LIKE ? ESCAPE '\\' OR preference_items.tags_json LIKE ? ESCAPE '\\')"
    );
    parameters.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
  }
  const limit = Math.min(
    Math.max(options.limit ?? 200, 1),
    PREFERENCE_SEARCH_RESULT_LIMIT
  );
  return (
    getDatabase()
      .prepare(
        `SELECT preference_items.id, preference_items.profile_id,
                preference_items.label, preference_items.description,
                preference_items.tags_json, preference_items.feature_weights_json,
                preference_items.source_entity_type, preference_items.source_entity_id,
                preference_items.metadata_json, preference_items.created_at,
                preference_items.updated_at
         FROM preference_items
         INNER JOIN preference_profiles
           ON preference_profiles.id = preference_items.profile_id
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY preference_items.updated_at DESC, preference_items.id ASC
         LIMIT ?`
      )
      .all(...parameters, limit) as ItemRow[]
  ).map(mapItem);
}

export function getPreferenceItemById(
  itemId: string
): PreferenceItem | undefined {
  return getItemById(itemId) ?? undefined;
}

export function listPreferenceCatalogs(
  options: {
    userIds?: string[];
    ids?: string[];
    domain?: PreferenceDomain;
    query?: string;
    linkedTo?: { entityType: string; id: string };
    limit?: number;
    offset?: number;
    pageSnapshot?: {
      snapshotAt: string;
      snapshotRowId: number;
      after?: { updatedAt: string; id: string };
    };
  } = {}
): PreferenceCatalog[] {
  const userIds = normalizePreferenceSearchValues(options.userIds, "userIds");
  const ids = normalizePreferenceSearchValues(options.ids, "ids");
  const where = ["preference_catalogs.archived = 0"];
  const parameters: Array<string | number> = [];
  if (userIds.length > 0) {
    where.push(
      `preference_profiles.user_id IN (${userIds.map(() => "?").join(", ")})`
    );
    parameters.push(...userIds);
  }
  if (ids.length > 0) {
    where.push(`preference_catalogs.id IN (${ids.map(() => "?").join(", ")})`);
    parameters.push(...ids);
  }
  if (options.domain) {
    where.push("preference_catalogs.domain = ?");
    parameters.push(options.domain);
  }
  const query = normalizePreferenceSearchQuery(options.query);
  if (query) {
    const escaped = escapeSqlLike(query);
    where.push(
      `(preference_catalogs.title LIKE ? ESCAPE '\\'
        OR preference_catalogs.description LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1
          FROM preference_catalog_items
          WHERE preference_catalog_items.catalog_id = preference_catalogs.id
            AND preference_catalog_items.archived = 0
            AND (
              preference_catalog_items.label LIKE ? ESCAPE '\\'
              OR preference_catalog_items.description LIKE ? ESCAPE '\\'
              OR preference_catalog_items.tags_json LIKE ? ESCAPE '\\'
            )
        ))`
    );
    parameters.push(
      `%${escaped}%`,
      `%${escaped}%`,
      `%${escaped}%`,
      `%${escaped}%`,
      `%${escaped}%`
    );
  }
  if (options.linkedTo) {
    where.push(
      `EXISTS (
         SELECT 1
         FROM entity_links
         WHERE (
           source_entity_type = 'preference_catalog'
           AND source_entity_id = preference_catalogs.id
           AND target_entity_type = ?
           AND target_entity_id = ?
         ) OR (
           target_entity_type = 'preference_catalog'
           AND target_entity_id = preference_catalogs.id
           AND source_entity_type = ?
           AND source_entity_id = ?
         )
       )`
    );
    parameters.push(
      options.linkedTo.entityType,
      options.linkedTo.id,
      options.linkedTo.entityType,
      options.linkedTo.id
    );
  }
  if (options.pageSnapshot) {
    where.push("preference_catalogs.rowid <= ?");
    parameters.push(options.pageSnapshot.snapshotRowId);
    where.push("preference_catalogs.updated_at <= ?");
    parameters.push(options.pageSnapshot.snapshotAt);
    if (options.pageSnapshot.after) {
      where.push(
        `(preference_catalogs.updated_at < ?
          OR (
            preference_catalogs.updated_at = ?
            AND preference_catalogs.id > ?
          ))`
      );
      parameters.push(
        options.pageSnapshot.after.updatedAt,
        options.pageSnapshot.after.updatedAt,
        options.pageSnapshot.after.id
      );
    }
  }
  const limit = Math.min(
    Math.max(options.limit ?? 24, 1),
    PREFERENCE_SEARCH_RESULT_LIMIT
  );
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = getDatabase()
    .prepare(
      `SELECT preference_catalogs.id, preference_catalogs.profile_id,
              preference_profiles.user_id, preference_catalogs.domain,
              preference_catalogs.slug, preference_catalogs.title,
              preference_catalogs.description, preference_catalogs.scope_in,
              preference_catalogs.scope_out, preference_catalogs.source,
              preference_catalogs.created_source,
              preference_catalogs.created_by_actor,
              preference_catalogs.archived, preference_catalogs.created_at,
              preference_catalogs.updated_at
       FROM preference_catalogs
       INNER JOIN preference_profiles
         ON preference_profiles.id = preference_catalogs.profile_id
       WHERE ${where.join(" AND ")}
       ORDER BY preference_catalogs.updated_at DESC, preference_catalogs.id ASC
       LIMIT ? OFFSET ?`
    )
    .all(...parameters, limit, offset) as CatalogRow[];
  return mapCatalogRows(rows, { itemQuery: query });
}

export function getPreferenceCatalogById(
  catalogId: string,
  includeArchived = false
): PreferenceCatalog | undefined {
  return readCatalog(catalogId, { includeArchived }) ?? undefined;
}

export function listPreferenceCatalogItems(
  options: {
    userIds?: string[];
    ids?: string[];
    catalogIds?: string[];
    query?: string;
    limit?: number;
    offset?: number;
    pageSnapshot?: {
      snapshotAt: string;
      snapshotRowId: number;
      after?: { catalogId: string; position: number; id: string };
    };
  } = {}
): PreferenceCatalogItem[] {
  const userIds = normalizePreferenceSearchValues(options.userIds, "userIds");
  const ids = normalizePreferenceSearchValues(options.ids, "ids");
  const catalogIds = normalizePreferenceSearchValues(
    options.catalogIds,
    "catalogIds"
  );
  const where = [
    "preference_catalog_items.archived = 0",
    "preference_catalogs.archived = 0"
  ];
  const parameters: Array<string | number> = [];
  if (userIds.length > 0) {
    where.push(
      `preference_profiles.user_id IN (${userIds.map(() => "?").join(", ")})`
    );
    parameters.push(...userIds);
  }
  if (ids.length > 0) {
    where.push(
      `preference_catalog_items.id IN (${ids.map(() => "?").join(", ")})`
    );
    parameters.push(...ids);
  }
  if (catalogIds.length > 0) {
    where.push(
      `preference_catalog_items.catalog_id IN (${catalogIds.map(() => "?").join(", ")})`
    );
    parameters.push(...catalogIds);
  }
  const query = normalizePreferenceSearchQuery(options.query);
  if (query) {
    const escaped = escapeSqlLike(query);
    where.push(
      "(preference_catalog_items.label LIKE ? ESCAPE '\\' OR preference_catalog_items.description LIKE ? ESCAPE '\\' OR preference_catalog_items.tags_json LIKE ? ESCAPE '\\')"
    );
    parameters.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
  }
  if (options.pageSnapshot) {
    where.push("preference_catalog_items.rowid <= ?");
    parameters.push(options.pageSnapshot.snapshotRowId);
    where.push("preference_catalog_items.updated_at <= ?");
    parameters.push(options.pageSnapshot.snapshotAt);
    if (options.pageSnapshot.after) {
      where.push(
        `(preference_catalog_items.catalog_id > ?
          OR (
            preference_catalog_items.catalog_id = ?
            AND preference_catalog_items.position > ?
          )
          OR (
            preference_catalog_items.catalog_id = ?
            AND preference_catalog_items.position = ?
            AND preference_catalog_items.id > ?
          ))`
      );
      parameters.push(
        options.pageSnapshot.after.catalogId,
        options.pageSnapshot.after.catalogId,
        options.pageSnapshot.after.position,
        options.pageSnapshot.after.catalogId,
        options.pageSnapshot.after.position,
        options.pageSnapshot.after.id
      );
    }
  }
  const limit = Math.min(
    Math.max(options.limit ?? 24, 1),
    PREFERENCE_SEARCH_RESULT_LIMIT
  );
  const offset = Math.max(options.offset ?? 0, 0);
  return (
    getDatabase()
      .prepare(
        `SELECT preference_catalog_items.id,
                preference_catalog_items.catalog_id,
                preference_catalog_items.label,
                preference_catalog_items.description,
                preference_catalog_items.tags_json,
                preference_catalog_items.feature_weights_json,
                preference_catalog_items.position,
                preference_catalog_items.archived,
                preference_catalog_items.created_at,
                preference_catalog_items.updated_at
         FROM preference_catalog_items
         INNER JOIN preference_catalogs
           ON preference_catalogs.id = preference_catalog_items.catalog_id
         INNER JOIN preference_profiles
           ON preference_profiles.id = preference_catalogs.profile_id
         WHERE ${where.join(" AND ")}
         ORDER BY preference_catalog_items.catalog_id ASC,
                  preference_catalog_items.position ASC,
                  preference_catalog_items.id ASC
         LIMIT ? OFFSET ?`
      )
      .all(...parameters, limit, offset) as CatalogItemRow[]
  ).map(mapCatalogItem);
}

function invalidPreferenceCursor(): never {
  throw new HttpError(
    400,
    "preferences_invalid_cursor",
    "The Preferences page cursor is invalid or does not match this query."
  );
}

function encodePreferenceCursor(
  cursor: PreferenceCatalogCursor | PreferenceCatalogItemCursor
) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodePreferenceCursor(
  encoded: string,
  kind: PreferenceCatalogCursor["kind"]
): PreferenceCatalogCursor;
function decodePreferenceCursor(
  encoded: string,
  kind: PreferenceCatalogItemCursor["kind"]
): PreferenceCatalogItemCursor;
function decodePreferenceCursor(
  encoded: string,
  kind: PreferenceCatalogCursor["kind"] | PreferenceCatalogItemCursor["kind"]
): PreferenceCatalogCursor | PreferenceCatalogItemCursor {
  try {
    const cursor = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as Partial<PreferenceCatalogCursor | PreferenceCatalogItemCursor>;
    if (
      cursor.version !== 1 ||
      cursor.kind !== kind ||
      typeof cursor.scope !== "string" ||
      typeof cursor.snapshotAt !== "string" ||
      !Number.isFinite(Date.parse(cursor.snapshotAt)) ||
      !Number.isInteger(cursor.snapshotRowId) ||
      (cursor.snapshotRowId ?? -1) < 0 ||
      !Number.isInteger(cursor.seen) ||
      (cursor.seen ?? -1) < 0 ||
      !cursor.after ||
      typeof cursor.after !== "object"
    ) {
      return invalidPreferenceCursor();
    }
    if (kind === "catalog") {
      const after = cursor.after as Partial<PreferenceCatalogCursor["after"]>;
      if (
        typeof after.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(after.updatedAt)) ||
        typeof after.id !== "string" ||
        after.id.length === 0
      ) {
        return invalidPreferenceCursor();
      }
    } else {
      const after = cursor.after as Partial<
        PreferenceCatalogItemCursor["after"]
      >;
      if (
        typeof after.catalogId !== "string" ||
        after.catalogId.length === 0 ||
        !Number.isInteger(after.position) ||
        typeof after.id !== "string" ||
        after.id.length === 0
      ) {
        return invalidPreferenceCursor();
      }
    }
    return cursor as PreferenceCatalogCursor | PreferenceCatalogItemCursor;
  } catch {
    return invalidPreferenceCursor();
  }
}

function preferenceCursorScope(input: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(input)).digest("base64url");
}

function maxPreferenceRowId(
  table: "preference_catalogs" | "preference_catalog_items"
) {
  const row = getDatabase()
    .prepare(`SELECT COALESCE(MAX(rowid), 0) AS max_row_id FROM ${table}`)
    .get() as { max_row_id: number };
  return row.max_row_id;
}

export function listPreferenceCatalogPage(
  options: {
    userIds?: string[];
    ids?: string[];
    domain?: PreferenceDomain;
    query?: string;
    linkedTo?: { entityType: string; id: string };
    limit?: number;
    offset?: number;
    cursor?: string;
  } = {}
): PreferenceCatalogPage {
  const userIds = normalizePreferenceSearchValues(options.userIds, "userIds");
  const ids = normalizePreferenceSearchValues(options.ids, "ids");
  const query = normalizePreferenceSearchQuery(options.query);
  const limit = Math.min(
    Math.max(options.limit ?? 24, 1),
    PREFERENCE_SEARCH_RESULT_LIMIT
  );
  const scope = preferenceCursorScope({
    kind: "catalog",
    userIds: [...userIds].sort(),
    ids: [...ids].sort(),
    domain: options.domain ?? null,
    query: query ?? null,
    linkedTo: options.linkedTo ?? null
  });
  const cursor = options.cursor
    ? decodePreferenceCursor(options.cursor, "catalog")
    : null;
  if (cursor && cursor.scope !== scope) {
    return invalidPreferenceCursor();
  }
  const snapshotAt = cursor?.snapshotAt ?? nowIso();
  const snapshotRowId =
    cursor?.snapshotRowId ?? maxPreferenceRowId("preference_catalogs");
  const offset = cursor?.seen ?? Math.max(options.offset ?? 0, 0);
  const rows = listPreferenceCatalogs({
    ...options,
    userIds,
    ids,
    query,
    limit: limit + 1,
    offset: cursor ? 0 : offset,
    pageSnapshot: {
      snapshotAt,
      snapshotRowId,
      after: cursor?.after
    }
  });
  const hasMore = rows.length > limit;
  const catalogs = rows.slice(0, limit);
  const nextOffset = hasMore ? offset + catalogs.length : null;
  const last = catalogs.at(-1);
  return {
    catalogs,
    limit,
    offset,
    hasMore,
    nextOffset,
    previousOffset: offset > 0 ? Math.max(0, offset - limit) : null,
    snapshotAt,
    nextCursor:
      hasMore && last
        ? encodePreferenceCursor({
            version: 1,
            kind: "catalog",
            scope,
            snapshotAt,
            snapshotRowId,
            seen: offset + catalogs.length,
            after: { updatedAt: last.updatedAt, id: last.id }
          })
        : null
  };
}

export function listPreferenceCatalogItemPage(
  options: {
    userIds?: string[];
    ids?: string[];
    catalogIds?: string[];
    query?: string;
    limit?: number;
    offset?: number;
    cursor?: string;
  } = {}
): PreferenceCatalogItemPage {
  const userIds = normalizePreferenceSearchValues(options.userIds, "userIds");
  const ids = normalizePreferenceSearchValues(options.ids, "ids");
  const catalogIds = normalizePreferenceSearchValues(
    options.catalogIds,
    "catalogIds"
  );
  const query = normalizePreferenceSearchQuery(options.query);
  const limit = Math.min(
    Math.max(options.limit ?? 24, 1),
    PREFERENCE_SEARCH_RESULT_LIMIT
  );
  const scope = preferenceCursorScope({
    kind: "catalog-item",
    userIds: [...userIds].sort(),
    ids: [...ids].sort(),
    catalogIds: [...catalogIds].sort(),
    query: query ?? null
  });
  const cursor = options.cursor
    ? decodePreferenceCursor(options.cursor, "catalog-item")
    : null;
  if (cursor && cursor.scope !== scope) {
    return invalidPreferenceCursor();
  }
  const snapshotAt = cursor?.snapshotAt ?? nowIso();
  const snapshotRowId =
    cursor?.snapshotRowId ?? maxPreferenceRowId("preference_catalog_items");
  const offset = cursor?.seen ?? Math.max(options.offset ?? 0, 0);
  const rows = listPreferenceCatalogItems({
    ...options,
    userIds,
    ids,
    catalogIds,
    query,
    limit: limit + 1,
    offset: cursor ? 0 : offset,
    pageSnapshot: {
      snapshotAt,
      snapshotRowId,
      after: cursor?.after
    }
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const nextOffset = hasMore ? offset + items.length : null;
  const last = items.at(-1);
  return {
    items,
    limit,
    offset,
    hasMore,
    nextOffset,
    previousOffset: offset > 0 ? Math.max(0, offset - limit) : null,
    snapshotAt,
    nextCursor:
      hasMore && last
        ? encodePreferenceCursor({
            version: 1,
            kind: "catalog-item",
            scope,
            snapshotAt,
            snapshotRowId,
            seen: offset + items.length,
            after: {
              catalogId: last.catalogId,
              position: last.position,
              id: last.id
            }
          })
        : null
  };
}

export function getPreferenceCatalogItemById(
  catalogItemId: string,
  includeArchived = false
): PreferenceCatalogItem | undefined {
  return readCatalogItem(catalogItemId, includeArchived) ?? undefined;
}

function listStoredDimensions(contextId: string): PreferenceDimensionSummary[] {
  return (
    getDatabase()
      .prepare(
        `SELECT id, profile_id, context_id, dimension_id, leaning, confidence, movement, context_sensitivity, evidence_count, updated_at
         FROM preference_dimension_summaries
         WHERE context_id = ?
         ORDER BY dimension_id ASC`
      )
      .all(contextId) as DimensionRow[]
  ).map(mapDimension);
}

function listSnapshots(contextId: string, limit = 24): PreferenceSnapshot[] {
  return (
    getDatabase()
      .prepare(
        `SELECT id, profile_id, context_id, summary_metrics_json, serialized_model_state_json, created_at
         FROM preference_snapshots
         WHERE context_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(contextId, limit) as SnapshotRow[]
  ).map(mapSnapshot);
}

function ensureUserExists(userId: string) {
  const user = getUserById(userId);
  if (!user) {
    throw new HttpError(404, "user_not_found", `User ${userId} was not found.`);
  }
  return user;
}

function resolveSourceEntity(
  entityType: CrudEntityType,
  entityId: string
): { label: string; description: string } | null {
  switch (entityType) {
    case "goal": {
      const goal = getGoalById(entityId);
      return goal ? { label: goal.title, description: goal.description } : null;
    }
    case "project": {
      const project = getProjectById(entityId);
      return project
        ? { label: project.title, description: project.description }
        : null;
    }
    case "task": {
      const task = getTaskById(entityId);
      return task ? { label: task.title, description: task.description } : null;
    }
    case "strategy": {
      const strategy = getStrategyById(entityId);
      return strategy
        ? { label: strategy.title, description: strategy.overview }
        : null;
    }
    case "habit": {
      const habit = getHabitById(entityId);
      return habit
        ? { label: habit.title, description: habit.description }
        : null;
    }
    case "note": {
      const note = getNoteById(entityId);
      return note
        ? {
            label: note.contentPlain.slice(0, 72) || "Linked note",
            description: note.contentPlain
          }
        : null;
    }
    case "insight": {
      const insight = getInsightById(entityId);
      return insight
        ? { label: insight.title, description: insight.summary }
        : null;
    }
    case "calendar_event": {
      const event = getCalendarEventById(entityId);
      return event
        ? { label: event.title, description: event.description }
        : null;
    }
    case "work_block_template": {
      const template = getWorkBlockTemplateById(entityId);
      return template
        ? { label: template.title, description: template.kind }
        : null;
    }
    case "task_timebox": {
      const timebox = getTaskTimeboxById(entityId);
      return timebox
        ? { label: timebox.title, description: timebox.overrideReason ?? "" }
        : null;
    }
    case "psyche_value": {
      const value = getPsycheValueById(entityId);
      return value
        ? { label: value.title, description: value.description }
        : null;
    }
    case "behavior_pattern": {
      const pattern = getBehaviorPatternById(entityId);
      return pattern
        ? { label: pattern.title, description: pattern.description }
        : null;
    }
    case "behavior": {
      const behavior = getBehaviorById(entityId);
      return behavior
        ? { label: behavior.title, description: behavior.description }
        : null;
    }
    case "belief_entry": {
      const belief = getBeliefEntryById(entityId);
      return belief
        ? { label: belief.statement, description: belief.flexibleAlternative }
        : null;
    }
    case "mode_profile": {
      const mode = getModeProfileById(entityId);
      return mode ? { label: mode.title, description: mode.persona } : null;
    }
    case "mode_guide_session": {
      const session = getModeGuideSessionById(entityId);
      return session
        ? { label: session.summary, description: session.summary }
        : null;
    }
    case "event_type": {
      const eventType = getEventTypeById(entityId);
      return eventType
        ? { label: eventType.label, description: eventType.description }
        : null;
    }
    case "emotion_definition": {
      const emotion = getEmotionDefinitionById(entityId);
      return emotion
        ? { label: emotion.label, description: emotion.description }
        : null;
    }
    case "trigger_report": {
      const report = getTriggerReportById(entityId);
      return report
        ? { label: report.title, description: report.eventSituation }
        : null;
    }
    case "tag":
    default:
      return null;
  }
}

function ensureProfile(
  userId: string,
  domain: PreferenceDomain
): PreferenceProfile {
  ensureUserExists(userId);
  const existing = readProfileByUserAndDomain(userId, domain);
  if (existing) {
    if (listContexts(existing.id).length === 0) {
      createDefaultContexts(existing.id);
    }
    ensureCatalogs(existing.id, domain);
    return getPreferenceProfileById(existing.id) ?? existing;
  }
  const now = nowIso();
  const profileId = `pref_profile_${randomUUID().slice(0, 10)}`;
  runInTransaction(() => {
    getDatabase()
      .prepare(
        `INSERT INTO preference_profiles (id, user_id, domain, default_context_id, model_version, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?)`
      )
      .run(profileId, userId, domain, PREFERENCE_MODEL_VERSION, now, now);
    createDefaultContexts(profileId);
    ensureCatalogs(profileId, domain);
  });
  const created = getPreferenceProfileById(profileId);
  if (!created) {
    throw new HttpError(
      500,
      "preferences_profile_missing",
      "Preference profile could not be created."
    );
  }
  return created;
}

function createDefaultContexts(profileId: string) {
  runInTransaction(() => {
    const now = nowIso();
    const database = getDatabase();
    const profile = getPreferenceProfileById(profileId);
    if (!profile) {
      throw new HttpError(
        500,
        "preferences_profile_missing",
        `Preference profile ${profileId} was not found.`
      );
    }
    const insertedContextIds: string[] = [];
    for (const template of DEFAULT_CONTEXT_TEMPLATES) {
      const contextId = `pref_ctx_${template.key}_${randomUUID().slice(0, 8)}`;
      insertedContextIds.push(contextId);
      database
        .prepare(
          `INSERT INTO preference_contexts (id, profile_id, name, description, share_mode, active, is_default, decay_days, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          contextId,
          profileId,
          template.name,
          template.description,
          template.shareMode,
          template.active ? 1 : 0,
          template.isDefault ? 1 : 0,
          template.decayDays,
          now,
          now
        );
      setEntityOwner("preference_context", contextId, profile.userId);
    }
    const defaultContextId = insertedContextIds[0] ?? null;
    database
      .prepare(
        `UPDATE preference_profiles
         SET default_context_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(defaultContextId, now, profileId);
  });
}

function createSeededCatalogs(profileId: string, domain: PreferenceDomain) {
  const seeds = getPreferenceCatalogSeeds(domain);
  if (seeds.length === 0) {
    return;
  }
  const database = getDatabase();
  const now = nowIso();
  const profile = getPreferenceProfileById(profileId);
  if (!profile) {
    throw new HttpError(
      500,
      "preferences_profile_missing",
      `Preference profile ${profileId} was not found.`
    );
  }
  for (const seed of seeds) {
    const catalogId = `pref_catalog_${randomUUID().slice(0, 10)}`;
    database
      .prepare(
        `INSERT INTO preference_catalogs (
           id, profile_id, domain, slug, title, description, source,
           created_source, archived, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'system', 0, ?, ?)`
      )
      .run(
        catalogId,
        profileId,
        domain,
        seed.slug,
        seed.title,
        seed.description,
        preferenceCatalogSourceSchema.enum.seeded,
        now,
        now
      );
    setEntityOwner("preference_catalog", catalogId, profile.userId);
    seed.items.forEach((seedItem, index) => {
      const catalogItemId = `pref_catalog_item_${randomUUID().slice(0, 10)}`;
      database
        .prepare(
          `INSERT INTO preference_catalog_items (
             id, catalog_id, label, description, tags_json, feature_weights_json, position, archived, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(
          catalogItemId,
          catalogId,
          seedItem.label,
          seedItem.description,
          JSON.stringify(seedItem.tags),
          JSON.stringify(seedItem.featureWeights),
          index,
          now,
          now
        );
      setEntityOwner("preference_catalog_item", catalogItemId, profile.userId);
    });
  }
}

function ensureCatalogs(profileId: string, domain: PreferenceDomain) {
  runInTransaction(() => {
    const existingCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) as count
         FROM preference_catalogs
         WHERE profile_id = ?`
      )
      .get(profileId) as { count: number };
    if (existingCount.count === 0) {
      createSeededCatalogs(profileId, domain);
    }
  });
}

function buildEvidenceFactorMap(
  contexts: PreferenceContext[],
  selectedContext: PreferenceContext
) {
  const factors = new Map<string, number>();
  for (const context of contexts.filter((entry) => entry.active)) {
    if (selectedContext.shareMode === "isolated") {
      factors.set(context.id, context.id === selectedContext.id ? 1 : 0);
      continue;
    }
    if (selectedContext.shareMode === "shared") {
      factors.set(context.id, 1);
      continue;
    }
    factors.set(context.id, context.id === selectedContext.id ? 1 : 0.45);
  }
  return factors;
}

function deriveStatus(options: {
  manualStatus: PreferenceItemStatus | null;
  score: number;
  confidence: number;
  bookmarked: boolean;
  compareLater: boolean;
  directSignal: AbsoluteSignal["signalType"] | null;
}): PreferenceItemStatus {
  const {
    manualStatus,
    score,
    confidence,
    bookmarked,
    compareLater,
    directSignal
  } = options;
  if (manualStatus) {
    return manualStatus;
  }
  if (directSignal === "veto") {
    return "vetoed";
  }
  if (directSignal === "must_have") {
    return "must_have";
  }
  if (directSignal === "favorite") {
    return "favorite";
  }
  if (directSignal === "neutral") {
    return "neutral";
  }
  if (bookmarked || compareLater || directSignal === "bookmark") {
    return "bookmarked";
  }
  if (confidence < 0.42) {
    return "uncertain";
  }
  if (score >= 0.35) {
    return "liked";
  }
  if (score <= -0.35) {
    return "disliked";
  }
  return "neutral";
}

function computeDimensionSummaries(options: {
  contexts: PreferenceContext[];
  selectedContext: PreferenceContext;
  itemsById: Map<string, PreferenceItem>;
  judgments: PairwiseJudgment[];
  signals: AbsoluteSignal[];
}) {
  const { contexts, selectedContext, itemsById, judgments, signals } = options;
  const evidenceFactors = buildEvidenceFactorMap(contexts, selectedContext);
  const leaning = new Map<PreferenceDimensionId, number>(
    DIMENSION_IDS.map((dimensionId) => [dimensionId, 0])
  );
  const recent = new Map<PreferenceDimensionId, number>(
    DIMENSION_IDS.map((dimensionId) => [dimensionId, 0])
  );
  const counts = new Map<PreferenceDimensionId, number>(
    DIMENSION_IDS.map((dimensionId) => [dimensionId, 0])
  );

  for (const signal of signals) {
    if (signal.signalType === "neutral") {
      continue;
    }
    const item = itemsById.get(signal.itemId);
    const factor = evidenceFactors.get(signal.contextId) ?? 0;
    if (!item || factor <= 0) {
      continue;
    }
    const weight =
      PREFERENCE_SIGNAL_MODEL_WEIGHTS[signal.signalType] *
      signal.strength *
      factor *
      timeDecay(ageInDays(signal.createdAt), selectedContext.decayDays);
    const recentFactor = ageInDays(signal.createdAt) <= 21 ? 1 : 0;
    for (const dimensionId of DIMENSION_IDS) {
      const contribution = item.featureWeights[dimensionId] * weight;
      leaning.set(dimensionId, (leaning.get(dimensionId) ?? 0) + contribution);
      recent.set(
        dimensionId,
        (recent.get(dimensionId) ?? 0) + contribution * recentFactor
      );
      if (Math.abs(item.featureWeights[dimensionId]) > 0.01) {
        counts.set(dimensionId, (counts.get(dimensionId) ?? 0) + 1);
      }
    }
  }

  for (const judgment of judgments) {
    const left = itemsById.get(judgment.leftItemId);
    const right = itemsById.get(judgment.rightItemId);
    const factor = evidenceFactors.get(judgment.contextId) ?? 0;
    if (!left || !right || factor <= 0 || judgment.outcome === "skip") {
      continue;
    }
    const outcomeSign =
      judgment.outcome === "left" ? 1 : judgment.outcome === "right" ? -1 : 0;
    const weight =
      judgment.strength *
      factor *
      timeDecay(ageInDays(judgment.createdAt), selectedContext.decayDays);
    const recentFactor = ageInDays(judgment.createdAt) <= 21 ? 1 : 0;
    for (const dimensionId of DIMENSION_IDS) {
      const contribution =
        (left.featureWeights[dimensionId] - right.featureWeights[dimensionId]) *
        outcomeSign *
        weight;
      leaning.set(dimensionId, (leaning.get(dimensionId) ?? 0) + contribution);
      recent.set(
        dimensionId,
        (recent.get(dimensionId) ?? 0) + contribution * recentFactor
      );
      if (
        Math.abs(left.featureWeights[dimensionId]) > 0.01 ||
        Math.abs(right.featureWeights[dimensionId]) > 0.01
      ) {
        counts.set(dimensionId, (counts.get(dimensionId) ?? 0) + 1);
      }
    }
  }

  return DIMENSION_IDS.map((dimensionId) => ({
    id: `pref_dim_${selectedContext.id}_${dimensionId}`,
    profileId: selectedContext.profileId,
    contextId: selectedContext.id,
    dimensionId,
    leaning: clamp(tanhScale(leaning.get(dimensionId) ?? 0, 3), -1, 1),
    confidence: clamp(1 - Math.exp(-(counts.get(dimensionId) ?? 0) / 3), 0, 1),
    movement: clamp(tanhScale(recent.get(dimensionId) ?? 0, 2), -1, 1),
    contextSensitivity: 0,
    evidenceCount: counts.get(dimensionId) ?? 0,
    updatedAt: nowIso()
  })) as PreferenceDimensionSummary[];
}

function computeScores(options: {
  profile: PreferenceProfile;
  contexts: PreferenceContext[];
  selectedContext: PreferenceContext;
  items: PreferenceItem[];
  judgments: PairwiseJudgment[];
  signals: AbsoluteSignal[];
  existingScores: ScoreRow[];
}) {
  const {
    contexts,
    selectedContext,
    items,
    judgments,
    signals,
    existingScores
  } = options;
  const effectiveSignals = getEffectiveSignals(signals);
  const itemsById = new Map(items.map((item) => [item.id, item] as const));
  const evidenceFactors = buildEvidenceFactorMap(contexts, selectedContext);
  const dimensionSummaries = computeDimensionSummaries({
    contexts,
    selectedContext,
    itemsById,
    judgments,
    signals: effectiveSignals
  });
  const dimensionLeanings = new Map(
    dimensionSummaries.map((summary) => [summary.dimensionId, summary.leaning])
  );
  const manualByItemId = new Map(
    existingScores.map((score) => [score.item_id, score] as const)
  );
  const perItem = new Map<
    string,
    {
      raw: number;
      wins: number;
      losses: number;
      ties: number;
      signalCount: number;
      evidenceCount: number;
      lastJudgmentAt: string | null;
      lastEvidenceAt: string | null;
      signals: Array<{
        signal: AbsoluteSignal;
        contextName: string;
        factor: number;
        weightedEffect: number;
      }>;
    }
  >(
    items.map((item) => [
      item.id,
      {
        raw: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        signalCount: 0,
        evidenceCount: 0,
        lastJudgmentAt: null,
        lastEvidenceAt: null,
        signals: []
      }
    ])
  );
  const pairWinners = new Map<string, Set<string>>();

  const contextsById = new Map(
    contexts.map((context) => [context.id, context] as const)
  );
  for (const signal of effectiveSignals) {
    const itemStats = perItem.get(signal.itemId);
    const factor = evidenceFactors.get(signal.contextId) ?? 0;
    if (!itemStats || factor <= 0) {
      continue;
    }
    const weight =
      PREFERENCE_SIGNAL_MODEL_WEIGHTS[signal.signalType] *
      signal.strength *
      factor *
      timeDecay(ageInDays(signal.createdAt), selectedContext.decayDays);
    itemStats.signals.push({
      signal,
      contextName: contextsById.get(signal.contextId)?.name ?? signal.contextId,
      factor,
      weightedEffect: weight
    });
    if (signal.signalType === "neutral") {
      continue;
    }
    itemStats.raw += weight;
    itemStats.signalCount += 1;
    itemStats.evidenceCount += 1;
    itemStats.lastEvidenceAt =
      !itemStats.lastEvidenceAt || signal.createdAt > itemStats.lastEvidenceAt
        ? signal.createdAt
        : itemStats.lastEvidenceAt;
  }

  for (const judgment of judgments) {
    const leftStats = perItem.get(judgment.leftItemId);
    const rightStats = perItem.get(judgment.rightItemId);
    const factor = evidenceFactors.get(judgment.contextId) ?? 0;
    if (
      !leftStats ||
      !rightStats ||
      factor <= 0 ||
      judgment.outcome === "skip"
    ) {
      continue;
    }
    const weight =
      judgment.strength *
      factor *
      timeDecay(ageInDays(judgment.createdAt), selectedContext.decayDays);
    const pairKey = [judgment.leftItemId, judgment.rightItemId]
      .sort()
      .join("::");
    if (judgment.outcome === "left") {
      leftStats.raw += weight;
      rightStats.raw -= weight;
      leftStats.wins += 1;
      rightStats.losses += 1;
      const winners = pairWinners.get(pairKey) ?? new Set<string>();
      winners.add(judgment.leftItemId);
      pairWinners.set(pairKey, winners);
    } else if (judgment.outcome === "right") {
      leftStats.raw -= weight;
      rightStats.raw += weight;
      leftStats.losses += 1;
      rightStats.wins += 1;
      const winners = pairWinners.get(pairKey) ?? new Set<string>();
      winners.add(judgment.rightItemId);
      pairWinners.set(pairKey, winners);
    } else {
      leftStats.ties += 1;
      rightStats.ties += 1;
    }
    leftStats.evidenceCount += 1;
    rightStats.evidenceCount += 1;
    leftStats.lastJudgmentAt =
      !leftStats.lastJudgmentAt || judgment.createdAt > leftStats.lastJudgmentAt
        ? judgment.createdAt
        : leftStats.lastJudgmentAt;
    rightStats.lastJudgmentAt =
      !rightStats.lastJudgmentAt ||
      judgment.createdAt > rightStats.lastJudgmentAt
        ? judgment.createdAt
        : rightStats.lastJudgmentAt;
    leftStats.lastEvidenceAt =
      !leftStats.lastEvidenceAt || judgment.createdAt > leftStats.lastEvidenceAt
        ? judgment.createdAt
        : leftStats.lastEvidenceAt;
    rightStats.lastEvidenceAt =
      !rightStats.lastEvidenceAt ||
      judgment.createdAt > rightStats.lastEvidenceAt
        ? judgment.createdAt
        : rightStats.lastEvidenceAt;
  }

  const conflictCountByItem = new Map<string, number>();
  for (const [pairKey, winners] of pairWinners) {
    if (winners.size < 2) {
      continue;
    }
    const [leftItemId, rightItemId] = pairKey.split("::");
    conflictCountByItem.set(
      leftItemId,
      (conflictCountByItem.get(leftItemId) ?? 0) + 1
    );
    conflictCountByItem.set(
      rightItemId,
      (conflictCountByItem.get(rightItemId) ?? 0) + 1
    );
  }

  for (const [itemId, stats] of perItem) {
    const polarities = new Set(
      stats.signals
        .map(({ weightedEffect }) => Math.sign(weightedEffect))
        .filter((value) => value !== 0)
    );
    let directConflictCount = polarities.size > 1 ? 1 : 0;
    if ([...polarities].some((value) => value > 0) && stats.losses > 0) {
      directConflictCount += 1;
    }
    if ([...polarities].some((value) => value < 0) && stats.wins > 0) {
      directConflictCount += 1;
    }
    if (directConflictCount > 0) {
      conflictCountByItem.set(
        itemId,
        (conflictCountByItem.get(itemId) ?? 0) + directConflictCount
      );
    }
  }

  const scores: ScoreComputation[] = items.map((item) => {
    const existing = manualByItemId.get(item.id);
    const stats = perItem.get(item.id)!;
    const dominantDimensions = [...DIMENSION_IDS]
      .map((dimensionId) => ({
        dimensionId,
        weight:
          Math.abs(item.featureWeights[dimensionId]) *
          Math.abs(dimensionLeanings.get(dimensionId) ?? 0)
      }))
      .filter((entry) => entry.weight > 0)
      .sort((left, right) => right.weight - left.weight)
      .slice(0, 3)
      .map((entry) => entry.dimensionId);
    const score = clamp(
      existing?.manual_score ?? tanhScale(stats.raw, 4),
      -1,
      1
    );
    const freshness = Math.exp(
      -Math.max(
        0,
        ageInDays(stats.lastEvidenceAt) - selectedContext.decayDays
      ) / Math.max(14, selectedContext.decayDays)
    );
    const conflictPenalty =
      1 -
      Math.min(
        0.55,
        (conflictCountByItem.get(item.id) ?? 0) /
          Math.max(1, stats.evidenceCount)
      );
    const confidence =
      existing?.confidence_lock ??
      clamp(
        (1 - Math.exp(-stats.evidenceCount / 4)) *
          conflictPenalty *
          (0.55 + 0.45 * freshness),
        0.04,
        1
      );
    const statusSignal = [...stats.signals].sort((left, right) => {
      const leftSelected = left.signal.contextId === selectedContext.id ? 1 : 0;
      const rightSelected =
        right.signal.contextId === selectedContext.id ? 1 : 0;
      if (rightSelected !== leftSelected) {
        return rightSelected - leftSelected;
      }
      if (Math.abs(right.weightedEffect) !== Math.abs(left.weightedEffect)) {
        return Math.abs(right.weightedEffect) - Math.abs(left.weightedEffect);
      }
      return right.signal.createdAt.localeCompare(left.signal.createdAt);
    })[0]?.signal;
    const bookmarked =
      (existing?.bookmarked ?? 0) === 1 ||
      statusSignal?.signalType === "bookmark";
    const compareLater =
      (existing?.compare_later ?? 0) === 1 ||
      statusSignal?.signalType === "compare_later";
    const status = deriveStatus({
      manualStatus: existing?.manual_status ?? null,
      score,
      confidence,
      bookmarked,
      compareLater,
      directSignal:
        statusSignal?.signalType === "neutral"
          ? null
          : (statusSignal?.signalType ?? null)
    });
    const explanation = [
      stats.wins > 0
        ? `Preferred over peers ${stats.wins} time${stats.wins === 1 ? "" : "s"}.`
        : null,
      stats.losses > 0
        ? `Lost against peers ${stats.losses} time${stats.losses === 1 ? "" : "s"}.`
        : null,
      ...stats.signals.map(({ signal, contextName, factor, weightedEffect }) =>
        signal.signalType === "neutral"
          ? `Direct signal cleared in ${contextName}; earlier direct signals remain in history and no direct weight is active in this context.`
          : `${signal.signalType.replaceAll("_", " ")} in ${contextName}: raw model weight ${signal.modelWeight.toFixed(2)}, context factor ${factor.toFixed(2)}, current contribution ${weightedEffect.toFixed(2)} before score scaling.`
      ),
      dominantDimensions.length > 0
        ? `Dominant dimensions: ${dominantDimensions.join(", ")}.`
        : null,
      (conflictCountByItem.get(item.id) ?? 0) > 0
        ? "Direct signals and/or prior judgments conflict, which lowers confidence."
        : null,
      ageInDays(stats.lastEvidenceAt) > selectedContext.decayDays
        ? "Evidence is getting stale and should be recalibrated."
        : null
    ].filter((value): value is string => Boolean(value));
    return {
      itemId: item.id,
      latentScore: score,
      confidence,
      uncertainty: clamp(1 - confidence, 0, 1),
      evidenceCount: stats.evidenceCount,
      pairwiseWins: stats.wins,
      pairwiseLosses: stats.losses,
      pairwiseTies: stats.ties,
      signalCount: stats.signalCount,
      conflictCount: conflictCountByItem.get(item.id) ?? 0,
      status,
      dominantDimensions,
      explanation,
      manualStatus: existing?.manual_status ?? null,
      manualScore: existing?.manual_score ?? null,
      confidenceLock: existing?.confidence_lock ?? null,
      bookmarked,
      compareLater,
      frozen: (existing?.frozen ?? 0) === 1,
      lastInferredAt: nowIso(),
      lastJudgmentAt: stats.lastJudgmentAt,
      updatedAt: nowIso()
    };
  });

  const averageSensitivityByDimension = new Map<PreferenceDimensionId, number>(
    dimensionSummaries.map((summary) => [summary.dimensionId, 0])
  );
  const contextOnlyDimensionsByContext = new Map<
    string,
    Map<PreferenceDimensionId, number>
  >();
  for (const context of contexts.filter((entry) => entry.active)) {
    const isolatedDimensions = computeDimensionSummaries({
      contexts: contexts.map((entry) =>
        entry.id === context.id
          ? { ...entry, shareMode: "isolated" }
          : { ...entry, active: false }
      ),
      selectedContext: { ...context, shareMode: "isolated" },
      itemsById,
      judgments,
      signals: effectiveSignals
    });
    contextOnlyDimensionsByContext.set(
      context.id,
      new Map(
        isolatedDimensions.map((summary) => [
          summary.dimensionId,
          summary.leaning
        ])
      )
    );
  }
  const selectedIsolated =
    contextOnlyDimensionsByContext.get(selectedContext.id) ?? new Map();
  for (const summary of dimensionSummaries) {
    const otherLeanings = [...contextOnlyDimensionsByContext.entries()]
      .filter(([contextId]) => contextId !== selectedContext.id)
      .map(
        ([, leaningByDimension]) =>
          leaningByDimension.get(summary.dimensionId) ?? 0
      );
    const averageOther =
      otherLeanings.length === 0
        ? 0
        : otherLeanings.reduce((sum, value) => sum + value, 0) /
          otherLeanings.length;
    averageSensitivityByDimension.set(
      summary.dimensionId,
      clamp(
        Math.abs(
          (selectedIsolated.get(summary.dimensionId) ?? 0) - averageOther
        ),
        0,
        1
      )
    );
  }

  return {
    scores,
    dimensions: dimensionSummaries.map((summary) => ({
      ...summary,
      contextSensitivity:
        averageSensitivityByDimension.get(summary.dimensionId) ?? 0
    }))
  };
}

function buildNextPair(options: {
  selectedContext: PreferenceContext;
  items: PreferenceItem[];
  scores: ScoreComputation[];
  judgments: PairwiseJudgment[];
}): PreferenceComparePair | null {
  const { selectedContext, items, scores, judgments } = options;
  const scoreByItemId = new Map(scores.map((score) => [score.itemId, score]));
  const pairHistory = new Map<
    string,
    { count: number; lastCreatedAt: string | null }
  >();
  for (const judgment of judgments.filter(
    (entry) => entry.contextId === selectedContext.id
  )) {
    const pairKey = [judgment.leftItemId, judgment.rightItemId]
      .sort()
      .join("::");
    const current = pairHistory.get(pairKey) ?? {
      count: 0,
      lastCreatedAt: null
    };
    pairHistory.set(pairKey, {
      count: current.count + 1,
      lastCreatedAt:
        !current.lastCreatedAt || judgment.createdAt > current.lastCreatedAt
          ? judgment.createdAt
          : current.lastCreatedAt
    });
  }
  let best: {
    left: PreferenceItem;
    right: PreferenceItem;
    score: number;
    rationale: string[];
  } | null = null;
  for (let index = 0; index < items.length; index += 1) {
    for (
      let innerIndex = index + 1;
      innerIndex < items.length;
      innerIndex += 1
    ) {
      const left = items[index]!;
      const right = items[innerIndex]!;
      const leftScore = scoreByItemId.get(left.id);
      const rightScore = scoreByItemId.get(right.id);
      if (!leftScore || !rightScore) {
        continue;
      }
      if (leftScore.status === "vetoed" || rightScore.status === "vetoed") {
        continue;
      }
      const pairKey = [left.id, right.id].sort().join("::");
      const history = pairHistory.get(pairKey);
      const uncertaintyGain =
        (leftScore.uncertainty + rightScore.uncertainty) / 2;
      const boundaryValue =
        1 -
        Math.min(1, Math.abs(leftScore.latentScore - rightScore.latentScore));
      const diversityBonus = clamp(
        vectorDistance(left.featureWeights, right.featureWeights),
        0,
        1
      );
      const contextNeed =
        leftScore.evidenceCount + rightScore.evidenceCount < 6 ? 0.35 : 0.1;
      const driftProbe =
        !history?.lastCreatedAt || ageInDays(history.lastCreatedAt) > 45
          ? 0.25
          : 0;
      const repetitionPenalty = !history
        ? 0
        : ageInDays(history.lastCreatedAt) < 7
          ? 0.7 + history.count * 0.08
          : history.count * 0.08;
      const queueBias =
        (leftScore.compareLater || leftScore.bookmarked ? 0.15 : 0) +
        (rightScore.compareLater || rightScore.bookmarked ? 0.15 : 0);
      const candidateScore =
        uncertaintyGain +
        boundaryValue +
        diversityBonus +
        contextNeed +
        driftProbe +
        queueBias -
        repetitionPenalty;
      if (!best || candidateScore > best.score) {
        best = {
          left,
          right,
          score: candidateScore,
          rationale: [
            uncertaintyGain > 0.45
              ? "Both items still carry meaningful uncertainty."
              : "These items are close enough to refine the boundary.",
            boundaryValue > 0.5
              ? "Their current scores are close enough to be informative."
              : "This pair helps bridge different regions of the map.",
            driftProbe > 0
              ? "This pair also checks for drift in older assumptions."
              : "This pair improves the current local ordering."
          ]
        };
      }
    }
  }
  if (!best) {
    return null;
  }
  return {
    left: best.left,
    right: best.right,
    rationale: best.rationale,
    score: best.score
  };
}

function buildMap(items: PreferenceItem[], scores: ScoreComputation[]) {
  const scoreByItemId = new Map(scores.map((score) => [score.itemId, score]));
  return items.map((item) => {
    const score = scoreByItemId.get(item.id);
    const x =
      item.featureWeights.novelty -
      item.featureWeights.familiarity +
      item.featureWeights.surprise * 0.5;
    const y =
      item.featureWeights.rigor * 0.7 +
      item.featureWeights.depth * 0.7 +
      item.featureWeights.structure * 0.5 -
      item.featureWeights.simplicity * 0.25;
    return {
      itemId: item.id,
      label: item.label,
      x: clamp(x, -2, 2),
      y: clamp(y, -2, 2),
      score: score?.latentScore ?? 0,
      confidence: score?.confidence ?? 0,
      uncertainty: score?.uncertainty ?? 1,
      status: score?.status ?? "uncertain",
      clusterKey: item.tags[0] ?? item.sourceEntityType ?? "untagged",
      tags: item.tags,
      sourceEntityType: item.sourceEntityType ?? null,
      sourceEntityId: item.sourceEntityId ?? null
    };
  });
}

function persistScoresAndDimensions(options: {
  profile: PreferenceProfile;
  selectedContext: PreferenceContext;
  scores: ScoreComputation[];
  dimensions: PreferenceDimensionSummary[];
  snapshotsSummary: Record<string, unknown>;
}) {
  const { profile, selectedContext, scores, dimensions, snapshotsSummary } =
    options;
  const database = getDatabase();
  const timestamp = nowIso();
  database
    .prepare(`DELETE FROM preference_item_scores WHERE context_id = ?`)
    .run(selectedContext.id);
  for (const score of scores) {
    database
      .prepare(
        `INSERT INTO preference_item_scores (
           id, profile_id, context_id, item_id, latent_score, confidence, uncertainty, evidence_count,
           pairwise_wins, pairwise_losses, pairwise_ties, signal_count, conflict_count, status,
           dominant_dimensions_json, explanation_json, manual_status, manual_score, confidence_lock,
           bookmarked, compare_later, frozen, last_inferred_at, last_judgment_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `pref_score_${randomUUID().slice(0, 10)}`,
        profile.id,
        selectedContext.id,
        score.itemId,
        score.latentScore,
        score.confidence,
        score.uncertainty,
        score.evidenceCount,
        score.pairwiseWins,
        score.pairwiseLosses,
        score.pairwiseTies,
        score.signalCount,
        score.conflictCount,
        score.status,
        JSON.stringify(score.dominantDimensions),
        JSON.stringify(score.explanation),
        score.manualStatus,
        score.manualScore,
        score.confidenceLock,
        score.bookmarked ? 1 : 0,
        score.compareLater ? 1 : 0,
        score.frozen ? 1 : 0,
        score.lastInferredAt,
        score.lastJudgmentAt,
        score.updatedAt
      );
  }
  database
    .prepare(`DELETE FROM preference_dimension_summaries WHERE context_id = ?`)
    .run(selectedContext.id);
  for (const summary of dimensions) {
    database
      .prepare(
        `INSERT INTO preference_dimension_summaries (
           id, profile_id, context_id, dimension_id, leaning, confidence, movement, context_sensitivity, evidence_count, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        summary.id,
        profile.id,
        selectedContext.id,
        summary.dimensionId,
        summary.leaning,
        summary.confidence,
        summary.movement,
        summary.contextSensitivity,
        summary.evidenceCount,
        summary.updatedAt
      );
  }
  database
    .prepare(
      `INSERT INTO preference_snapshots (id, profile_id, context_id, summary_metrics_json, serialized_model_state_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      `pref_snapshot_${randomUUID().slice(0, 10)}`,
      profile.id,
      selectedContext.id,
      JSON.stringify(snapshotsSummary),
      JSON.stringify({
        topScores: scores
          .slice()
          .sort((left, right) => right.latentScore - left.latentScore)
          .slice(0, 12)
          .map((score) => ({
            itemId: score.itemId,
            latentScore: score.latentScore,
            confidence: score.confidence,
            status: score.status
          })),
        dimensions: dimensions.map((dimension) => ({
          dimensionId: dimension.dimensionId,
          leaning: dimension.leaning,
          confidence: dimension.confidence
        }))
      }),
      timestamp
    );
  database
    .prepare(
      `DELETE FROM preference_snapshots
       WHERE context_id = ?
         AND id NOT IN (
           SELECT id
           FROM preference_snapshots
           WHERE context_id = ?
           ORDER BY created_at DESC
           LIMIT 48
         )`
    )
    .run(selectedContext.id, selectedContext.id);
}

function recomputeContext(
  profile: PreferenceProfile,
  selectedContext: PreferenceContext,
  mutationContext: PreferenceMutationContext = {
    source: "system",
    actor: null
  }
) {
  return runInTransaction(() => {
    const contexts = listContexts(profile.id);
    if (contexts.length > 0) {
      const placeholders = contexts.map(() => "?").join(", ");
      getDatabase()
        .prepare(
          `INSERT INTO entity_owners (
             entity_type, entity_id, user_id, role, created_at, updated_at
           )
           SELECT 'preference_signal', id, user_id, 'owner', created_at, created_at
           FROM absolute_signals
           WHERE context_id IN (${placeholders})
           ON CONFLICT(entity_type, entity_id) DO NOTHING`
        )
        .run(...contexts.map((context) => context.id));
    }
    const items = listItems(profile.id);
    const judgmentWindow = listJudgmentsForContexts(
      contexts.map((context) => context.id)
    );
    const signals = listEffectiveSignalsForContexts(
      contexts.map((context) => context.id)
    );
    const existingScores = listStoredScores(selectedContext.id);
    const { scores, dimensions } = computeScores({
      profile,
      contexts,
      selectedContext,
      items,
      judgments: judgmentWindow.judgments,
      signals,
      existingScores
    });
    persistScoresAndDimensions({
      profile,
      selectedContext,
      scores,
      dimensions,
      snapshotsSummary: {
        averageConfidence:
          scores.length === 0
            ? 0
            : scores.reduce((sum, score) => sum + score.confidence, 0) /
              scores.length,
        likedCount: scores.filter((score) => score.status === "liked").length,
        dislikedCount: scores.filter((score) => score.status === "disliked")
          .length,
        uncertainCount: scores.filter((score) => score.status === "uncertain")
          .length,
        totalItems: scores.length,
        evidenceCoverage: judgmentWindow.coverage,
        refreshSource: mutationContext.source,
        refreshActor: mutationContext.actor ?? null
      }
    });
    return {
      items,
      judgments: judgmentWindow.judgments,
      evidenceCoverage: judgmentWindow.coverage,
      signals,
      contexts,
      selectedContext,
      scores,
      dimensions
    };
  });
}

function recomputeAffectedContexts(
  profile: PreferenceProfile,
  primaryContextId: string | null,
  mutationContext: PreferenceMutationContext = {
    source: "system",
    actor: null
  }
) {
  const contexts = listContexts(profile.id)
    .filter((context) => context.active || context.id === primaryContextId)
    .sort((left, right) => {
      if (left.id === primaryContextId) {
        return -1;
      }
      if (right.id === primaryContextId) {
        return 1;
      }
      return left.createdAt.localeCompare(right.createdAt);
    });
  for (const context of contexts) {
    recomputeContext(profile, context, mutationContext);
  }
}

function buildWorkspace(
  profile: PreferenceProfile,
  selectedContext: PreferenceContext,
  items: PreferenceItem[],
  judgments: PairwiseJudgment[],
  signalHistory: AbsoluteSignal[],
  scores: ScoreComputation[],
  _dimensions: PreferenceDimensionSummary[],
  query: { itemLimit: number; itemOffset: number; historyLimit: number },
  evidenceCoverage: PreferenceEvidenceCoverage
): PreferenceWorkspacePayload {
  const catalogs = listCatalogs(profile.id);
  const libraryCounts = getCatalogLibraryCounts(profile.id);
  const storedScores = listStoredScores(selectedContext.id);
  const itemsById = new Map(items.map((item) => [item.id, item] as const));
  const allMappedScores = storedScores
    .map((score) => {
      const item = itemsById.get(score.item_id);
      return item ? mapScore(score, item) : null;
    })
    .filter((score): score is PreferenceItemScore => Boolean(score))
    .sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }
      return right.latentScore - left.latentScore;
    });
  const pagedScores = allMappedScores.slice(
    query.itemOffset,
    query.itemOffset + query.itemLimit
  );
  const effectiveSignalsByItemId = new Map(
    listEffectiveSignalsForItems(
      selectedContext.id,
      pagedScores.map((score) => score.itemId)
    ).map((signal) => [signal.itemId, signal] as const)
  );
  const mappedScores = pagedScores.map((score) =>
    preferenceItemScoreSchema.parse({
      ...score,
      effectiveSignal: effectiveSignalsByItemId.get(score.itemId) ?? null
    })
  );
  const returnedItemIds = new Set(mappedScores.map((score) => score.itemId));
  const returnedItems = items.filter((item) => returnedItemIds.has(item.id));
  const historyJudgments = judgments
    .filter((judgment) => judgment.contextId === selectedContext.id)
    .slice(0, query.historyLimit);
  const historySignals = signalHistory.slice(0, query.historyLimit);
  const historyItemIds = new Set<string>();
  for (const judgment of historyJudgments) {
    historyItemIds.add(judgment.leftItemId);
    historyItemIds.add(judgment.rightItemId);
  }
  for (const signal of historySignals) {
    historyItemIds.add(signal.itemId);
  }
  const historyItemLabels = Object.fromEntries(
    [...historyItemIds]
      .sort()
      .flatMap((itemId) => {
        const item = itemsById.get(itemId);
        return item ? [[itemId, item.label] as const] : [];
      })
  );
  const mappedDimensions = listStoredDimensions(selectedContext.id);
  const nextPair = buildNextPair({
    selectedContext,
    items,
    scores,
    judgments
  });
  const snapshots = listSnapshots(selectedContext.id, 24);
  const staleItemIds = mappedScores
    .filter(
      (score) =>
        ageInDays(score.lastJudgmentAt ?? score.updatedAt) >
        selectedContext.decayDays
    )
    .map((score) => score.itemId);
  const flippedItemIds = (() => {
    const recentSnapshots = [...snapshots].reverse();
    const signsByItemId = new Map<string, number[]>();
    for (const snapshot of recentSnapshots) {
      const topScores = Array.isArray(snapshot.serializedModelState.topScores)
        ? (snapshot.serializedModelState.topScores as Array<{
            itemId?: string;
            latentScore?: number;
          }>)
        : [];
      for (const entry of topScores) {
        if (!entry.itemId || typeof entry.latentScore !== "number") {
          continue;
        }
        signsByItemId.set(entry.itemId, [
          ...(signsByItemId.get(entry.itemId) ?? []),
          Math.sign(entry.latentScore)
        ]);
      }
    }
    return [...signsByItemId.entries()]
      .filter(([itemId]) => returnedItemIds.has(itemId))
      .filter(([, signs]) => {
        const filtered = signs.filter((sign) => sign !== 0);
        return filtered.length >= 2 && new Set(filtered).size > 1;
      })
      .map(([itemId]) => itemId);
  })();
  const workspace = preferenceWorkspacePayloadSchema.parse({
    profile,
    selectedContext,
    contexts: listContexts(profile.id),
    catalogs,
    dimensions: mappedDimensions,
    scores: mappedScores,
    map: buildMap(
      returnedItems,
      scores.filter((score) => returnedItemIds.has(score.itemId))
    ),
    history: {
      judgments: historyJudgments,
      signals: historySignals,
      itemLabels: historyItemLabels,
      snapshots,
      staleItemIds,
      flippedItemIds
    },
    presentation: {
      itemLimit: query.itemLimit,
      itemOffset: query.itemOffset,
      totalItems: allMappedScores.length,
      returnedItems: mappedScores.length,
      hasMore: query.itemOffset + mappedScores.length < allMappedScores.length,
      nextOffset:
        query.itemOffset + mappedScores.length < allMappedScores.length
          ? query.itemOffset + mappedScores.length
          : null,
      historyLimit: query.historyLimit
    },
    evidenceCoverage,
    compare: {
      nextPair,
      pendingCount: allMappedScores.filter(
        (score) => score.uncertainty >= 0.5 || score.compareLater
      ).length,
      candidateCount: items.length
    },
    summary: {
      totalItems: allMappedScores.length,
      likedCount: allMappedScores.filter((score) => score.status === "liked")
        .length,
      dislikedCount: allMappedScores.filter(
        (score) => score.status === "disliked"
      ).length,
      uncertainCount: allMappedScores.filter(
        (score) => score.status === "uncertain"
      ).length,
      bookmarkedCount: allMappedScores.filter((score) => score.bookmarked)
        .length,
      vetoedCount: allMappedScores.filter((score) => score.status === "vetoed")
        .length,
      averageConfidence:
        allMappedScores.length === 0
          ? 0
          : allMappedScores.reduce((sum, score) => sum + score.confidence, 0) /
            allMappedScores.length,
      pendingComparisons: allMappedScores.filter(
        (score) => score.uncertainty >= 0.5 || score.compareLater
      ).length
    },
    libraries: libraryCounts
  });
  return workspace;
}

function resolveWorkspaceQuery(query: PreferenceWorkspaceQuery) {
  const parsed = preferenceWorkspaceQuerySchema.parse(query);
  const userId = parsed.userId ?? getDefaultUser().id;
  const domain = parsed.domain ?? DEFAULT_PREFERENCE_DOMAIN;
  return {
    ...parsed,
    userId,
    domain,
    contextId: parsed.contextId ?? null
  };
}

function mapStoredScoresToComputations(rows: ScoreRow[]): ScoreComputation[] {
  return rows.map((row) => ({
    itemId: row.item_id,
    latentScore: row.latent_score,
    confidence: row.confidence,
    uncertainty: row.uncertainty,
    evidenceCount: row.evidence_count,
    pairwiseWins: row.pairwise_wins,
    pairwiseLosses: row.pairwise_losses,
    pairwiseTies: row.pairwise_ties,
    signalCount: row.signal_count,
    conflictCount: row.conflict_count,
    status: row.status,
    dominantDimensions: parseJsonArray<PreferenceDimensionId>(
      row.dominant_dimensions_json
    ),
    explanation: parseJsonArray<string>(row.explanation_json),
    manualStatus: row.manual_status,
    manualScore: row.manual_score,
    confidenceLock: row.confidence_lock,
    bookmarked: row.bookmarked === 1,
    compareLater: row.compare_later === 1,
    frozen: row.frozen === 1,
    lastInferredAt: row.last_inferred_at,
    lastJudgmentAt: row.last_judgment_at,
    updatedAt: row.updated_at
  }));
}

export function getPreferenceWorkspace(
  query: PreferenceWorkspaceQuery
): PreferenceWorkspacePayload {
  const resolved = resolveWorkspaceQuery(query);
  const { userId, domain, contextId } = resolved;
  const profile = readProfileByUserAndDomain(userId, domain);
  if (!profile) {
    throw new HttpError(
      404,
      "preferences_workspace_not_initialized",
      "This Preferences workspace has not been initialized."
    );
  }
  const selectedContext = resolveContext(profile, contextId);
  const contexts = listContexts(profile.id);
  const judgmentWindow = listJudgmentsForContexts(
    contexts.map((context) => context.id)
  );
  const items = listItems(profile.id);
  const scores = mapStoredScoresToComputations(
    listStoredScores(selectedContext.id)
  );
  return buildWorkspace(
    profile,
    selectedContext,
    items,
    judgmentWindow.judgments,
    listSignalHistory(selectedContext.id, resolved.historyLimit),
    scores,
    listStoredDimensions(selectedContext.id),
    resolved,
    judgmentWindow.coverage
  );
}

export function refreshPreferenceWorkspace(
  query: PreferenceWorkspaceQuery,
  mutationContext: PreferenceMutationContext = { source: "system", actor: null }
): PreferenceWorkspacePayload {
  const resolved = resolveWorkspaceQuery(query);
  return runInTransaction(() => {
    const profile = ensureProfile(resolved.userId, resolved.domain);
    const selectedContext = resolveContext(profile, resolved.contextId);
    const recomputed = recomputeContext(
      profile,
      selectedContext,
      mutationContext
    );
    return buildWorkspace(
      profile,
      selectedContext,
      recomputed.items,
      recomputed.judgments,
      listSignalHistory(selectedContext.id, resolved.historyLimit),
      recomputed.scores,
      recomputed.dimensions,
      resolved,
      recomputed.evidenceCoverage
    );
  });
}

export function createPreferenceCatalog(
  input: CreatePreferenceCatalogInput,
  context: PreferenceMutationContext = { source: "system", actor: null },
  idempotencyKey?: string | null
): PreferenceCatalog {
  const parsed = createPreferenceCatalogSchema.parse(input);
  return runInTransaction(() => {
    const fingerprint = catalogFingerprint(parsed);
    if (idempotencyKey) {
      const receipt = getDatabase()
        .prepare(
          `SELECT request_fingerprint, catalog_id
           FROM preference_catalog_create_receipts
           WHERE user_id = ? AND idempotency_key = ?`
        )
        .get(parsed.userId, idempotencyKey) as
        | { request_fingerprint: string; catalog_id: string }
        | undefined;
      if (receipt) {
        if (receipt.request_fingerprint !== fingerprint) {
          throw new HttpError(
            409,
            "idempotency_conflict",
            "This idempotency key was already used with a different preference catalog payload."
          );
        }
        const replay = readCatalog(receipt.catalog_id, {
          includeArchived: true
        });
        if (!replay) {
          throw new HttpError(
            500,
            "idempotency_corruption",
            "The preference catalog recorded for this idempotency key is missing."
          );
        }
        return replay;
      }
    }

    const profile = ensureProfile(parsed.userId, parsed.domain);
    assertCatalogTitleAvailable(profile.id, parsed.title);
    const timestamp = nowIso();
    const slug = nextCatalogSlug(profile.id, parsed.slug || parsed.title);
    const catalogId = `pref_catalog_${randomUUID().slice(0, 10)}`;
    getDatabase()
      .prepare(
        `INSERT INTO preference_catalogs (
           id, profile_id, domain, slug, title, description, scope_in, scope_out,
           source, created_source, created_by_actor, archived, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        catalogId,
        profile.id,
        parsed.domain,
        slug,
        parsed.title,
        parsed.description,
        parsed.scopeIn,
        parsed.scopeOut,
        preferenceCatalogSourceSchema.enum.custom,
        context.source,
        context.actor ?? null,
        timestamp,
        timestamp
      );
    setEntityOwner("preference_catalog", catalogId, parsed.userId);
    replaceEntityLinksForSource({
      sourceEntityType: "preference_catalog",
      sourceEntityId: catalogId,
      links: parsed.links,
      actor: context.actor ?? null
    });
    if (idempotencyKey) {
      getDatabase()
        .prepare(
          `INSERT INTO preference_catalog_create_receipts (
             user_id, idempotency_key, request_fingerprint, catalog_id, created_at
           ) VALUES (?, ?, ?, ?, ?)`
        )
        .run(parsed.userId, idempotencyKey, fingerprint, catalogId, timestamp);
    }
    return readCatalog(catalogId)!;
  });
}

export function updatePreferenceCatalog(
  catalogId: string,
  patch: UpdatePreferenceCatalogInput,
  context: PreferenceMutationContext = { source: "system", actor: null }
): PreferenceCatalog {
  const parsed = updatePreferenceCatalogSchema.parse(patch);
  return runInTransaction(() => {
    const current = readCatalog(catalogId);
    if (!current) {
      throw new HttpError(
        404,
        "preferences_catalog_not_found",
        `Preference catalog ${catalogId} was not found.`
      );
    }
    const timestamp = nowIso();
    const titleChanged =
      parsed.title !== undefined &&
      normalizeCatalogUniqueText(parsed.title) !==
        normalizeCatalogUniqueText(current.title);
    if (titleChanged) {
      assertCatalogTitleAvailable(current.profileId, parsed.title!, catalogId);
    }
    const nextSlug = parsed.slug
      ? nextCatalogSlug(current.profileId, parsed.slug, catalogId)
      : current.slug;
    const assignments = ["slug = ?"];
    const values: Array<string | number> = [nextSlug];
    if (titleChanged) {
      assignments.push("title = ?");
      values.push(parsed.title!);
    }
    if (parsed.description !== undefined) {
      assignments.push("description = ?");
      values.push(parsed.description);
    }
    if (parsed.scopeIn !== undefined) {
      assignments.push("scope_in = ?");
      values.push(parsed.scopeIn);
    }
    if (parsed.scopeOut !== undefined) {
      assignments.push("scope_out = ?");
      values.push(parsed.scopeOut);
    }
    assignments.push("updated_at = ?");
    values.push(timestamp, catalogId);
    getDatabase()
      .prepare(
        `UPDATE preference_catalogs
         SET ${assignments.join(", ")}
         WHERE id = ? AND archived = 0`
      )
      .run(...values);
    if (parsed.links !== undefined) {
      replaceEntityLinksForSource({
        sourceEntityType: "preference_catalog",
        sourceEntityId: catalogId,
        links: parsed.links,
        actor: context.actor ?? null
      });
    }
    return readCatalog(catalogId)!;
  });
}

export function archivePreferenceCatalog(catalogId: string): PreferenceCatalog {
  return runInTransaction(() => {
    const current = readCatalog(catalogId, { includeArchived: true });
    if (!current) {
      throw new HttpError(
        404,
        "preferences_catalog_not_found",
        `Preference catalog ${catalogId} was not found.`
      );
    }
    if (current.archived) {
      return current;
    }
    const timestamp = nowIso();
    getDatabase()
      .prepare(
        `DELETE FROM preference_catalog_archive_members WHERE catalog_id = ?`
      )
      .run(catalogId);
    getDatabase()
      .prepare(
        `INSERT INTO preference_catalog_archive_members (catalog_id, catalog_item_id)
         SELECT catalog_id, id
         FROM preference_catalog_items
         WHERE catalog_id = ? AND archived = 0`
      )
      .run(catalogId);
    getDatabase()
      .prepare(
        `UPDATE preference_catalogs
         SET archived = 1, updated_at = ?
         WHERE id = ? AND archived = 0`
      )
      .run(timestamp, catalogId);
    getDatabase()
      .prepare(
        `UPDATE preference_catalog_items
         SET archived = 1, updated_at = ?
         WHERE catalog_id = ? AND archived = 0`
      )
      .run(timestamp, catalogId);
    return readCatalog(catalogId, { includeArchived: true })!;
  });
}

export const deletePreferenceCatalog = archivePreferenceCatalog;

export function restorePreferenceCatalog(catalogId: string): PreferenceCatalog {
  return runInTransaction(() => {
    const current = readCatalog(catalogId, { includeArchived: true });
    if (!current || !current.archived) {
      throw new HttpError(
        404,
        "preferences_catalog_not_archived",
        `Archived preference catalog ${catalogId} was not found.`
      );
    }
    assertCatalogTitleAvailable(current.profileId, current.title, catalogId);
    const itemConflict = getDatabase()
      .prepare(
        `SELECT lower(trim(label)) AS normalized_label,
                GROUP_CONCAT(id) AS item_ids
         FROM preference_catalog_items
         WHERE catalog_id = ?
           AND (
             archived = 0
             OR id IN (
               SELECT catalog_item_id
               FROM preference_catalog_archive_members
               WHERE catalog_id = ?
             )
           )
         GROUP BY lower(trim(label))
         HAVING COUNT(*) > 1
         LIMIT 1`
      )
      .get(catalogId, catalogId) as
      | { normalized_label: string; item_ids: string }
      | undefined;
    if (itemConflict) {
      throw new HttpError(
        409,
        "preferences_catalog_item_restore_conflict",
        "This preference catalog cannot be restored because two retained concepts use the same label.",
        {
          normalizedLabel: itemConflict.normalized_label,
          catalogItemIds: itemConflict.item_ids.split(",")
        }
      );
    }
    const timestamp = nowIso();
    getDatabase()
      .prepare(
        `UPDATE preference_catalogs
         SET archived = 0, updated_at = ?
         WHERE id = ? AND archived = 1`
      )
      .run(timestamp, catalogId);
    getDatabase()
      .prepare(
        `UPDATE preference_catalog_items
         SET archived = 0, updated_at = ?
         WHERE id IN (
           SELECT catalog_item_id
           FROM preference_catalog_archive_members
           WHERE catalog_id = ?
         )`
      )
      .run(timestamp, catalogId);
    getDatabase()
      .prepare(
        `DELETE FROM preference_catalog_archive_members WHERE catalog_id = ?`
      )
      .run(catalogId);
    return readCatalog(catalogId)!;
  });
}

export function hardDeletePreferenceCatalog(
  catalogId: string
): PreferenceCatalog {
  const current = readCatalog(catalogId, { includeArchived: true });
  if (!current) {
    throw new HttpError(
      404,
      "preferences_catalog_not_found",
      `Preference catalog ${catalogId} was not found.`
    );
  }
  runInTransaction(() => {
    getDatabase()
      .prepare(
        `DELETE FROM entity_links
         WHERE (
           source_entity_type = 'preference_catalog_item'
           AND source_entity_id IN (
             SELECT id FROM preference_catalog_items WHERE catalog_id = ?
           )
         ) OR (
           target_entity_type = 'preference_catalog_item'
           AND target_entity_id IN (
             SELECT id FROM preference_catalog_items WHERE catalog_id = ?
           )
         )`
      )
      .run(catalogId, catalogId);
    getDatabase()
      .prepare(
        `DELETE FROM entity_owners
         WHERE entity_type = 'preference_catalog_item'
           AND entity_id IN (
             SELECT id FROM preference_catalog_items WHERE catalog_id = ?
           )`
      )
      .run(catalogId);
    getDatabase()
      .prepare(
        `DELETE FROM entity_links
         WHERE (source_entity_type = 'preference_catalog' AND source_entity_id = ?)
            OR (target_entity_type = 'preference_catalog' AND target_entity_id = ?)`
      )
      .run(catalogId, catalogId);
    getDatabase()
      .prepare(`DELETE FROM preference_catalogs WHERE id = ?`)
      .run(catalogId);
  });
  return current;
}

export function listPreferenceCatalogHardDeleteDescendants(
  catalogId: string
): Array<{ entityType: "preference_catalog_item"; entityId: string }> {
  return (
    getDatabase()
      .prepare(
        `SELECT id
         FROM preference_catalog_items
         WHERE catalog_id = ?
         ORDER BY id ASC`
      )
      .all(catalogId) as Array<{ id: string }>
  ).map((row) => ({
    entityType: "preference_catalog_item",
    entityId: row.id
  }));
}

export function createPreferenceCatalogItem(
  input: CreatePreferenceCatalogItemInput
): PreferenceCatalogItem {
  const parsed = createPreferenceCatalogItemSchema.parse(input);
  return runInTransaction(() => {
    const catalog = getDatabase()
      .prepare(
        `SELECT preference_catalogs.id, preference_profiles.user_id
         FROM preference_catalogs
         INNER JOIN preference_profiles
           ON preference_profiles.id = preference_catalogs.profile_id
         WHERE preference_catalogs.id = ?
           AND preference_catalogs.archived = 0`
      )
      .get(parsed.catalogId) as { id: string; user_id: string } | undefined;
    if (!catalog) {
      throw new HttpError(
        404,
        "preferences_catalog_not_found",
        `Preference catalog ${parsed.catalogId} was not found.`
      );
    }
    assertCatalogItemLabelAvailable(catalog.id, parsed.label);
    const timestamp = nowIso();
    const positionRow = getDatabase()
      .prepare(
        `SELECT COALESCE(MAX(position), -1) AS max_position
         FROM preference_catalog_items
         WHERE catalog_id = ?`
      )
      .get(catalog.id) as { max_position: number };
    const position = parsed.position ?? positionRow.max_position + 1;
    const itemId = `pref_catalog_item_${randomUUID().slice(0, 10)}`;
    getDatabase()
      .prepare(
        `INSERT INTO preference_catalog_items (
           id, catalog_id, label, description, tags_json, feature_weights_json, position, archived, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        itemId,
        catalog.id,
        parsed.label,
        parsed.description,
        JSON.stringify(parsed.tags),
        JSON.stringify(normalizeDimensionVector(parsed.featureWeights)),
        position,
        timestamp,
        timestamp
      );
    setEntityOwner("preference_catalog_item", itemId, catalog.user_id);
    return readCatalogItem(itemId)!;
  });
}

export function updatePreferenceCatalogItem(
  catalogItemId: string,
  patch: UpdatePreferenceCatalogItemInput
): PreferenceCatalogItem {
  const parsed = updatePreferenceCatalogItemSchema.parse(patch);
  return runInTransaction(() => {
    const current = readCatalogItem(catalogItemId);
    if (!current) {
      throw new HttpError(
        404,
        "preferences_catalog_item_not_found",
        `Preference catalog item ${catalogItemId} was not found.`
      );
    }
    const labelChanged =
      parsed.label !== undefined &&
      normalizeCatalogUniqueText(parsed.label) !==
        normalizeCatalogUniqueText(current.label);
    if (labelChanged) {
      assertCatalogItemLabelAvailable(
        current.catalogId,
        parsed.label!,
        catalogItemId
      );
    }
    const timestamp = nowIso();
    const assignments: string[] = [];
    const values: Array<string | number> = [];
    if (labelChanged) {
      assignments.push("label = ?");
      values.push(parsed.label!);
    }
    if (parsed.description !== undefined) {
      assignments.push("description = ?");
      values.push(parsed.description);
    }
    if (parsed.tags !== undefined) {
      assignments.push("tags_json = ?");
      values.push(JSON.stringify(parsed.tags));
    }
    if (parsed.featureWeights !== undefined) {
      assignments.push("feature_weights_json = ?");
      values.push(
        JSON.stringify(normalizeDimensionVector(parsed.featureWeights))
      );
    }
    if (parsed.position !== undefined) {
      assignments.push("position = ?");
      values.push(parsed.position);
    }
    assignments.push("updated_at = ?");
    values.push(timestamp, catalogItemId);
    getDatabase()
      .prepare(
        `UPDATE preference_catalog_items
         SET ${assignments.join(", ")}
         WHERE id = ?`
      )
      .run(...values);
    return readCatalogItem(catalogItemId)!;
  });
}

export function archivePreferenceCatalogItem(
  catalogItemId: string
): PreferenceCatalogItem {
  return runInTransaction(() => {
    const current = readCatalogItem(catalogItemId, true);
    if (!current) {
      throw new HttpError(
        404,
        "preferences_catalog_item_not_found",
        `Preference catalog item ${catalogItemId} was not found.`
      );
    }
    getDatabase()
      .prepare(
        `UPDATE preference_catalog_items
         SET archived = 1, updated_at = ?
         WHERE id = ? AND archived = 0`
      )
      .run(nowIso(), catalogItemId);
    return readCatalogItem(catalogItemId, true)!;
  });
}

export const deletePreferenceCatalogItem = archivePreferenceCatalogItem;

export function restorePreferenceCatalogItem(
  catalogItemId: string
): PreferenceCatalogItem {
  return runInTransaction(() => {
    const current = readCatalogItem(catalogItemId, true);
    if (!current) {
      throw new HttpError(
        404,
        "preferences_catalog_item_not_found",
        `Preference catalog item ${catalogItemId} was not found.`
      );
    }
    const state = getDatabase()
      .prepare(
        `SELECT preference_catalog_items.archived AS item_archived,
                preference_catalogs.archived AS catalog_archived
         FROM preference_catalog_items
         INNER JOIN preference_catalogs
           ON preference_catalogs.id = preference_catalog_items.catalog_id
         WHERE preference_catalog_items.id = ?`
      )
      .get(catalogItemId) as
      | { item_archived: number; catalog_archived: number }
      | undefined;
    if (!state || state.item_archived === 0) {
      return current;
    }
    if (state.catalog_archived === 1) {
      throw new HttpError(
        409,
        "preferences_catalog_item_parent_archived",
        "Restore the preference catalog before restoring this concept."
      );
    }
    assertCatalogItemLabelAvailable(
      current.catalogId,
      current.label,
      catalogItemId
    );
    getDatabase()
      .prepare(
        `UPDATE preference_catalog_items
         SET archived = 0, updated_at = ?
         WHERE id = ? AND archived = 1`
      )
      .run(nowIso(), catalogItemId);
    return readCatalogItem(catalogItemId)!;
  });
}

export function hardDeletePreferenceCatalogItem(
  catalogItemId: string
): PreferenceCatalogItem {
  const current = readCatalogItem(catalogItemId, true);
  if (!current) {
    throw new HttpError(
      404,
      "preferences_catalog_item_not_found",
      `Preference catalog item ${catalogItemId} was not found.`
    );
  }
  runInTransaction(() => {
    getDatabase()
      .prepare(
        `DELETE FROM entity_links
         WHERE (source_entity_type = 'preference_catalog_item' AND source_entity_id = ?)
            OR (target_entity_type = 'preference_catalog_item' AND target_entity_id = ?)`
      )
      .run(catalogItemId, catalogItemId);
    clearEntityOwner("preference_catalog_item", catalogItemId);
    getDatabase()
      .prepare(`DELETE FROM preference_catalog_items WHERE id = ?`)
      .run(catalogItemId);
  });
  return current;
}

export function startPreferenceGame(
  input: StartPreferenceGameInput
): PreferenceWorkspacePayload {
  const parsed = startPreferenceGameSchema.parse(input);
  const profile = ensureProfile(parsed.userId, parsed.domain);
  const selectedContext = resolveContext(profile, parsed.contextId ?? null);

  if (parsed.catalogId) {
    const catalog = readCatalog(parsed.catalogId, { itemLimit: null });
    if (!catalog || catalog.profileId !== profile.id) {
      throw new HttpError(
        404,
        "preferences_catalog_not_found",
        `Preference catalog ${parsed.catalogId} was not found for this profile.`
      );
    }
    const existingItems = listItems(profile.id);
    for (const catalogItem of catalog.items) {
      const matched = existingItems.find((item) => {
        const seedCatalogId =
          typeof item.metadata.seedCatalogId === "string"
            ? item.metadata.seedCatalogId
            : null;
        const seedCatalogItemId =
          typeof item.metadata.seedCatalogItemId === "string"
            ? item.metadata.seedCatalogItemId
            : null;
        return (
          seedCatalogId === catalog.id && seedCatalogItemId === catalogItem.id
        );
      });
      if (matched) {
        updatePreferenceItem(matched.id, {
          label: catalogItem.label,
          description: catalogItem.description,
          tags: catalogItem.tags,
          featureWeights: catalogItem.featureWeights,
          metadata: {
            ...matched.metadata,
            seedCatalogId: catalog.id,
            seedCatalogItemId: catalogItem.id,
            seedCatalogTitle: catalog.title
          }
        });
        upsertPreferenceScoreState(matched.id, selectedContext.id, {
          compareLater: true,
          bookmarked: true
        });
        continue;
      }
      const createdItem = createPreferenceItem({
        userId: parsed.userId,
        domain: parsed.domain,
        label: catalogItem.label,
        description: catalogItem.description,
        tags: catalogItem.tags,
        featureWeights: catalogItem.featureWeights,
        metadata: {
          seedCatalogId: catalog.id,
          seedCatalogItemId: catalogItem.id,
          seedCatalogTitle: catalog.title
        },
        queueForCompare: true
      });
      upsertPreferenceScoreState(createdItem.id, selectedContext.id, {
        compareLater: true,
        bookmarked: true
      });
    }
  }

  return refreshPreferenceWorkspace({
    userId: parsed.userId,
    domain: parsed.domain,
    contextId: selectedContext.id
  });
}

export function createPreferenceContext(
  input: CreatePreferenceContextInput
): PreferenceContext {
  const parsed = createPreferenceContextSchema.parse(input);
  const profile = ensureProfile(parsed.userId, parsed.domain);
  const contextId = `pref_ctx_${randomUUID().slice(0, 10)}`;
  const timestamp = nowIso();
  if (parsed.isDefault && !parsed.active) {
    throw new HttpError(
      400,
      "preferences_default_context_inactive",
      "A default preference context must be active."
    );
  }
  runInTransaction(() => {
    if (parsed.isDefault) {
      getDatabase()
        .prepare(
          `UPDATE preference_contexts
           SET is_default = 0, updated_at = ?
           WHERE profile_id = ?`
        )
        .run(timestamp, profile.id);
    }
    getDatabase()
      .prepare(
        `INSERT INTO preference_contexts (id, profile_id, name, description, share_mode, active, is_default, decay_days, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        contextId,
        profile.id,
        parsed.name,
        parsed.description,
        parsed.shareMode,
        parsed.active ? 1 : 0,
        parsed.isDefault ? 1 : 0,
        parsed.decayDays,
        timestamp,
        timestamp
      );
    setEntityOwner("preference_context", contextId, parsed.userId);
    if (parsed.isDefault) {
      getDatabase()
        .prepare(
          `UPDATE preference_profiles
           SET default_context_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(contextId, timestamp, profile.id);
    }
    recomputeAffectedContexts(profile, contextId);
  });
  return readContext(contextId)!;
}

export function updatePreferenceContext(
  contextId: string,
  patch: UpdatePreferenceContextInput
): PreferenceContext {
  const current = readContext(contextId);
  if (!current) {
    throw new HttpError(
      404,
      "preferences_context_not_found",
      `Preference context ${contextId} was not found.`
    );
  }
  const parsed = updatePreferenceContextSchema.parse(patch);
  const next = {
    name: parsed.name ?? current.name,
    description: parsed.description ?? current.description,
    shareMode: parsed.shareMode ?? current.shareMode,
    active: parsed.active ?? current.active,
    isDefault: parsed.isDefault ?? current.isDefault,
    decayDays: parsed.decayDays ?? current.decayDays
  };
  const profile = getPreferenceProfileById(current.profileId);
  if (!profile) {
    throw new HttpError(
      500,
      "preferences_profile_missing",
      `Preference profile ${current.profileId} was not found.`
    );
  }
  if (next.isDefault && !next.active) {
    throw new HttpError(
      400,
      "preferences_default_context_inactive",
      "A default preference context must be active."
    );
  }
  const effectiveDefault =
    current.isDefault || profile.defaultContextId === contextId;
  const replacementDefault =
    effectiveDefault && (!next.isDefault || !next.active)
      ? selectReplacementDefaultContext(current.profileId, contextId)
      : null;
  if (effectiveDefault && !next.isDefault && !replacementDefault) {
    throw new HttpError(
      400,
      "preferences_context_default_required",
      "A preference profile must keep one active default context."
    );
  }
  const timestamp = nowIso();
  runInTransaction(() => {
    if (next.isDefault) {
      getDatabase()
        .prepare(
          `UPDATE preference_contexts
           SET is_default = 0, updated_at = ?
           WHERE profile_id = ?`
        )
        .run(timestamp, current.profileId);
    }
    getDatabase()
      .prepare(
        `UPDATE preference_contexts
         SET name = ?, description = ?, share_mode = ?, active = ?, is_default = ?, decay_days = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.name,
        next.description,
        next.shareMode,
        next.active ? 1 : 0,
        next.isDefault ? 1 : 0,
        next.decayDays,
        timestamp,
        contextId
      );
    if (next.isDefault) {
      getDatabase()
        .prepare(
          `UPDATE preference_profiles
           SET default_context_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(contextId, timestamp, current.profileId);
    } else if (replacementDefault) {
      setProfileDefaultContext(
        current.profileId,
        replacementDefault.id,
        timestamp
      );
    }
    recomputeAffectedContexts(profile, contextId);
  });
  const updated = readContext(contextId)!;
  return updated;
}

export function deletePreferenceContext(contextId: string): PreferenceContext {
  const current = readContext(contextId);
  if (!current) {
    throw new HttpError(
      404,
      "preferences_context_not_found",
      `Preference context ${contextId} was not found.`
    );
  }
  const remainingContexts = listContexts(current.profileId).filter(
    (entry) => entry.id !== contextId
  );
  if (remainingContexts.length === 0) {
    throw new HttpError(
      400,
      "preferences_context_last_remaining",
      "A preference profile must keep at least one context."
    );
  }
  const replacementDefault =
    selectReplacementDefaultContext(current.profileId, contextId) ??
    remainingContexts[0]!;
  const profile = getPreferenceProfileById(current.profileId);
  const timestamp = nowIso();
  runInTransaction(() => {
    setProfileDefaultContext(
      current.profileId,
      replacementDefault.id,
      timestamp
    );
    clearEntityOwner("preference_context", contextId);
    getDatabase()
      .prepare(
        `DELETE FROM entity_owners
         WHERE entity_type = 'preference_signal'
           AND entity_id IN (
             SELECT id FROM absolute_signals WHERE context_id = ?
           )`
      )
      .run(contextId);
    getDatabase()
      .prepare(`DELETE FROM pairwise_judgments WHERE context_id = ?`)
      .run(contextId);
    getDatabase()
      .prepare(`DELETE FROM absolute_signals WHERE context_id = ?`)
      .run(contextId);
    getDatabase()
      .prepare(`DELETE FROM preference_item_scores WHERE context_id = ?`)
      .run(contextId);
    getDatabase()
      .prepare(
        `DELETE FROM preference_dimension_summaries WHERE context_id = ?`
      )
      .run(contextId);
    getDatabase()
      .prepare(`DELETE FROM preference_snapshots WHERE context_id = ?`)
      .run(contextId);
    getDatabase()
      .prepare(`DELETE FROM preference_contexts WHERE id = ?`)
      .run(contextId);
    if (profile) {
      recomputeAffectedContexts(profile, replacementDefault.id);
    }
  });
  return current;
}

export function mergePreferenceContexts(input: MergePreferenceContextsInput) {
  const parsed = mergePreferenceContextsSchema.parse(input);
  if (parsed.sourceContextId === parsed.targetContextId) {
    throw new HttpError(
      400,
      "preferences_context_merge_same_context",
      "Source and target preference contexts must be different."
    );
  }
  const source = readContext(parsed.sourceContextId);
  const target = readContext(parsed.targetContextId);
  if (!source || !target || source.profileId !== target.profileId) {
    throw new HttpError(
      400,
      "preferences_invalid_context_merge",
      "Preference contexts must exist on the same profile before merging."
    );
  }
  const profile = getPreferenceProfileById(source.profileId);
  const timestamp = nowIso();
  runInTransaction(() => {
    if (source.isDefault || profile?.defaultContextId === source.id) {
      setProfileDefaultContext(source.profileId, target.id, timestamp);
    }
    getDatabase()
      .prepare(
        `UPDATE pairwise_judgments
         SET context_id = ?
         WHERE context_id = ?`
      )
      .run(target.id, source.id);
    getDatabase()
      .prepare(
        `UPDATE absolute_signals
         SET context_id = ?
         WHERE context_id = ?`
      )
      .run(target.id, source.id);
    getDatabase()
      .prepare(
        `DELETE FROM preference_item_scores
         WHERE context_id = ?`
      )
      .run(source.id);
    getDatabase()
      .prepare(
        `DELETE FROM preference_dimension_summaries
         WHERE context_id = ?`
      )
      .run(source.id);
    getDatabase()
      .prepare(
        `UPDATE preference_contexts
         SET active = 0, updated_at = ?
         WHERE id = ?`
      )
      .run(timestamp, source.id);
    if (profile) {
      recomputeAffectedContexts(profile, target.id);
    }
  });
  return {
    target: readContext(target.id)!,
    source: readContext(source.id)!
  };
}

export function createPreferenceItem(
  input: CreatePreferenceItemInput
): PreferenceItem {
  const parsed = createPreferenceItemSchema.parse(input);
  return runInTransaction(() => {
    const profile = ensureProfile(parsed.userId, parsed.domain);
    const itemId = `pref_item_${randomUUID().slice(0, 10)}`;
    const timestamp = nowIso();
    const linkedIdentity =
      parsed.sourceEntityType && parsed.sourceEntityId
        ? {
            entityType: parsed.sourceEntityType,
            entityId: parsed.sourceEntityId
          }
        : null;
    getDatabase()
      .prepare(
        `INSERT INTO preference_items (id, profile_id, label, description, tags_json, feature_weights_json, source_entity_type, source_entity_id, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (profile_id, source_entity_type, source_entity_id)
         WHERE source_entity_type IS NOT NULL AND source_entity_id IS NOT NULL
         DO UPDATE SET updated_at = excluded.updated_at`
      )
      .run(
        itemId,
        profile.id,
        parsed.label,
        parsed.description,
        JSON.stringify(parsed.tags),
        JSON.stringify(normalizeDimensionVector(parsed.featureWeights)),
        linkedIdentity?.entityType ?? null,
        linkedIdentity?.entityId ?? null,
        JSON.stringify(parsed.metadata ?? {}),
        timestamp,
        timestamp
      );
    const storedItem = linkedIdentity
      ? (getDatabase()
          .prepare(
            `SELECT id
             FROM preference_items
             WHERE profile_id = ?
               AND source_entity_type = ?
               AND source_entity_id = ?`
          )
          .get(
            profile.id,
            linkedIdentity.entityType,
            linkedIdentity.entityId
          ) as { id: string })
      : { id: itemId };
    setEntityOwner("preference_item", storedItem.id, parsed.userId);
    replaceEntityLinksForSource({
      sourceEntityType: "preference_item",
      sourceEntityId: storedItem.id,
      links: linkedIdentity
        ? [
            {
              entityType: linkedIdentity.entityType,
              entityId: linkedIdentity.entityId,
              relationship: "source"
            }
          ]
        : []
    });
    const selectedContext = resolveContext(profile, null);
    if (parsed.queueForCompare) {
      upsertPreferenceScoreState(storedItem.id, selectedContext.id, {
        compareLater: true,
        bookmarked: true
      });
    }
    recomputeAffectedContexts(profile, selectedContext.id);
    return getItemById(storedItem.id)!;
  });
}

function upsertPreferenceScoreState(
  itemId: string,
  contextId: string,
  patch: Partial<{
    manualStatus: PreferenceItemStatus | null;
    manualScore: number | null;
    confidenceLock: number | null;
    bookmarked: boolean;
    compareLater: boolean;
    frozen: boolean;
  }>
) {
  const item = getItemById(itemId);
  if (!item) {
    throw new HttpError(
      404,
      "preferences_item_not_found",
      `Preference item ${itemId} was not found.`
    );
  }
  const profile = getPreferenceProfileById(item.profileId);
  const context = readContext(contextId);
  if (!profile || !context || context.profileId !== profile.id) {
    throw new HttpError(
      400,
      "preferences_invalid_score_context",
      "Preference score context is invalid for this item."
    );
  }
  const existing = listStoredScores(contextId).find(
    (score) => score.item_id === itemId
  );
  const timestamp = nowIso();
  if (!existing) {
    getDatabase()
      .prepare(
        `INSERT INTO preference_item_scores (
           id, profile_id, context_id, item_id, latent_score, confidence, uncertainty, evidence_count, pairwise_wins, pairwise_losses, pairwise_ties, signal_count, conflict_count, status, dominant_dimensions_json, explanation_json, manual_status, manual_score, confidence_lock, bookmarked, compare_later, frozen, last_inferred_at, last_judgment_at, updated_at
         ) VALUES (?, ?, ?, ?, 0, 0, 1, 0, 0, 0, 0, 0, 0, 'uncertain', '[]', '[]', ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        `pref_score_${randomUUID().slice(0, 10)}`,
        profile.id,
        contextId,
        itemId,
        patch.manualStatus ?? null,
        patch.manualScore ?? null,
        patch.confidenceLock ?? null,
        patch.bookmarked ? 1 : 0,
        patch.compareLater ? 1 : 0,
        patch.frozen ? 1 : 0,
        timestamp,
        timestamp
      );
    return;
  }
  getDatabase()
    .prepare(
      `UPDATE preference_item_scores
       SET manual_status = ?, manual_score = ?, confidence_lock = ?, bookmarked = ?, compare_later = ?, frozen = ?, updated_at = ?
       WHERE context_id = ? AND item_id = ?`
    )
    .run(
      patch.manualStatus !== undefined
        ? patch.manualStatus
        : existing.manual_status,
      patch.manualScore !== undefined
        ? patch.manualScore
        : existing.manual_score,
      patch.confidenceLock !== undefined
        ? patch.confidenceLock
        : existing.confidence_lock,
      (patch.bookmarked ?? existing.bookmarked === 1) ? 1 : 0,
      (patch.compareLater ?? existing.compare_later === 1) ? 1 : 0,
      (patch.frozen ?? existing.frozen === 1) ? 1 : 0,
      timestamp,
      contextId,
      itemId
    );
}

export function updatePreferenceItem(
  itemId: string,
  patch: UpdatePreferenceItemInput
): PreferenceItem {
  return runInTransaction(() => {
    const item = getItemById(itemId);
    if (!item) {
      throw new HttpError(
        404,
        "preferences_item_not_found",
        `Preference item ${itemId} was not found.`
      );
    }
    const parsed = updatePreferenceItemSchema.parse(patch);
    const next = {
      label: parsed.label ?? item.label,
      description: parsed.description ?? item.description,
      tags: parsed.tags ?? item.tags,
      featureWeights:
        parsed.featureWeights !== undefined
          ? normalizeDimensionVector(parsed.featureWeights)
          : item.featureWeights,
      sourceEntityType:
        parsed.sourceEntityType !== undefined
          ? parsed.sourceEntityType
          : (item.sourceEntityType ?? null),
      sourceEntityId:
        parsed.sourceEntityId !== undefined
          ? parsed.sourceEntityId
          : (item.sourceEntityId ?? null),
      metadata:
        parsed.metadata !== undefined
          ? (parsed.metadata as Record<string, unknown>)
          : item.metadata
    };
    if (Boolean(next.sourceEntityType) !== Boolean(next.sourceEntityId)) {
      throw new HttpError(
        400,
        "preferences_invalid_linked_identity",
        "A preference linked identity requires both sourceEntityType and sourceEntityId."
      );
    }
    if (next.sourceEntityType && next.sourceEntityId) {
      const identityOwner = getDatabase()
        .prepare(
          `SELECT id
         FROM preference_items
         WHERE profile_id = ?
           AND source_entity_type = ?
           AND source_entity_id = ?
           AND id <> ?`
        )
        .get(
          item.profileId,
          next.sourceEntityType,
          next.sourceEntityId,
          itemId
        ) as { id: string } | undefined;
      if (identityOwner) {
        throw new HttpError(
          409,
          "preferences_linked_identity_conflict",
          "This Forge entity is already represented by another preference item in the selected profile."
        );
      }
    }
    const timestamp = nowIso();
    getDatabase()
      .prepare(
        `UPDATE preference_items
       SET label = ?, description = ?, tags_json = ?, feature_weights_json = ?, source_entity_type = ?, source_entity_id = ?, metadata_json = ?, updated_at = ?
       WHERE id = ?`
      )
      .run(
        next.label,
        next.description,
        JSON.stringify(next.tags),
        JSON.stringify(next.featureWeights),
        next.sourceEntityType,
        next.sourceEntityId,
        JSON.stringify(next.metadata ?? {}),
        timestamp,
        itemId
      );
    replaceEntityLinksForSource({
      sourceEntityType: "preference_item",
      sourceEntityId: itemId,
      links:
        next.sourceEntityType && next.sourceEntityId
          ? [
              {
                entityType: next.sourceEntityType,
                entityId: next.sourceEntityId,
                relationship: "source"
              }
            ]
          : []
    });
    const updated = getItemById(itemId)!;
    const profile = getPreferenceProfileById(item.profileId);
    if (profile) {
      recomputeAffectedContexts(profile, null);
    }
    return updated;
  });
}

export function deletePreferenceItem(itemId: string): PreferenceItem {
  const current = getItemById(itemId);
  if (!current) {
    throw new HttpError(
      404,
      "preferences_item_not_found",
      `Preference item ${itemId} was not found.`
    );
  }
  runInTransaction(() => {
    deleteEntityLinksForEntity("preference_item", itemId);
    clearEntityOwner("preference_item", itemId);
    getDatabase()
      .prepare(
        `DELETE FROM entity_owners
         WHERE entity_type = 'preference_signal'
           AND entity_id IN (
             SELECT id FROM absolute_signals WHERE item_id = ?
           )`
      )
      .run(itemId);
    getDatabase()
      .prepare(
        `DELETE FROM pairwise_judgments
         WHERE left_item_id = ? OR right_item_id = ?`
      )
      .run(itemId, itemId);
    getDatabase()
      .prepare(`DELETE FROM absolute_signals WHERE item_id = ?`)
      .run(itemId);
    getDatabase()
      .prepare(`DELETE FROM preference_item_scores WHERE item_id = ?`)
      .run(itemId);
    getDatabase()
      .prepare(`DELETE FROM preference_items WHERE id = ?`)
      .run(itemId);
    const profile = getPreferenceProfileById(current.profileId);
    if (profile) {
      recomputeAffectedContexts(profile, null);
    }
  });
  return current;
}

export function createPreferenceItemFromEntity(
  input: EnqueueEntityPreferenceItemInput
): PreferenceItem {
  const parsed = enqueueEntityPreferenceItemSchema.parse(input);
  const source = resolveSourceEntity(parsed.entityType, parsed.entityId);
  if (!source) {
    throw new HttpError(
      404,
      "preferences_source_entity_not_found",
      "Preference source entity not found."
    );
  }
  return createPreferenceItem({
    userId: parsed.userId,
    domain: parsed.domain,
    label: parsed.label?.trim() || source.label,
    description: parsed.description?.trim() || source.description,
    tags: parsed.tags,
    sourceEntityType: parsed.entityType,
    sourceEntityId: parsed.entityId,
    metadata: { seededFromEntity: true },
    queueForCompare: true,
    featureWeights: DEFAULT_DIMENSIONS
  });
}

export function submitPairwiseJudgment(
  input: SubmitPairwiseJudgmentInput,
  mutationContext: PreferenceMutationContext = { source: "ui", actor: null },
  idempotencyKey?: string | null
): PairwiseJudgment {
  const parsed = submitPairwiseJudgmentSchema.parse(input);
  return runInTransaction(() => {
    const fingerprint = judgmentFingerprint(parsed);
    if (idempotencyKey) {
      const receipt = getDatabase()
        .prepare(
          `SELECT request_fingerprint, judgment_id
           FROM preference_judgment_receipts
           WHERE user_id = ? AND idempotency_key = ?`
        )
        .get(parsed.userId, idempotencyKey) as
        | { request_fingerprint: string; judgment_id: string }
        | undefined;
      if (receipt) {
        if (receipt.request_fingerprint !== fingerprint) {
          throw new HttpError(
            409,
            "idempotency_conflict",
            "This idempotency key was already used with a different preference judgment payload."
          );
        }
        const replay = getDatabase()
          .prepare(
            `SELECT id, profile_id, context_id, user_id, left_item_id,
                    right_item_id, outcome, strength, response_time_ms, source,
                    reason_tags_json, created_at
             FROM pairwise_judgments
             WHERE id = ?`
          )
          .get(receipt.judgment_id) as JudgmentRow | undefined;
        if (!replay) {
          throw new HttpError(
            500,
            "idempotency_corruption",
            "The preference judgment recorded for this idempotency key is missing."
          );
        }
        return mapJudgment(replay);
      }
    }

    const profile = ensureProfile(parsed.userId, parsed.domain);
    const context = readContext(parsed.contextId);
    if (!context || context.profileId !== profile.id) {
      throw new HttpError(
        400,
        "preferences_invalid_context",
        "Preference judgment context does not belong to the selected profile."
      );
    }
    if (parsed.leftItemId === parsed.rightItemId) {
      throw new HttpError(
        400,
        "preferences_invalid_pair",
        "Preference comparisons require two distinct items."
      );
    }
    const leftItem = getItemById(parsed.leftItemId);
    const rightItem = getItemById(parsed.rightItemId);
    if (!leftItem || !rightItem) {
      throw new HttpError(
        404,
        "preferences_item_not_found",
        "One or both preference items do not exist."
      );
    }
    if (
      leftItem.profileId !== profile.id ||
      rightItem.profileId !== profile.id
    ) {
      throw new HttpError(
        400,
        "preferences_invalid_judgment_item",
        "Preference judgment items must belong to the selected profile."
      );
    }
    const judgmentId = `pref_judgment_${randomUUID().slice(0, 10)}`;
    const timestamp = nowIso();
    getDatabase()
      .prepare(
        `INSERT INTO pairwise_judgments (id, profile_id, context_id, user_id, left_item_id, right_item_id, outcome, strength, response_time_ms, source, reason_tags_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        judgmentId,
        profile.id,
        context.id,
        parsed.userId,
        parsed.leftItemId,
        parsed.rightItemId,
        parsed.outcome,
        parsed.strength,
        parsed.responseTimeMs ?? null,
        mutationContext.source,
        JSON.stringify(parsed.reasonTags),
        timestamp
      );
    recordActivityEvent({
      entityType: "preference_item",
      entityId:
        parsed.outcome === "right" ? parsed.rightItemId : parsed.leftItemId,
      eventType: "preference_judgment_recorded",
      title: `Preference comparison recorded as ${parsed.outcome}`,
      description: `Comparison recorded in ${context.name}.`,
      actor: mutationContext.actor ?? null,
      source: mutationContext.source,
      metadata: {
        judgmentId,
        contextId: context.id,
        leftItemId: parsed.leftItemId,
        rightItemId: parsed.rightItemId,
        outcome: parsed.outcome,
        strength: parsed.strength,
        ownerUserId: parsed.userId
      }
    });
    recomputeAffectedContexts(profile, context.id, mutationContext);
    if (idempotencyKey) {
      getDatabase()
        .prepare(
          `INSERT INTO preference_judgment_receipts (
             user_id, idempotency_key, request_fingerprint, judgment_id, created_at
           ) VALUES (?, ?, ?, ?, ?)`
        )
        .run(parsed.userId, idempotencyKey, fingerprint, judgmentId, timestamp);
    }
    return mapJudgment(
      getDatabase()
        .prepare(
          `SELECT id, profile_id, context_id, user_id, left_item_id,
                  right_item_id, outcome, strength, response_time_ms, source,
                  reason_tags_json, created_at
           FROM pairwise_judgments
           WHERE id = ?`
        )
        .get(judgmentId) as JudgmentRow
    );
  });
}

function readSignalById(signalId: string): SignalRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT
         signal.id,
         signal.profile_id,
         signal.context_id,
         signal.user_id,
         signal.item_id,
         signal.signal_type,
         signal.strength,
         signal.source,
         signal.created_at,
         (
           SELECT activity_events.actor
           FROM activity_events
           WHERE activity_events.entity_type = 'preference_item'
             AND activity_events.entity_id = signal.item_id
             AND json_extract(activity_events.metadata_json, '$.signalId') = signal.id
           ORDER BY activity_events.created_at DESC
           LIMIT 1
         ) AS actor
       FROM absolute_signals AS signal
       WHERE signal.id = ?`
    )
    .get(signalId) as SignalRow | undefined;
}

export type PreferenceSignalSubmissionResult = {
  signal: AbsoluteSignal;
  replayed: boolean;
};

export function submitAbsoluteSignalWithReceipt(
  input: SubmitAbsoluteSignalInput,
  mutationContext: PreferenceMutationContext = { source: "ui", actor: null },
  idempotencyKey?: string | null
): PreferenceSignalSubmissionResult {
  const parsed = submitAbsoluteSignalSchema.parse(input);
  return runInTransaction(() => {
    const fingerprint = signalFingerprint(parsed);
    if (idempotencyKey) {
      const receipt = getDatabase()
        .prepare(
          `SELECT request_fingerprint, signal_id
           FROM preference_signal_receipts
           WHERE user_id = ? AND idempotency_key = ?`
        )
        .get(parsed.userId, idempotencyKey) as
        | { request_fingerprint: string; signal_id: string }
        | undefined;
      if (receipt) {
        if (receipt.request_fingerprint !== fingerprint) {
          throw new HttpError(
            409,
            "idempotency_conflict",
            "This idempotency key was already used with a different preference signal payload."
          );
        }
        const replay = readSignalById(receipt.signal_id);
        if (!replay) {
          throw new HttpError(
            409,
            "preferences_signal_idempotency_target_missing",
            "The preference signal recorded for this idempotency key is no longer available."
          );
        }
        return { signal: mapSignal(replay), replayed: true };
      }
    }

    const profile = ensureProfile(parsed.userId, parsed.domain);
    const context = readContext(parsed.contextId);
    if (!context || context.profileId !== profile.id) {
      throw new HttpError(
        400,
        "preferences_invalid_context",
        "Preference signal context does not belong to the selected profile."
      );
    }
    const item = getItemById(parsed.itemId);
    if (!item) {
      throw new HttpError(
        404,
        "preferences_item_not_found",
        `Preference item ${parsed.itemId} was not found.`
      );
    }
    if (item.profileId !== profile.id) {
      throw new HttpError(
        400,
        "preferences_invalid_signal_item",
        "Preference signal item does not belong to the selected profile."
      );
    }

    const previous = getDatabase()
      .prepare(
        `SELECT
           signal.id,
           signal.profile_id,
           signal.context_id,
           signal.user_id,
           signal.item_id,
           signal.signal_type,
           signal.strength,
           signal.source,
           signal.created_at,
           (
             SELECT activity_events.actor
             FROM activity_events
             WHERE activity_events.entity_type = 'preference_item'
               AND activity_events.entity_id = signal.item_id
               AND json_extract(activity_events.metadata_json, '$.signalId') = signal.id
             ORDER BY activity_events.created_at DESC
             LIMIT 1
           ) AS actor
         FROM absolute_signals AS signal
         WHERE signal.profile_id = ? AND signal.context_id = ? AND signal.item_id = ?
         ORDER BY signal.created_at DESC, signal.rowid DESC
         LIMIT 1`
      )
      .get(profile.id, context.id, item.id) as SignalRow | undefined;
    if (
      previous &&
      previous.signal_type === parsed.signalType &&
      previous.strength === parsed.strength &&
      previous.source === mutationContext.source &&
      previous.actor === (mutationContext.actor ?? null)
    ) {
      setEntityOwner("preference_signal", previous.id, parsed.userId);
      if (idempotencyKey) {
        getDatabase()
          .prepare(
            `INSERT INTO preference_signal_receipts (
               user_id, idempotency_key, request_fingerprint, signal_id, created_at
             ) VALUES (?, ?, ?, ?, ?)`
          )
          .run(
            parsed.userId,
            idempotencyKey,
            fingerprint,
            previous.id,
            nowIso()
          );
      }
      return { signal: mapSignal(previous), replayed: false };
    }

    const signalId = `pref_signal_${randomUUID().slice(0, 10)}`;
    const timestamp = nowIso();
    getDatabase()
      .prepare(
        `INSERT INTO absolute_signals (id, profile_id, context_id, user_id, item_id, signal_type, strength, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        signalId,
        profile.id,
        context.id,
        parsed.userId,
        item.id,
        parsed.signalType,
        parsed.strength,
        mutationContext.source,
        timestamp
      );
    setEntityOwner("preference_signal", signalId, parsed.userId);
    recordActivityEvent({
      entityType: "preference_item",
      entityId: item.id,
      eventType: previous
        ? "preference_signal_replaced"
        : "preference_signal_recorded",
      title: previous
        ? `Preference signal replaced with ${parsed.signalType.replaceAll("_", " ")}`
        : `Preference signal recorded as ${parsed.signalType.replaceAll("_", " ")}`,
      description: `Direct signal for ${item.label} in ${context.name}.`,
      actor: mutationContext.actor ?? null,
      source: mutationContext.source,
      metadata: {
        signalId,
        previousSignalId: previous?.id ?? null,
        previousSignalType: previous?.signal_type ?? null,
        signalType: parsed.signalType,
        strength: parsed.strength,
        modelWeight:
          PREFERENCE_SIGNAL_MODEL_WEIGHTS[parsed.signalType] * parsed.strength,
        contextId: context.id,
        ownerUserId: parsed.userId
      }
    });
    recomputeAffectedContexts(profile, context.id, mutationContext);
    if (idempotencyKey) {
      getDatabase()
        .prepare(
          `INSERT INTO preference_signal_receipts (
             user_id, idempotency_key, request_fingerprint, signal_id, created_at
           ) VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          parsed.userId,
          idempotencyKey,
          fingerprint,
          signalId,
          timestamp
        );
    }
    return {
      signal: mapSignal({
        id: signalId,
        profile_id: profile.id,
        context_id: context.id,
        user_id: parsed.userId,
        item_id: item.id,
        signal_type: parsed.signalType,
        strength: parsed.strength,
        source: mutationContext.source,
        actor: mutationContext.actor ?? null,
        created_at: timestamp
      }),
      replayed: false
    };
  });
}

export function submitAbsoluteSignal(
  input: SubmitAbsoluteSignalInput,
  mutationContext: PreferenceMutationContext = { source: "ui", actor: null },
  idempotencyKey?: string | null
): AbsoluteSignal {
  return submitAbsoluteSignalWithReceipt(
    input,
    mutationContext,
    idempotencyKey
  ).signal;
}

export function updatePreferenceScore(
  itemId: string,
  input: UpdatePreferenceScoreInput,
  mutationContext: PreferenceMutationContext = {
    source: "system",
    actor: null
  }
): PreferenceWorkspacePayload {
  const parsed = updatePreferenceScoreSchema.parse(input);
  const profile = ensureProfile(parsed.userId, parsed.domain);
  const context = readContext(parsed.contextId);
  if (!context || context.profileId !== profile.id) {
    throw new HttpError(
      400,
      "preferences_invalid_context",
      "Preference score context does not belong to the selected profile."
    );
  }
  return runInTransaction(() => {
    upsertPreferenceScoreState(itemId, context.id, {
      manualStatus:
        parsed.manualStatus !== undefined
          ? (parsed.manualStatus ?? null)
          : undefined,
      manualScore:
        parsed.manualScore !== undefined
          ? (parsed.manualScore ?? null)
          : undefined,
      confidenceLock:
        parsed.confidenceLock !== undefined
          ? (parsed.confidenceLock ?? null)
          : undefined,
      bookmarked: parsed.bookmarked,
      compareLater: parsed.compareLater,
      frozen: parsed.frozen
    });
    recomputeContext(profile, context, mutationContext);
    return getPreferenceWorkspace({
      userId: parsed.userId,
      domain: parsed.domain,
      contextId: context.id
    });
  });
}
