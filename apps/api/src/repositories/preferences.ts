import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import {
  absoluteSignalSchema,
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
import { getUserById, getDefaultUser } from "./users.js";
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
import type { CrudEntityType } from "../types.js";

const PREFERENCE_MODEL_VERSION = "pref-v1-bt-lite";
const DEFAULT_PREFERENCE_DOMAIN: PreferenceDomain = "projects";
const DIMENSION_IDS = preferenceDimensionIdSchema.options;

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
  domain: PreferenceDomain;
  slug: string;
  title: string;
  description: string;
  source: PreferenceCatalogSource;
  archived: number;
  created_at: string;
  updated_at: string;
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

const SIGNAL_WEIGHTS: Record<AbsoluteSignal["signalType"], number> = {
  favorite: 1.25,
  veto: -1.6,
  must_have: 1.5,
  bookmark: 0.35,
  neutral: 0,
  compare_later: 0.2
};

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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapCatalog(
  row: CatalogRow,
  items: PreferenceCatalogItem[]
): PreferenceCatalog {
  return preferenceCatalogSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    domain: row.domain,
    slug: row.slug,
    title: row.title,
    description: row.description,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items
  });
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
    itemId: row.item_id,
    signalType: row.signal_type,
    strength: row.strength,
    source: row.source,
    createdAt: row.created_at
  });
}

function mapScore(row: ScoreRow, item: PreferenceItem): PreferenceItemScore {
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

function readProfileById(profileId: string): PreferenceProfile | null {
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
        `SELECT id, profile_id, domain, slug, title, description, source, archived, created_at, updated_at
         FROM preference_catalogs
         WHERE profile_id = ? AND archived = 0
         ORDER BY source ASC, title ASC`
      )
      .all(profileId) as CatalogRow[]
  ).filter((row) => row.archived === 0);

  const itemRows = (
    getDatabase()
      .prepare(
        `SELECT id, catalog_id, label, description, tags_json, feature_weights_json, position, archived, created_at, updated_at
         FROM preference_catalog_items
         WHERE catalog_id IN (
           SELECT id FROM preference_catalogs WHERE profile_id = ? AND archived = 0
         )
           AND archived = 0
         ORDER BY position ASC, label ASC`
      )
      .all(profileId) as CatalogItemRow[]
  ).filter((row) => row.archived === 0);

  const itemsByCatalogId = new Map<string, PreferenceCatalogItem[]>();
  for (const row of itemRows) {
    const list = itemsByCatalogId.get(row.catalog_id) ?? [];
    list.push(mapCatalogItem(row));
    itemsByCatalogId.set(row.catalog_id, list);
  }

  return catalogRows.map((row) =>
    mapCatalog(row, itemsByCatalogId.get(row.id) ?? [])
  );
}

function readCatalog(catalogId: string): PreferenceCatalog | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, profile_id, domain, slug, title, description, source, archived, created_at, updated_at
       FROM preference_catalogs
       WHERE id = ?`
    )
    .get(catalogId) as CatalogRow | undefined;
  if (!row || row.archived === 1) {
    return null;
  }
  const items = (
    getDatabase()
      .prepare(
        `SELECT id, catalog_id, label, description, tags_json, feature_weights_json, position, archived, created_at, updated_at
         FROM preference_catalog_items
         WHERE catalog_id = ? AND archived = 0
         ORDER BY position ASC, label ASC`
      )
      .all(catalogId) as CatalogItemRow[]
  )
    .filter((entry) => entry.archived === 0)
    .map(mapCatalogItem);
  return mapCatalog(row, items);
}

function readCatalogItem(catalogItemId: string): PreferenceCatalogItem | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, catalog_id, label, description, tags_json, feature_weights_json, position, archived, created_at, updated_at
       FROM preference_catalog_items
       WHERE id = ?`
    )
    .get(catalogItemId) as CatalogItemRow | undefined;
  return row && row.archived === 0 ? mapCatalogItem(row) : null;
}

function listJudgmentsForContexts(contextIds: string[]): PairwiseJudgment[] {
  if (contextIds.length === 0) {
    return [];
  }
  const placeholders = contextIds.map(() => "?").join(", ");
  return (
    getDatabase()
      .prepare(
        `SELECT id, profile_id, context_id, user_id, left_item_id, right_item_id, outcome, strength, response_time_ms, source, reason_tags_json, created_at
         FROM pairwise_judgments
         WHERE context_id IN (${placeholders})
         ORDER BY created_at DESC`
      )
      .all(...contextIds) as JudgmentRow[]
  ).map(mapJudgment);
}

function listSignalsForContexts(contextIds: string[]): AbsoluteSignal[] {
  if (contextIds.length === 0) {
    return [];
  }
  const placeholders = contextIds.map(() => "?").join(", ");
  return (
    getDatabase()
      .prepare(
        `SELECT id, profile_id, context_id, user_id, item_id, signal_type, strength, source, created_at
         FROM absolute_signals
         WHERE context_id IN (${placeholders})
         ORDER BY created_at DESC`
      )
      .all(...contextIds) as SignalRow[]
  ).map(mapSignal);
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

export function listPreferenceContexts(): PreferenceContext[] {
  return (getDatabase()
    .prepare(
      `SELECT id, profile_id, name, description, share_mode, active, is_default, decay_days, created_at, updated_at
       FROM preference_contexts
       ORDER BY created_at ASC`
    )
    .all() as ContextRow[]).map(mapContext);
}

export function getPreferenceContextById(contextId: string): PreferenceContext | undefined {
  return readContext(contextId) ?? undefined;
}

export function listPreferenceItems(): PreferenceItem[] {
  return (getDatabase()
    .prepare(
      `SELECT id, profile_id, label, description, tags_json, feature_weights_json, source_entity_type, source_entity_id, metadata_json, created_at, updated_at
       FROM preference_items
       ORDER BY created_at ASC`
    )
    .all() as ItemRow[]).map(mapItem);
}

export function getPreferenceItemById(itemId: string): PreferenceItem | undefined {
  return getItemById(itemId) ?? undefined;
}

export function listPreferenceCatalogs(): PreferenceCatalog[] {
  return (getDatabase()
    .prepare(
      `SELECT id, profile_id, domain, slug, title, description, source, archived, created_at, updated_at
       FROM preference_catalogs
       WHERE archived = 0
       ORDER BY created_at ASC`
    )
    .all() as CatalogRow[])
    .filter((row) => row.archived === 0)
    .map((row) => readCatalog(row.id))
    .filter((catalog): catalog is PreferenceCatalog => catalog !== null);
}

export function getPreferenceCatalogById(catalogId: string): PreferenceCatalog | undefined {
  return readCatalog(catalogId) ?? undefined;
}

export function listPreferenceCatalogItems(): PreferenceCatalogItem[] {
  return (getDatabase()
    .prepare(
      `SELECT id, catalog_id, label, description, tags_json, feature_weights_json, position, archived, created_at, updated_at
       FROM preference_catalog_items
       WHERE archived = 0
       ORDER BY catalog_id ASC, position ASC, created_at ASC`
    )
    .all() as CatalogItemRow[])
    .filter((row) => row.archived === 0)
    .map(mapCatalogItem);
}

export function getPreferenceCatalogItemById(
  catalogItemId: string
): PreferenceCatalogItem | undefined {
  return readCatalogItem(catalogItemId) ?? undefined;
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
      return habit ? { label: habit.title, description: habit.description } : null;
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
      return event ? { label: event.title, description: event.description } : null;
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
    return readProfileById(existing.id) ?? existing;
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
  const created = readProfileById(profileId);
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
  const now = nowIso();
  const database = getDatabase();
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
  }
  const defaultContextId = insertedContextIds[0] ?? null;
  database
    .prepare(
      `UPDATE preference_profiles
       SET default_context_id = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(defaultContextId, now, profileId);
}

function createSeededCatalogs(profileId: string, domain: PreferenceDomain) {
  const seeds = getPreferenceCatalogSeeds(domain);
  if (seeds.length === 0) {
    return;
  }
  const database = getDatabase();
  const now = nowIso();
  for (const seed of seeds) {
    const catalogId = `pref_catalog_${randomUUID().slice(0, 10)}`;
    database
      .prepare(
        `INSERT INTO preference_catalogs (
           id, profile_id, domain, slug, title, description, source, archived, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
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
    seed.items.forEach((seedItem, index) => {
      database
        .prepare(
          `INSERT INTO preference_catalog_items (
             id, catalog_id, label, description, tags_json, feature_weights_json, position, archived, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(
          `pref_catalog_item_${randomUUID().slice(0, 10)}`,
          catalogId,
          seedItem.label,
          seedItem.description,
          JSON.stringify(seedItem.tags),
          JSON.stringify(seedItem.featureWeights),
          index,
          now,
          now
        );
    });
  }
}

function ensureCatalogs(profileId: string, domain: PreferenceDomain) {
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
  signals: Array<AbsoluteSignal["signalType"]>;
}): PreferenceItemStatus {
  const { manualStatus, score, confidence, bookmarked, compareLater, signals } =
    options;
  if (manualStatus) {
    return manualStatus;
  }
  if (signals.includes("veto")) {
    return "vetoed";
  }
  if (signals.includes("must_have")) {
    return "must_have";
  }
  if (signals.includes("favorite")) {
    return "favorite";
  }
  if (bookmarked || compareLater || signals.includes("bookmark")) {
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
    const item = itemsById.get(signal.itemId);
    const factor = evidenceFactors.get(signal.contextId) ?? 0;
    if (!item || factor <= 0) {
      continue;
    }
    const weight =
      SIGNAL_WEIGHTS[signal.signalType] *
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
    confidence: clamp(
      1 - Math.exp(-(counts.get(dimensionId) ?? 0) / 3),
      0,
      1
    ),
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
    profile,
    contexts,
    selectedContext,
    items,
    judgments,
    signals,
    existingScores
  } = options;
  const itemsById = new Map(items.map((item) => [item.id, item] as const));
  const evidenceFactors = buildEvidenceFactorMap(contexts, selectedContext);
  const dimensionSummaries = computeDimensionSummaries({
    contexts,
    selectedContext,
    itemsById,
    judgments,
    signals
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
      signals: AbsoluteSignal["signalType"][];
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
  const pairDirections = new Map<string, { leftWins: number; rightWins: number }>();

  for (const signal of signals) {
    const itemStats = perItem.get(signal.itemId);
    const factor = evidenceFactors.get(signal.contextId) ?? 0;
    if (!itemStats || factor <= 0) {
      continue;
    }
    const weight =
      SIGNAL_WEIGHTS[signal.signalType] *
      signal.strength *
      factor *
      timeDecay(ageInDays(signal.createdAt), selectedContext.decayDays);
    itemStats.raw += weight;
    itemStats.signalCount += 1;
    itemStats.evidenceCount += 1;
    itemStats.signals.push(signal.signalType);
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
    const pairKey = [judgment.leftItemId, judgment.rightItemId].sort().join("::");
    const pairState = pairDirections.get(pairKey) ?? { leftWins: 0, rightWins: 0 };
    if (judgment.outcome === "left") {
      leftStats.raw += weight;
      rightStats.raw -= weight;
      leftStats.wins += 1;
      rightStats.losses += 1;
      pairState.leftWins += 1;
    } else if (judgment.outcome === "right") {
      leftStats.raw -= weight;
      rightStats.raw += weight;
      leftStats.losses += 1;
      rightStats.wins += 1;
      pairState.rightWins += 1;
    } else {
      leftStats.ties += 1;
      rightStats.ties += 1;
    }
    pairDirections.set(pairKey, pairState);
    leftStats.evidenceCount += 1;
    rightStats.evidenceCount += 1;
    leftStats.lastJudgmentAt =
      !leftStats.lastJudgmentAt || judgment.createdAt > leftStats.lastJudgmentAt
        ? judgment.createdAt
        : leftStats.lastJudgmentAt;
    rightStats.lastJudgmentAt =
      !rightStats.lastJudgmentAt || judgment.createdAt > rightStats.lastJudgmentAt
        ? judgment.createdAt
        : rightStats.lastJudgmentAt;
    leftStats.lastEvidenceAt =
      !leftStats.lastEvidenceAt || judgment.createdAt > leftStats.lastEvidenceAt
        ? judgment.createdAt
        : leftStats.lastEvidenceAt;
    rightStats.lastEvidenceAt =
      !rightStats.lastEvidenceAt || judgment.createdAt > rightStats.lastEvidenceAt
        ? judgment.createdAt
        : rightStats.lastEvidenceAt;
  }

  const conflictCountByItem = new Map<string, number>();
  for (const [pairKey, pairState] of pairDirections) {
    if (pairState.leftWins === 0 || pairState.rightWins === 0) {
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
      -Math.max(0, ageInDays(stats.lastEvidenceAt) - selectedContext.decayDays) /
        Math.max(14, selectedContext.decayDays)
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
    const bookmarked =
      (existing?.bookmarked ?? 0) === 1 ||
      stats.signals.includes("bookmark");
    const compareLater =
      (existing?.compare_later ?? 0) === 1 ||
      stats.signals.includes("compare_later");
    const status = deriveStatus({
      manualStatus: existing?.manual_status ?? null,
      score,
      confidence,
      bookmarked,
      compareLater,
      signals: stats.signals
    });
    const explanation = [
      stats.wins > 0 ? `Preferred over peers ${stats.wins} time${stats.wins === 1 ? "" : "s"}.` : null,
      stats.losses > 0 ? `Lost against peers ${stats.losses} time${stats.losses === 1 ? "" : "s"}.` : null,
      stats.signalCount > 0
        ? `Direct signals recorded: ${stats.signals.join(", ")}.`
        : null,
      dominantDimensions.length > 0
        ? `Dominant dimensions: ${dominantDimensions.join(", ")}.`
        : null,
      (conflictCountByItem.get(item.id) ?? 0) > 0
        ? "Conflicting pairwise evidence lowers confidence."
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
      signals
    });
    contextOnlyDimensionsByContext.set(
      context.id,
      new Map(
        isolatedDimensions.map((summary) => [summary.dimensionId, summary.leaning])
      )
    );
  }
  const selectedIsolated =
    contextOnlyDimensionsByContext.get(selectedContext.id) ?? new Map();
  for (const summary of dimensionSummaries) {
    const otherLeanings = [...contextOnlyDimensionsByContext.entries()]
      .filter(([contextId]) => contextId !== selectedContext.id)
      .map(
        ([, leaningByDimension]) => leaningByDimension.get(summary.dimensionId) ?? 0
      );
    const averageOther =
      otherLeanings.length === 0
        ? 0
        : otherLeanings.reduce((sum, value) => sum + value, 0) /
          otherLeanings.length;
    averageSensitivityByDimension.set(
      summary.dimensionId,
      clamp(
        Math.abs((selectedIsolated.get(summary.dimensionId) ?? 0) - averageOther),
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
    const pairKey = [judgment.leftItemId, judgment.rightItemId].sort().join("::");
    const current = pairHistory.get(pairKey) ?? { count: 0, lastCreatedAt: null };
    pairHistory.set(pairKey, {
      count: current.count + 1,
      lastCreatedAt:
        !current.lastCreatedAt || judgment.createdAt > current.lastCreatedAt
          ? judgment.createdAt
          : current.lastCreatedAt
    });
  }
  let best:
    | {
        left: PreferenceItem;
        right: PreferenceItem;
        score: number;
        rationale: string[];
      }
    | null = null;
  for (let index = 0; index < items.length; index += 1) {
    for (let innerIndex = index + 1; innerIndex < items.length; innerIndex += 1) {
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
      const uncertaintyGain = (leftScore.uncertainty + rightScore.uncertainty) / 2;
      const boundaryValue = 1 - Math.min(1, Math.abs(leftScore.latentScore - rightScore.latentScore));
      const diversityBonus = clamp(
        vectorDistance(left.featureWeights, right.featureWeights),
        0,
        1
      );
      const contextNeed =
        (leftScore.evidenceCount + rightScore.evidenceCount) < 6 ? 0.35 : 0.1;
      const driftProbe =
        !history?.lastCreatedAt || ageInDays(history.lastCreatedAt) > 45 ? 0.25 : 0;
      const repetitionPenalty =
        !history
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
  selectedContext: PreferenceContext
) {
  const contexts = listContexts(profile.id);
  const items = listItems(profile.id);
  const judgments = listJudgmentsForContexts(contexts.map((context) => context.id));
  const signals = listSignalsForContexts(contexts.map((context) => context.id));
  const existingScores = listStoredScores(selectedContext.id);
  const { scores, dimensions } = computeScores({
    profile,
    contexts,
    selectedContext,
    items,
    judgments,
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
      dislikedCount: scores.filter((score) => score.status === "disliked").length,
      uncertainCount: scores.filter((score) => score.status === "uncertain").length,
      totalItems: scores.length
    }
  });
  return { items, judgments, signals, contexts, selectedContext, scores, dimensions };
}

function buildWorkspace(
  profile: PreferenceProfile,
  selectedContext: PreferenceContext,
  items: PreferenceItem[],
  judgments: PairwiseJudgment[],
  signals: AbsoluteSignal[],
  scores: ScoreComputation[],
  dimensions: PreferenceDimensionSummary[]
): PreferenceWorkspacePayload {
  const catalogs = listCatalogs(profile.id);
  const storedScores = listStoredScores(selectedContext.id);
  const itemsById = new Map(items.map((item) => [item.id, item] as const));
  const mappedScores = storedScores
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
    map: buildMap(items, scores),
    history: {
      judgments: judgments.filter(
        (judgment) => judgment.contextId === selectedContext.id
      ),
      signals: signals.filter((signal) => signal.contextId === selectedContext.id),
      snapshots,
      staleItemIds,
      flippedItemIds
    },
    compare: {
      nextPair,
      pendingCount: mappedScores.filter(
        (score) => score.uncertainty >= 0.5 || score.compareLater
      ).length,
      candidateCount: items.length
    },
    summary: {
      totalItems: mappedScores.length,
      likedCount: mappedScores.filter((score) => score.status === "liked").length,
      dislikedCount: mappedScores.filter((score) => score.status === "disliked")
        .length,
      uncertainCount: mappedScores.filter((score) => score.status === "uncertain")
        .length,
      bookmarkedCount: mappedScores.filter((score) => score.bookmarked).length,
      vetoedCount: mappedScores.filter((score) => score.status === "vetoed").length,
      averageConfidence:
        mappedScores.length === 0
          ? 0
          : mappedScores.reduce((sum, score) => sum + score.confidence, 0) /
            mappedScores.length,
      pendingComparisons: mappedScores.filter(
        (score) => score.uncertainty >= 0.5 || score.compareLater
      ).length
    },
    libraries: {
      totalCatalogs: catalogs.length,
      totalCatalogItems: catalogs.reduce(
        (sum, catalog) => sum + catalog.items.length,
        0
      ),
      seededCatalogCount: catalogs.filter((catalog) => catalog.source === "seeded")
        .length,
      customCatalogCount: catalogs.filter((catalog) => catalog.source === "custom")
        .length
    }
  });
  return workspace;
}

function resolveWorkspaceQuery(query: PreferenceWorkspaceQuery) {
  const parsed = preferenceWorkspaceQuerySchema.parse(query);
  const userId = parsed.userId ?? getDefaultUser().id;
  const domain = parsed.domain ?? DEFAULT_PREFERENCE_DOMAIN;
  return { userId, domain, contextId: parsed.contextId ?? null };
}

export function getPreferenceWorkspace(
  query: PreferenceWorkspaceQuery
): PreferenceWorkspacePayload {
  const { userId, domain, contextId } = resolveWorkspaceQuery(query);
  const profile = ensureProfile(userId, domain);
  const selectedContext = resolveContext(profile, contextId);
  const recomputed = recomputeContext(profile, selectedContext);
  return buildWorkspace(
    profile,
    selectedContext,
    recomputed.items,
    recomputed.judgments,
    recomputed.signals,
    recomputed.scores,
    recomputed.dimensions
  );
}

export function createPreferenceCatalog(
  input: CreatePreferenceCatalogInput
): PreferenceCatalog {
  const parsed = createPreferenceCatalogSchema.parse(input);
  const profile = ensureProfile(parsed.userId, parsed.domain);
  const timestamp = nowIso();
  const baseSlug = slugify(parsed.slug || parsed.title) || "concept-list";
  const existingSlugs = new Set(listCatalogs(profile.id).map((catalog) => catalog.slug));
  let slug = baseSlug;
  let index = 2;
  while (existingSlugs.has(slug)) {
    slug = `${baseSlug}-${index}`;
    index += 1;
  }
  const catalogId = `pref_catalog_${randomUUID().slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO preference_catalogs (
         id, profile_id, domain, slug, title, description, source, archived, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      catalogId,
      profile.id,
      parsed.domain,
      slug,
      parsed.title,
      parsed.description,
      preferenceCatalogSourceSchema.enum.custom,
      timestamp,
      timestamp
    );
  return readCatalog(catalogId)!;
}

export function updatePreferenceCatalog(
  catalogId: string,
  patch: UpdatePreferenceCatalogInput
): PreferenceCatalog {
  const current = readCatalog(catalogId);
  if (!current) {
    throw new HttpError(
      404,
      "preferences_catalog_not_found",
      `Preference catalog ${catalogId} was not found.`
    );
  }
  const parsed = updatePreferenceCatalogSchema.parse(patch);
  const timestamp = nowIso();
  const nextTitle = parsed.title ?? current.title;
  const desiredSlug = slugify(parsed.slug || nextTitle) || current.slug;
  const siblingSlugs = new Set(
    listCatalogs(current.profileId)
      .filter((catalog) => catalog.id !== current.id)
      .map((catalog) => catalog.slug)
  );
  let nextSlug = desiredSlug;
  let index = 2;
  while (siblingSlugs.has(nextSlug)) {
    nextSlug = `${desiredSlug}-${index}`;
    index += 1;
  }
  getDatabase()
    .prepare(
      `UPDATE preference_catalogs
       SET slug = ?, title = ?, description = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      nextSlug,
      nextTitle,
      parsed.description ?? current.description,
      timestamp,
      catalogId
    );
  return readCatalog(catalogId)!;
}

export function deletePreferenceCatalog(catalogId: string): PreferenceCatalog {
  const current = readCatalog(catalogId);
  if (!current) {
    throw new HttpError(
      404,
      "preferences_catalog_not_found",
      `Preference catalog ${catalogId} was not found.`
    );
  }
  const timestamp = nowIso();
  runInTransaction(() => {
    getDatabase()
      .prepare(
        `UPDATE preference_catalogs
         SET archived = 1, updated_at = ?
         WHERE id = ?`
      )
      .run(timestamp, catalogId);
    getDatabase()
      .prepare(
        `UPDATE preference_catalog_items
         SET archived = 1, updated_at = ?
         WHERE catalog_id = ?`
      )
      .run(timestamp, catalogId);
  });
  return current;
}

export function createPreferenceCatalogItem(
  input: CreatePreferenceCatalogItemInput
): PreferenceCatalogItem {
  const parsed = createPreferenceCatalogItemSchema.parse(input);
  const catalog = readCatalog(parsed.catalogId);
  if (!catalog) {
    throw new HttpError(
      404,
      "preferences_catalog_not_found",
      `Preference catalog ${parsed.catalogId} was not found.`
    );
  }
  const timestamp = nowIso();
  const position =
    parsed.position ??
    (catalog.items.reduce((max, item) => Math.max(max, item.position), -1) + 1);
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
  return readCatalogItem(itemId)!;
}

export function updatePreferenceCatalogItem(
  catalogItemId: string,
  patch: UpdatePreferenceCatalogItemInput
): PreferenceCatalogItem {
  const current = readCatalogItem(catalogItemId);
  if (!current) {
    throw new HttpError(
      404,
      "preferences_catalog_item_not_found",
      `Preference catalog item ${catalogItemId} was not found.`
    );
  }
  const parsed = updatePreferenceCatalogItemSchema.parse(patch);
  const timestamp = nowIso();
  getDatabase()
    .prepare(
      `UPDATE preference_catalog_items
       SET label = ?, description = ?, tags_json = ?, feature_weights_json = ?, position = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      parsed.label ?? current.label,
      parsed.description ?? current.description,
      JSON.stringify(parsed.tags ?? current.tags),
      JSON.stringify(
        parsed.featureWeights !== undefined
          ? normalizeDimensionVector(parsed.featureWeights)
          : current.featureWeights
      ),
      parsed.position ?? current.position,
      timestamp,
      catalogItemId
    );
  return readCatalogItem(catalogItemId)!;
}

export function deletePreferenceCatalogItem(
  catalogItemId: string
): PreferenceCatalogItem {
  const current = readCatalogItem(catalogItemId);
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
       WHERE id = ?`
    )
    .run(nowIso(), catalogItemId);
  return current;
}

export function startPreferenceGame(
  input: StartPreferenceGameInput
): PreferenceWorkspacePayload {
  const parsed = startPreferenceGameSchema.parse(input);
  const profile = ensureProfile(parsed.userId, parsed.domain);
  const selectedContext = resolveContext(profile, parsed.contextId ?? null);

  if (parsed.catalogId) {
    const catalog = readCatalog(parsed.catalogId);
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

  return getPreferenceWorkspace({
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
    if (parsed.isDefault) {
      getDatabase()
        .prepare(
          `UPDATE preference_profiles
           SET default_context_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(contextId, timestamp, profile.id);
    }
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
      getDatabase()
        .prepare(
          `UPDATE preference_profiles
           SET default_context_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(contextId, timestamp, current.profileId);
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
  });
  const profile = readProfileById(current.profileId);
  const updated = readContext(contextId)!;
  if (profile) {
    recomputeContext(profile, updated);
  }
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
    remainingContexts.find((entry) => entry.isDefault) ?? remainingContexts[0]!;
  const timestamp = nowIso();
  runInTransaction(() => {
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
      .prepare(`DELETE FROM preference_dimension_summaries WHERE context_id = ?`)
      .run(contextId);
    getDatabase()
      .prepare(`DELETE FROM preference_snapshots WHERE context_id = ?`)
      .run(contextId);
    getDatabase()
      .prepare(`DELETE FROM preference_contexts WHERE id = ?`)
      .run(contextId);
    if (current.isDefault) {
      getDatabase()
        .prepare(
          `UPDATE preference_contexts
           SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END, updated_at = ?
           WHERE profile_id = ?`
        )
        .run(replacementDefault.id, timestamp, current.profileId);
      getDatabase()
        .prepare(
          `UPDATE preference_profiles
           SET default_context_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(replacementDefault.id, timestamp, current.profileId);
    }
  });
  const profile = readProfileById(current.profileId);
  if (profile) {
    recomputeContext(profile, replacementDefault);
  }
  return current;
}

export function mergePreferenceContexts(input: MergePreferenceContextsInput) {
  const parsed = mergePreferenceContextsSchema.parse(input);
  const source = readContext(parsed.sourceContextId);
  const target = readContext(parsed.targetContextId);
  if (!source || !target || source.profileId !== target.profileId) {
    throw new HttpError(
      400,
      "preferences_invalid_context_merge",
      "Preference contexts must exist on the same profile before merging."
    );
  }
  const timestamp = nowIso();
  runInTransaction(() => {
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
  });
  const profile = readProfileById(source.profileId);
  if (profile) {
    recomputeContext(profile, target);
  }
  return {
    target: readContext(target.id)!,
    source: readContext(source.id)!
  };
}

export function createPreferenceItem(
  input: CreatePreferenceItemInput
): PreferenceItem {
  const parsed = createPreferenceItemSchema.parse(input);
  const profile = ensureProfile(parsed.userId, parsed.domain);
  const itemId = `pref_item_${randomUUID().slice(0, 10)}`;
  const timestamp = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO preference_items (id, profile_id, label, description, tags_json, feature_weights_json, source_entity_type, source_entity_id, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      itemId,
      profile.id,
      parsed.label,
      parsed.description,
      JSON.stringify(parsed.tags),
      JSON.stringify(normalizeDimensionVector(parsed.featureWeights)),
      parsed.sourceEntityType ?? null,
      parsed.sourceEntityId ?? null,
      JSON.stringify(parsed.metadata ?? {}),
      timestamp,
      timestamp
    );
  const created = getItemById(itemId)!;
  const selectedContext = resolveContext(profile, null);
  if (parsed.queueForCompare) {
    upsertPreferenceScoreState(itemId, selectedContext.id, {
      compareLater: true,
      bookmarked: true
    });
  }
  recomputeContext(profile, selectedContext);
  return created;
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
  const profile = readProfileById(item.profileId);
  const context = readContext(contextId);
  if (!profile || !context || context.profileId !== profile.id) {
    throw new HttpError(
      400,
      "preferences_invalid_score_context",
      "Preference score context is invalid for this item."
    );
  }
  const existing = listStoredScores(contextId).find((score) => score.item_id === itemId);
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
      patch.manualStatus ?? existing.manual_status,
      patch.manualScore ?? existing.manual_score,
      patch.confidenceLock ?? existing.confidence_lock,
      (patch.bookmarked ?? (existing.bookmarked === 1)) ? 1 : 0,
      (patch.compareLater ?? (existing.compare_later === 1)) ? 1 : 0,
      (patch.frozen ?? (existing.frozen === 1)) ? 1 : 0,
      timestamp,
      contextId,
      itemId
    );
}

export function updatePreferenceItem(
  itemId: string,
  patch: UpdatePreferenceItemInput
): PreferenceItem {
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
        : item.sourceEntityType ?? null,
    sourceEntityId:
      parsed.sourceEntityId !== undefined
        ? parsed.sourceEntityId
        : item.sourceEntityId ?? null,
    metadata:
      parsed.metadata !== undefined
        ? (parsed.metadata as Record<string, unknown>)
        : item.metadata
  };
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
  const updated = getItemById(itemId)!;
  const profile = readProfileById(item.profileId);
  if (profile) {
    for (const context of listContexts(profile.id).filter((entry) => entry.active)) {
      recomputeContext(profile, context);
    }
  }
  return updated;
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
  });
  const profile = readProfileById(current.profileId);
  if (profile) {
    for (const context of listContexts(profile.id).filter((entry) => entry.active)) {
      recomputeContext(profile, context);
    }
  }
  return current;
}

export function createPreferenceItemFromEntity(
  input: EnqueueEntityPreferenceItemInput
): PreferenceItem {
  const parsed = enqueueEntityPreferenceItemSchema.parse(input);
  const profile = ensureProfile(parsed.userId, parsed.domain);
  const existing = listItems(profile.id).find(
    (item) =>
      item.sourceEntityType === parsed.entityType &&
      item.sourceEntityId === parsed.entityId
  );
  const source = resolveSourceEntity(parsed.entityType, parsed.entityId);
  if (!source) {
    throw new HttpError(
      404,
      "preferences_source_entity_not_found",
      `${parsed.entityType} ${parsed.entityId} was not found.`
    );
  }
  const item =
    existing ??
    createPreferenceItem({
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
  const selectedContext = resolveContext(profile, null);
  upsertPreferenceScoreState(item.id, selectedContext.id, {
    bookmarked: true,
    compareLater: true
  });
  recomputeContext(profile, selectedContext);
  return item;
}

export function submitPairwiseJudgment(
  input: SubmitPairwiseJudgmentInput
): PairwiseJudgment {
  const parsed = submitPairwiseJudgmentSchema.parse(input);
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
  if (!getItemById(parsed.leftItemId) || !getItemById(parsed.rightItemId)) {
    throw new HttpError(
      404,
      "preferences_item_not_found",
      "One or both preference items do not exist."
    );
  }
  const judgmentId = `pref_judgment_${randomUUID().slice(0, 10)}`;
  const timestamp = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO pairwise_judgments (id, profile_id, context_id, user_id, left_item_id, right_item_id, outcome, strength, response_time_ms, source, reason_tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ui', ?, ?)`
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
      JSON.stringify(parsed.reasonTags),
      timestamp
    );
  recomputeContext(profile, context);
  return mapJudgment(
    getDatabase()
      .prepare(
        `SELECT id, profile_id, context_id, user_id, left_item_id, right_item_id, outcome, strength, response_time_ms, source, reason_tags_json, created_at
         FROM pairwise_judgments
         WHERE id = ?`
      )
      .get(judgmentId) as JudgmentRow
  );
}

export function submitAbsoluteSignal(
  input: SubmitAbsoluteSignalInput
): AbsoluteSignal {
  const parsed = submitAbsoluteSignalSchema.parse(input);
  const profile = ensureProfile(parsed.userId, parsed.domain);
  const context = readContext(parsed.contextId);
  if (!context || context.profileId !== profile.id) {
    throw new HttpError(
      400,
      "preferences_invalid_context",
      "Preference signal context does not belong to the selected profile."
    );
  }
  if (!getItemById(parsed.itemId)) {
    throw new HttpError(
      404,
      "preferences_item_not_found",
      `Preference item ${parsed.itemId} was not found.`
    );
  }
  const signalId = `pref_signal_${randomUUID().slice(0, 10)}`;
  const timestamp = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO absolute_signals (id, profile_id, context_id, user_id, item_id, signal_type, strength, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ui', ?)`
    )
    .run(
      signalId,
      profile.id,
      context.id,
      parsed.userId,
      parsed.itemId,
      parsed.signalType,
      parsed.strength,
      timestamp
    );
  recomputeContext(profile, context);
  return mapSignal(
    getDatabase()
      .prepare(
        `SELECT id, profile_id, context_id, user_id, item_id, signal_type, strength, source, created_at
         FROM absolute_signals
         WHERE id = ?`
      )
      .get(signalId) as SignalRow
  );
}

export function updatePreferenceScore(
  itemId: string,
  input: UpdatePreferenceScoreInput
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
  upsertPreferenceScoreState(itemId, context.id, {
    manualStatus:
      parsed.manualStatus !== undefined ? parsed.manualStatus ?? null : undefined,
    manualScore:
      parsed.manualScore !== undefined ? parsed.manualScore ?? null : undefined,
    confidenceLock:
      parsed.confidenceLock !== undefined
        ? parsed.confidenceLock ?? null
        : undefined,
    bookmarked: parsed.bookmarked,
    compareLater: parsed.compareLater,
    frozen: parsed.frozen
  });
  return getPreferenceWorkspace({
    userId: parsed.userId,
    domain: parsed.domain,
    contextId: context.id
  });
}
