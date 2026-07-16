import { createHash, randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { recordActivityEvent } from "./activity-events.js";
import {
  filterDeletedEntities,
  filterDeletedIds,
  isEntityDeleted
} from "./deleted-entities.js";
import {
  replaceEntityLinksForSource,
  replaceEntityLinksForSourceRelationships,
  type EntityLinkInput
} from "./entity-links.js";
import {
  clearEntityOwner,
  decorateOwnedEntity,
  getEntityOwnerId,
  setEntityOwner
} from "./entity-ownership.js";
import { recordEventLog } from "./event-log.js";
import { unlinkNotesForEntity } from "./notes.js";
import {
  recordPsycheClarityReward,
  recordPsycheReflectionReward
} from "./rewards.js";
import {
  behaviorPatternSchema,
  behaviorSchema,
  beliefEntrySchema,
  createBehaviorPatternSchema,
  createBehaviorSchema,
  createBeliefEntrySchema,
  createEmotionDefinitionSchema,
  createEventTypeSchema,
  createFlashcardSchema,
  createModeGuideSessionSchema,
  createModeProfileSchema,
  createPsycheValueSchema,
  createTriggerReportSchema,
  domainSchema,
  emotionDefinitionSchema,
  eventTypeSchema,
  flashcardSchema,
  modeFamilySchema,
  modeGuideResultSchema,
  modeGuideSessionSchema,
  modeProfileSchema,
  modeTimelineEntrySchema,
  psycheValueSchema,
  schemaCatalogEntrySchema,
  triggerReportSchema,
  updateBehaviorPatternSchema,
  updateBehaviorSchema,
  updateBeliefEntrySchema,
  updateEmotionDefinitionSchema,
  updateEventTypeSchema,
  updateFlashcardSchema,
  updateModeGuideSessionSchema,
  updateModeProfileSchema,
  updatePsycheValueSchema,
  updateTriggerReportSchema,
  type Behavior,
  type BehaviorPattern,
  type BeliefEntry,
  type CreateBehaviorInput,
  type CreateBehaviorPatternInput,
  type CreateBeliefEntryInput,
  type CreateEmotionDefinitionInput,
  type CreateEventTypeInput,
  type CreateFlashcardInput,
  type CreateModeGuideSessionInput,
  type CreateModeProfileInput,
  type CreatePsycheValueInput,
  type CreateTriggerReportInput,
  type Domain,
  type EmotionDefinition,
  type EventType,
  type Flashcard,
  type ModeGuideSession,
  type ModeProfile,
  type PsycheValue,
  type SchemaCatalogEntry,
  type TriggerReport,
  type UpdateBehaviorInput,
  type UpdateBehaviorPatternInput,
  type UpdateBeliefEntryInput,
  type UpdateEmotionDefinitionInput,
  type UpdateEventTypeInput,
  type UpdateFlashcardInput,
  type UpdateModeGuideSessionInput,
  type UpdateModeProfileInput,
  type UpdatePsycheValueInput,
  type UpdateTriggerReportInput
} from "../psyche-types.js";
import type { ActivitySource } from "../types.js";
import { resolveUserForMutation } from "./users.js";

type RowBase = {
  id: string;
  created_at: string;
  updated_at: string;
};

type DomainRow = RowBase & {
  slug: string;
  title: string;
  description: string;
  theme_color: string;
  sensitive: number;
};

type SchemaCatalogRow = RowBase & {
  slug: string;
  title: string;
  family: string;
  schema_type: SchemaCatalogEntry["schemaType"];
  description: string;
};

type EventTypeRow = RowBase & {
  domain_id: string;
  label: string;
  description: string;
  system: number;
};

type EmotionDefinitionRow = RowBase & {
  domain_id: string;
  label: string;
  description: string;
  category: string;
  system: number;
};

type PsycheValueRow = RowBase & {
  domain_id: string;
  title: string;
  description: string;
  valued_direction: string;
  why_it_matters: string;
  linked_goal_ids_json: string;
  linked_project_ids_json: string;
  linked_task_ids_json: string;
  committed_actions_json: string;
};

type BehaviorPatternRow = RowBase & {
  domain_id: string;
  title: string;
  description: string;
  target_behavior: string;
  cue_contexts_json: string;
  short_term_payoff: string;
  long_term_cost: string;
  preferred_response: string;
  linked_value_ids_json: string;
  linked_schema_labels_json: string;
  linked_mode_labels_json: string;
  linked_mode_ids_json: string;
  linked_belief_ids_json: string;
};

type BehaviorRow = RowBase & {
  domain_id: string;
  kind: Behavior["kind"];
  title: string;
  description: string;
  common_cues_json: string;
  urge_story: string;
  short_term_payoff: string;
  long_term_cost: string;
  replacement_move: string;
  repair_plan: string;
  linked_pattern_ids_json: string;
  linked_value_ids_json: string;
  linked_schema_ids_json: string;
  linked_mode_ids_json: string;
};

type BeliefEntryRow = RowBase & {
  domain_id: string;
  schema_id: string | null;
  statement: string;
  belief_type: BeliefEntry["beliefType"];
  origin_note: string;
  confidence: number;
  evidence_for_json: string;
  evidence_against_json: string;
  flexible_alternative: string;
  linked_value_ids_json: string;
  linked_behavior_ids_json: string;
  linked_mode_ids_json: string;
  linked_report_ids_json: string;
};

type ModeProfileRow = RowBase & {
  domain_id: string;
  family: ModeProfile["family"];
  archetype: string;
  title: string;
  persona: string;
  imagery: string;
  symbolic_form: string;
  facial_expression: string;
  fear: string;
  burden: string;
  protective_job: string;
  origin_context: string;
  first_appearance_at: string | null;
  linked_pattern_ids_json: string;
  linked_behavior_ids_json: string;
  linked_value_ids_json: string;
};

type ModeGuideSessionRow = RowBase & {
  summary: string;
  answers_json: string;
  results_json: string;
};

type FlashcardRow = RowBase & {
  domain_id: string;
  title: string;
  message: string;
  trigger_sentence: string;
  trigger_situation: string;
  tags_json: string;
  background_color: string;
  text_color: string;
  accent_color: string;
  typography: Flashcard["typography"];
  image_url: string;
  image_alt: string;
  layout: Flashcard["layout"];
  visual_style: Flashcard["visualStyle"];
  linked_value_ids_json: string;
  linked_behavior_ids_json: string;
  linked_pattern_ids_json: string;
  linked_belief_ids_json: string;
  linked_mode_ids_json: string;
  linked_report_ids_json: string;
};

type TriggerReportRow = RowBase & {
  domain_id: string;
  title: string;
  status: TriggerReport["status"];
  event_type_id: string | null;
  custom_event_type: string;
  event_situation: string;
  occurred_at: string | null;
  body_cues_json: string;
  emotions_json: string;
  thoughts_json: string;
  behaviors_json: string;
  consequences_json: string;
  linked_pattern_ids_json: string;
  linked_value_ids_json: string;
  linked_goal_ids_json: string;
  linked_project_ids_json: string;
  linked_task_ids_json: string;
  linked_behavior_ids_json: string;
  linked_belief_ids_json: string;
  linked_mode_ids_json: string;
  mode_overlays_json: string;
  schema_links_json: string;
  mode_timeline_json: string;
  next_moves_json: string;
  memory_clarity: TriggerReport["memoryClarity"];
  reflection: string;
  hypothesis: string;
  hypothesis_fit: TriggerReport["hypothesisFit"];
  hypothesis_correction: string;
  interpretation_consent: number;
  revision: number;
};

export type PsycheContext = {
  source: ActivitySource;
  actor?: string | null;
  userIds?: string[];
  idempotencyKey?: string | null;
};

export type PsycheVocabularyEntityType = "event_type" | "emotion_definition";

const PSYCHE_DOMAIN_ID = "domain_psyche";

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function buildId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

// Unicode 17 full case-fold mappings not reproduced by locale-independent
// lowercasing after NFKC. Remaining mappings are identical to toLowerCase().
const UNICODE_FULL_CASE_FOLD_OVERRIDES = new Map<string, string>([
  ["\u00df", "ss"],
  ["\u0345", "\u03b9"],
  ["\u03c2", "\u03c3"],
  ["\u1c80", "\u0432"],
  ["\u1c81", "\u0434"],
  ["\u1c82", "\u043e"],
  ["\u1c83", "\u0441"],
  ["\u1c84", "\u0442"],
  ["\u1c85", "\u0442"],
  ["\u1c86", "\u044a"],
  ["\u1c87", "\u0463"],
  ["\u1c88", "\ua64b"],
  ["\u1e9e", "ss"],
  ["\u1fb2", "\u1f70\u03b9"],
  ["\u1fb3", "\u03b1\u03b9"],
  ["\u1fb4", "\u03ac\u03b9"],
  ["\u1fb7", "\u1fb6\u03b9"],
  ["\u1fbc", "\u03b1\u03b9"],
  ["\u1fc2", "\u1f74\u03b9"],
  ["\u1fc3", "\u03b7\u03b9"],
  ["\u1fc4", "\u03ae\u03b9"],
  ["\u1fc7", "\u1fc6\u03b9"],
  ["\u1fcc", "\u03b7\u03b9"],
  ["\u1ff2", "\u1f7c\u03b9"],
  ["\u1ff3", "\u03c9\u03b9"],
  ["\u1ff4", "\u03ce\u03b9"],
  ["\u1ff7", "\u1ff6\u03b9"],
  ["\u1ffc", "\u03c9\u03b9"]
]);

function unicodeDefaultCaseFoldCharacter(character: string) {
  const codePoint = character.codePointAt(0)!;

  // Unicode default folding uses Cherokee uppercase as the stable form.
  if (codePoint >= 0x13a0 && codePoint <= 0x13f5) {
    return character;
  }
  if (codePoint >= 0x13f8 && codePoint <= 0x13fd) {
    return String.fromCodePoint(codePoint - 0x8);
  }
  if (codePoint >= 0xab70 && codePoint <= 0xabbf) {
    return String.fromCodePoint(codePoint - 0x97d0);
  }

  // Greek prosgegrammeni folds to the base vowel followed by iota.
  if (codePoint >= 0x1f80 && codePoint <= 0x1f8f) {
    return `${String.fromCodePoint(0x1f00 + ((codePoint - 0x1f80) % 8))}\u03b9`;
  }
  if (codePoint >= 0x1f90 && codePoint <= 0x1f9f) {
    return `${String.fromCodePoint(0x1f20 + ((codePoint - 0x1f90) % 8))}\u03b9`;
  }
  if (codePoint >= 0x1fa0 && codePoint <= 0x1faf) {
    return `${String.fromCodePoint(0x1f60 + ((codePoint - 0x1fa0) % 8))}\u03b9`;
  }

  return (
    UNICODE_FULL_CASE_FOLD_OVERRIDES.get(character) ?? character.toLowerCase()
  );
}

export function normalizePsycheVocabularyLabel(label: string) {
  const caseFoldKey = [...label.normalize("NFKC")]
    .map(unicodeDefaultCaseFoldCharacter)
    .join("")
    .normalize("NFKC")
    .replace(/\p{Default_Ignorable_Code_Point}+/gu, "");

  return caseFoldKey
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolvePsycheVocabularyOwner(
  entityType: PsycheVocabularyEntityType,
  requestedUserId: string | null | undefined,
  context: PsycheContext
) {
  const allowedUserIds = [...new Set(context.userIds ?? [])];
  if (
    requestedUserId &&
    allowedUserIds.length > 0 &&
    !allowedUserIds.includes(requestedUserId)
  ) {
    throw new HttpError(
      403,
      "user_scope_forbidden",
      "The requested vocabulary owner is outside this token's allowed users."
    );
  }
  if (!requestedUserId && allowedUserIds.length > 1) {
    throw new HttpError(
      400,
      "psyche_vocabulary_owner_required",
      "Choose one owner for this reusable Psyche vocabulary entry."
    );
  }
  const owner = resolveUserForMutation(
    requestedUserId ?? allowedUserIds[0],
    context.actor
  );
  if (allowedUserIds.length > 0 && !allowedUserIds.includes(owner.id)) {
    throw new HttpError(
      403,
      "user_scope_forbidden",
      "The reusable Psyche vocabulary owner is outside this token's allowed users.",
      { entityType }
    );
  }
  return owner;
}

function buildPsycheVocabularyId(
  prefix: "evt" | "emo",
  ownerUserId: string,
  idempotencyKey: string | null | undefined
) {
  const key = idempotencyKey?.trim();
  if (!key) {
    return buildId(prefix);
  }
  return `${prefix}_${createHash("sha256")
    .update(`${ownerUserId}:${key}`)
    .digest("hex")
    .slice(0, 16)}`;
}

type PsycheVocabularyCreatePayload = {
  label: string;
  description: string;
  category: string;
};

type PsycheVocabularyIdempotencyRow = {
  receipt_id: string;
  owner_user_id: string;
  entity_type: PsycheVocabularyEntityType;
  idempotency_key: string | null;
  request_fingerprint: string | null;
  entity_id: string;
  payload_label: string;
  payload_description: string;
  payload_category: string;
  lifecycle_state: "active" | "deleted";
};

function fingerprintPsycheVocabularyCreate(input: {
  entityType: PsycheVocabularyEntityType;
  ownerUserId: string;
  payload: PsycheVocabularyCreatePayload;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        entityType: input.entityType,
        ownerUserId: input.ownerUserId,
        ...input.payload
      })
    )
    .digest("hex");
}

function getPsycheVocabularyIdempotencyReceipt(input: {
  entityType: PsycheVocabularyEntityType;
  ownerUserId: string;
  idempotencyKey: string;
  entityId: string;
}) {
  const database = getDatabase();
  const byKey = database
    .prepare(
      `SELECT receipt_id, owner_user_id, entity_type, idempotency_key,
              request_fingerprint, entity_id, payload_label,
              payload_description, payload_category, lifecycle_state
       FROM psyche_vocabulary_create_idempotency
       WHERE owner_user_id = ? AND entity_type = ? AND idempotency_key = ?`
    )
    .get(input.ownerUserId, input.entityType, input.idempotencyKey) as
    | PsycheVocabularyIdempotencyRow
    | undefined;
  return (
    byKey ??
    (database
      .prepare(
        `SELECT receipt_id, owner_user_id, entity_type, idempotency_key,
                request_fingerprint, entity_id, payload_label,
                payload_description, payload_category, lifecycle_state
         FROM psyche_vocabulary_create_idempotency
         WHERE entity_type = ? AND entity_id = ?`
      )
      .get(input.entityType, input.entityId) as
      | PsycheVocabularyIdempotencyRow
      | undefined)
  );
}

function resolvePsycheVocabularyIdempotencyReplay(input: {
  entityType: PsycheVocabularyEntityType;
  ownerUserId: string;
  idempotencyKey: string | null;
  entityId: string;
  payload: PsycheVocabularyCreatePayload;
  fingerprint: string;
}) {
  if (!input.idempotencyKey) {
    return undefined;
  }
  const receipt = getPsycheVocabularyIdempotencyReceipt({
    entityType: input.entityType,
    ownerUserId: input.ownerUserId,
    idempotencyKey: input.idempotencyKey,
    entityId: input.entityId
  });
  if (!receipt) {
    return undefined;
  }
  if (
    receipt.owner_user_id !== input.ownerUserId ||
    (receipt.idempotency_key !== null &&
      receipt.idempotency_key !== input.idempotencyKey)
  ) {
    throw new HttpError(
      409,
      "idempotency_conflict",
      "This idempotency key collides with an existing vocabulary receipt."
    );
  }
  const payloadMatches = receipt.request_fingerprint
    ? receipt.request_fingerprint === input.fingerprint
    : receipt.owner_user_id === input.ownerUserId &&
      receipt.entity_type === input.entityType &&
      receipt.payload_label === input.payload.label &&
      receipt.payload_description === input.payload.description &&
      receipt.payload_category === input.payload.category;
  if (!payloadMatches) {
    throw new HttpError(
      409,
      "idempotency_conflict",
      `This idempotency key was already used for a different ${
        input.entityType === "event_type" ? "event type" : "emotion definition"
      }.`
    );
  }
  if (receipt.lifecycle_state === "deleted") {
    throw new HttpError(
      409,
      "psyche_vocabulary_idempotency_target_deleted",
      "The original vocabulary entry was permanently deleted. This idempotency key remains consumed and cannot recreate it.",
      { entityType: input.entityType, entityId: receipt.entity_id }
    );
  }
  if (isEntityDeleted(input.entityType, receipt.entity_id)) {
    throw new HttpError(
      409,
      "psyche_vocabulary_idempotency_target_in_bin",
      "The original vocabulary entry is in the bin. Restore it instead of retrying create.",
      { entityType: input.entityType, entityId: receipt.entity_id }
    );
  }
  if (!receipt.idempotency_key) {
    getDatabase()
      .prepare(
        `UPDATE psyche_vocabulary_create_idempotency
         SET idempotency_key = ?, request_fingerprint = ?
         WHERE receipt_id = ? AND idempotency_key IS NULL`
      )
      .run(input.idempotencyKey, input.fingerprint, receipt.receipt_id);
  }
  return receipt;
}

function recordPsycheVocabularyIdempotencyReceipt(input: {
  entityType: PsycheVocabularyEntityType;
  ownerUserId: string;
  idempotencyKey: string | null;
  fingerprint: string;
  entityId: string;
  payload: PsycheVocabularyCreatePayload;
  createdAt: string;
}) {
  if (!input.idempotencyKey) {
    return;
  }
  const receiptId = `psy_vocab_${createHash("sha256")
    .update(
      `${input.ownerUserId}\0${input.entityType}\0${input.idempotencyKey}`
    )
    .digest("hex")}`;
  getDatabase()
    .prepare(
      `INSERT INTO psyche_vocabulary_create_idempotency (
        receipt_id, owner_user_id, entity_type, idempotency_key,
        request_fingerprint, entity_id, payload_label, payload_description,
        payload_category, lifecycle_state, created_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL)`
    )
    .run(
      receiptId,
      input.ownerUserId,
      input.entityType,
      input.idempotencyKey,
      input.fingerprint,
      input.entityId,
      input.payload.label,
      input.payload.description,
      input.payload.category,
      input.createdAt
    );
}

function listPsycheVocabularyLabelCandidates(
  entityType: PsycheVocabularyEntityType
) {
  const table =
    entityType === "event_type" ? "event_types" : "emotion_definitions";
  return getDatabase()
    .prepare(`SELECT id, label, system FROM ${table} WHERE domain_id = ?`)
    .all(PSYCHE_DOMAIN_ID) as Array<{
    id: string;
    label: string;
    system: number;
  }>;
}

function requireUniquePsycheVocabularyLabel(input: {
  entityType: PsycheVocabularyEntityType;
  label: string;
  ownerUserId: string | null;
  excludeId?: string;
}) {
  const normalizedLabel = normalizePsycheVocabularyLabel(input.label);
  const duplicate = listPsycheVocabularyLabelCandidates(input.entityType).find(
    (candidate) => {
      if (
        candidate.id === input.excludeId ||
        normalizePsycheVocabularyLabel(candidate.label) !== normalizedLabel
      ) {
        return false;
      }
      const candidateOwnerId = getEntityOwnerId(input.entityType, candidate.id);
      return (
        candidate.system === 1 ||
        candidateOwnerId === null ||
        candidateOwnerId === input.ownerUserId
      );
    }
  );
  if (!duplicate) {
    return;
  }
  throw new HttpError(
    409,
    isEntityDeleted(input.entityType, duplicate.id)
      ? "psyche_vocabulary_label_in_bin"
      : "psyche_vocabulary_duplicate",
    isEntityDeleted(input.entityType, duplicate.id)
      ? "A matching reusable label is already in the bin. Restore it instead of creating a duplicate."
      : "A matching reusable label already exists for this owner.",
    {
      entityType: input.entityType,
      existingId: duplicate.id,
      normalizedLabel
    }
  );
}

export function requirePsycheVocabularyWriteScope(
  entityType: PsycheVocabularyEntityType,
  entityId: string,
  context: PsycheContext,
  snapshot?: Record<string, unknown>
) {
  const stored = getDatabase()
    .prepare(
      `SELECT system FROM ${
        entityType === "event_type" ? "event_types" : "emotion_definitions"
      } WHERE id = ?`
    )
    .get(entityId) as { system: number } | undefined;
  const system =
    typeof snapshot?.system === "boolean"
      ? snapshot.system
      : stored?.system === 1;
  if (system) {
    throw new HttpError(
      409,
      "system_vocabulary_immutable",
      "Built-in Psyche vocabulary is read-only. Create a custom label when the built-in wording does not fit."
    );
  }
  const allowedUserIds = context.userIds ?? [];
  if (allowedUserIds.length === 0) {
    return;
  }
  const ownerUserId =
    getEntityOwnerId(entityType, entityId) ??
    (typeof snapshot?.userId === "string" ? snapshot.userId : null);
  if (!ownerUserId || !allowedUserIds.includes(ownerUserId)) {
    throw new HttpError(
      404,
      "psyche_vocabulary_not_found",
      "Reusable Psyche vocabulary entry not found."
    );
  }
}

function requireReadablePsycheVocabularyReference(
  entityType: PsycheVocabularyEntityType,
  entityId: string,
  context: PsycheContext
) {
  const entity =
    entityType === "event_type"
      ? getEventTypeById(entityId)
      : getEmotionDefinitionById(entityId);
  if (!entity) {
    throw new HttpError(
      400,
      "psyche_vocabulary_reference_invalid",
      "The selected reusable Psyche label is unavailable. Keep the user's own wording or choose another label."
    );
  }
  const allowedUserIds = context.userIds ?? [];
  if (
    allowedUserIds.length > 0 &&
    !entity.system &&
    !allowedUserIds.includes(entity.userId ?? "")
  ) {
    throw new HttpError(
      404,
      "psyche_vocabulary_not_found",
      "Reusable Psyche vocabulary entry not found."
    );
  }
  return entity;
}

function assignOwnedEntity<
  EntityType extends
    | "event_type"
    | "emotion_definition"
    | "psyche_value"
    | "behavior_pattern"
    | "behavior"
    | "belief_entry"
    | "mode_profile"
    | "mode_guide_session"
    | "flashcard"
    | "trigger_report"
>(
  entityType: EntityType,
  entityId: string,
  userId: string | null | undefined,
  actor?: string | null
) {
  return setEntityOwner(entityType, entityId, userId, actor ?? null);
}

function enrichTriggerItems<T extends { id?: string }>(
  items: T[],
  prefix: string
): Array<Omit<T, "id"> & { id: string }> {
  return items.map((item) => ({
    ...item,
    id: item.id ?? buildId(prefix)
  }));
}

function mapDomain(row: DomainRow): Domain {
  return domainSchema.parse({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    themeColor: row.theme_color,
    sensitive: row.sensitive === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapSchemaCatalogEntry(row: SchemaCatalogRow): SchemaCatalogEntry {
  return schemaCatalogEntrySchema.parse({
    id: row.id,
    slug: row.slug,
    title: row.title,
    family: row.family,
    schemaType: row.schema_type,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapEventType(row: EventTypeRow): EventType {
  return eventTypeSchema.parse({
    id: row.id,
    domainId: row.domain_id,
    label: row.label,
    description: row.description,
    system: row.system === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapEmotionDefinition(row: EmotionDefinitionRow): EmotionDefinition {
  return emotionDefinitionSchema.parse({
    id: row.id,
    domainId: row.domain_id,
    label: row.label,
    description: row.description,
    category: row.category,
    system: row.system === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapPsycheValue(row: PsycheValueRow): PsycheValue {
  return psycheValueSchema.parse({
    id: row.id,
    domainId: row.domain_id,
    title: row.title,
    description: row.description,
    valuedDirection: row.valued_direction,
    whyItMatters: row.why_it_matters,
    linkedGoalIds: filterDeletedIds(
      "goal",
      parseJson<string[]>(row.linked_goal_ids_json)
    ),
    linkedProjectIds: filterDeletedIds(
      "project",
      parseJson<string[]>(row.linked_project_ids_json)
    ),
    linkedTaskIds: filterDeletedIds(
      "task",
      parseJson<string[]>(row.linked_task_ids_json)
    ),
    committedActions: parseJson<PsycheValue["committedActions"]>(
      row.committed_actions_json
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapBehaviorPattern(row: BehaviorPatternRow): BehaviorPattern {
  return behaviorPatternSchema.parse({
    id: row.id,
    domainId: row.domain_id,
    title: row.title,
    description: row.description,
    targetBehavior: row.target_behavior,
    cueContexts: parseJson<string[]>(row.cue_contexts_json),
    shortTermPayoff: row.short_term_payoff,
    longTermCost: row.long_term_cost,
    preferredResponse: row.preferred_response,
    linkedValueIds: filterDeletedIds(
      "psyche_value",
      parseJson<string[]>(row.linked_value_ids_json)
    ),
    linkedSchemaLabels: parseJson<string[]>(row.linked_schema_labels_json),
    linkedModeLabels: parseJson<string[]>(row.linked_mode_labels_json),
    linkedModeIds: filterDeletedIds(
      "mode_profile",
      parseJson<string[]>(row.linked_mode_ids_json)
    ),
    linkedBeliefIds: filterDeletedIds(
      "belief_entry",
      parseJson<string[]>(row.linked_belief_ids_json)
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapBehavior(row: BehaviorRow): Behavior {
  return behaviorSchema.parse({
    id: row.id,
    domainId: row.domain_id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    commonCues: parseJson<string[]>(row.common_cues_json),
    urgeStory: row.urge_story,
    shortTermPayoff: row.short_term_payoff,
    longTermCost: row.long_term_cost,
    replacementMove: row.replacement_move,
    repairPlan: row.repair_plan,
    linkedPatternIds: filterDeletedIds(
      "behavior_pattern",
      parseJson<string[]>(row.linked_pattern_ids_json)
    ),
    linkedValueIds: filterDeletedIds(
      "psyche_value",
      parseJson<string[]>(row.linked_value_ids_json)
    ),
    linkedSchemaIds: parseJson<string[]>(row.linked_schema_ids_json),
    linkedModeIds: filterDeletedIds(
      "mode_profile",
      parseJson<string[]>(row.linked_mode_ids_json)
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapBeliefEntry(row: BeliefEntryRow): BeliefEntry {
  return beliefEntrySchema.parse({
    id: row.id,
    domainId: row.domain_id,
    schemaId: row.schema_id,
    statement: row.statement,
    beliefType: row.belief_type,
    originNote: row.origin_note,
    confidence: row.confidence,
    evidenceFor: parseJson<string[]>(row.evidence_for_json),
    evidenceAgainst: parseJson<string[]>(row.evidence_against_json),
    flexibleAlternative: row.flexible_alternative,
    linkedValueIds: filterDeletedIds(
      "psyche_value",
      parseJson<string[]>(row.linked_value_ids_json)
    ),
    linkedBehaviorIds: filterDeletedIds(
      "behavior",
      parseJson<string[]>(row.linked_behavior_ids_json)
    ),
    linkedModeIds: filterDeletedIds(
      "mode_profile",
      parseJson<string[]>(row.linked_mode_ids_json)
    ),
    linkedReportIds: filterDeletedIds(
      "trigger_report",
      parseJson<string[]>(row.linked_report_ids_json)
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapModeProfile(row: ModeProfileRow): ModeProfile {
  return modeProfileSchema.parse({
    id: row.id,
    domainId: row.domain_id,
    family: row.family,
    archetype: row.archetype,
    title: row.title,
    persona: row.persona,
    imagery: row.imagery,
    symbolicForm: row.symbolic_form,
    facialExpression: row.facial_expression,
    fear: row.fear,
    burden: row.burden,
    protectiveJob: row.protective_job,
    originContext: row.origin_context,
    firstAppearanceAt: row.first_appearance_at,
    linkedPatternIds: filterDeletedIds(
      "behavior_pattern",
      parseJson<string[]>(row.linked_pattern_ids_json)
    ),
    linkedBehaviorIds: filterDeletedIds(
      "behavior",
      parseJson<string[]>(row.linked_behavior_ids_json)
    ),
    linkedValueIds: filterDeletedIds(
      "psyche_value",
      parseJson<string[]>(row.linked_value_ids_json)
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapModeGuideSession(row: ModeGuideSessionRow): ModeGuideSession {
  return modeGuideSessionSchema.parse({
    id: row.id,
    summary: row.summary,
    answers: parseJson<ModeGuideSession["answers"]>(row.answers_json),
    results: parseJson<ModeGuideSession["results"]>(row.results_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapFlashcard(row: FlashcardRow): Flashcard {
  return flashcardSchema.parse({
    id: row.id,
    domainId: row.domain_id,
    title: row.title,
    message: row.message,
    triggerSentence: row.trigger_sentence,
    triggerSituation: row.trigger_situation,
    tags: parseJson<string[]>(row.tags_json),
    backgroundColor: row.background_color,
    textColor: row.text_color,
    accentColor: row.accent_color,
    typography: row.typography,
    imageUrl: row.image_url,
    imageAlt: row.image_alt,
    layout: row.layout,
    visualStyle: row.visual_style,
    linkedValueIds: filterDeletedIds(
      "psyche_value",
      parseJson<string[]>(row.linked_value_ids_json)
    ),
    linkedBehaviorIds: filterDeletedIds(
      "behavior",
      parseJson<string[]>(row.linked_behavior_ids_json)
    ),
    linkedPatternIds: filterDeletedIds(
      "behavior_pattern",
      parseJson<string[]>(row.linked_pattern_ids_json)
    ),
    linkedBeliefIds: filterDeletedIds(
      "belief_entry",
      parseJson<string[]>(row.linked_belief_ids_json)
    ),
    linkedModeIds: filterDeletedIds(
      "mode_profile",
      parseJson<string[]>(row.linked_mode_ids_json)
    ),
    linkedReportIds: filterDeletedIds(
      "trigger_report",
      parseJson<string[]>(row.linked_report_ids_json)
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapPersistedTriggerReport(row: TriggerReportRow): TriggerReport {
  return triggerReportSchema.parse({
    id: row.id,
    domainId: row.domain_id,
    title: row.title,
    status: row.status,
    eventTypeId: row.event_type_id,
    customEventType: row.custom_event_type,
    eventSituation: row.event_situation,
    occurredAt: row.occurred_at,
    bodyCues: parseJson<string[]>(row.body_cues_json),
    emotions: parseJson<TriggerReport["emotions"]>(row.emotions_json),
    thoughts: parseJson<TriggerReport["thoughts"]>(row.thoughts_json),
    behaviors: parseJson<TriggerReport["behaviors"]>(row.behaviors_json),
    consequences: parseJson<TriggerReport["consequences"]>(
      row.consequences_json
    ),
    linkedPatternIds: parseJson<string[]>(row.linked_pattern_ids_json),
    linkedValueIds: parseJson<string[]>(row.linked_value_ids_json),
    linkedGoalIds: parseJson<string[]>(row.linked_goal_ids_json),
    linkedProjectIds: parseJson<string[]>(row.linked_project_ids_json),
    linkedTaskIds: parseJson<string[]>(row.linked_task_ids_json),
    linkedBehaviorIds: parseJson<string[]>(row.linked_behavior_ids_json),
    linkedBeliefIds: parseJson<string[]>(row.linked_belief_ids_json),
    linkedModeIds: parseJson<string[]>(row.linked_mode_ids_json),
    modeOverlays: parseJson<string[]>(row.mode_overlays_json),
    schemaLinks: parseJson<string[]>(row.schema_links_json),
    modeTimeline: parseJson<TriggerReport["modeTimeline"]>(
      row.mode_timeline_json
    ),
    nextMoves: parseJson<string[]>(row.next_moves_json),
    memoryClarity: row.memory_clarity,
    reflection: row.reflection,
    hypothesis: row.hypothesis,
    hypothesisFit: row.hypothesis_fit,
    hypothesisCorrection: row.hypothesis_correction,
    interpretationConsent: row.interpretation_consent === 1,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function serializeTriggerReport(report: TriggerReport): TriggerReport {
  return triggerReportSchema.parse({
    ...report,
    eventTypeId:
      report.eventTypeId && isEntityDeleted("event_type", report.eventTypeId)
        ? null
        : report.eventTypeId,
    emotions: report.emotions.map((emotion) =>
      emotion.emotionDefinitionId &&
      isEntityDeleted("emotion_definition", emotion.emotionDefinitionId)
        ? { ...emotion, emotionDefinitionId: null }
        : emotion
    ),
    thoughts: report.thoughts.map((thought) =>
      thought.beliefId && isEntityDeleted("belief_entry", thought.beliefId)
        ? { ...thought, beliefId: null }
        : thought
    ),
    behaviors: report.behaviors.map((behavior) =>
      behavior.behaviorId && isEntityDeleted("behavior", behavior.behaviorId)
        ? { ...behavior, behaviorId: null }
        : behavior
    ),
    linkedPatternIds: filterDeletedIds(
      "behavior_pattern",
      report.linkedPatternIds
    ),
    linkedValueIds: filterDeletedIds("psyche_value", report.linkedValueIds),
    linkedGoalIds: filterDeletedIds("goal", report.linkedGoalIds),
    linkedProjectIds: filterDeletedIds("project", report.linkedProjectIds),
    linkedTaskIds: filterDeletedIds("task", report.linkedTaskIds),
    linkedBehaviorIds: filterDeletedIds("behavior", report.linkedBehaviorIds),
    linkedBeliefIds: filterDeletedIds("belief_entry", report.linkedBeliefIds),
    linkedModeIds: filterDeletedIds("mode_profile", report.linkedModeIds),
    modeTimeline: report.modeTimeline.map((entry) =>
      entry.modeId && isEntityDeleted("mode_profile", entry.modeId)
        ? { ...entry, modeId: null }
        : entry
    )
  });
}

function mapTriggerReport(row: TriggerReportRow): TriggerReport {
  return serializeTriggerReport(mapPersistedTriggerReport(row));
}

function scoreModeGuideSession(
  input: CreateModeGuideSessionInput
): ModeGuideSession["results"] {
  const answers = new Map(
    input.answers.map((answer) => [answer.questionKey, answer.value])
  );
  const results: ModeGuideSession["results"] = [];

  const coping = answers.get("coping_response");
  if (coping && coping !== "none") {
    results.push(
      modeGuideResultSchema.parse({
        family: "coping",
        archetype: coping,
        label:
          coping === "fight"
            ? "Fighter"
            : coping === "flight"
              ? "Escaper"
              : coping === "freeze"
                ? "Freezer"
                : coping === "detach"
                  ? "Detached protector"
                  : coping === "comply"
                    ? "Compliant surrender"
                    : "Overcompensator",
        confidence: 0.78,
        reasoning: `The coping response leaned most strongly toward ${coping}.`
      })
    );
  }

  const child = answers.get("child_state");
  if (child && child !== "none") {
    results.push(
      modeGuideResultSchema.parse({
        family: "child",
        archetype: child,
        label:
          child === "vulnerable"
            ? "Vulnerable child"
            : child === "angry"
              ? "Angry child"
              : child === "impulsive"
                ? "Impulsive child"
                : child === "lonely"
                  ? "Lonely child"
                  : "Ashamed child",
        confidence: 0.72,
        reasoning: `The child-state answers cluster around ${child} activation.`
      })
    );
  }

  const critic = answers.get("critic_style");
  if (critic && critic !== "none") {
    results.push(
      modeGuideResultSchema.parse({
        family: "critic_parent",
        archetype: critic,
        label: critic === "demanding" ? "Demanding critic" : "Punitive critic",
        confidence: 0.76,
        reasoning: `The inner critical tone reads as ${critic}.`
      })
    );
  }

  const healthy = answers.get("healthy_contact");
  if (healthy && healthy !== "none") {
    results.push(
      modeGuideResultSchema.parse({
        family: healthy === "happy_child" ? "happy_child" : "healthy_adult",
        archetype: healthy,
        label: healthy === "happy_child" ? "Happy child" : "Healthy adult",
        confidence: 0.69,
        reasoning: `There is still some contact with ${healthy === "happy_child" ? "playful aliveness" : "steady adult leadership"}.`
      })
    );
  }

  if (results.length === 0) {
    results.push(
      modeGuideResultSchema.parse({
        family: "healthy_adult",
        archetype: "undifferentiated",
        label: "Mixed state",
        confidence: 0.41,
        reasoning:
          "The questionnaire suggests a mixed or unclear state; name the mode manually after reflection."
      })
    );
  }

  return results;
}

function mapCreateUpdateContext(input: {
  entityType: string;
  entityId: string;
  title: string;
  eventKind: string;
  source: ActivitySource;
  actor?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  recordActivityEvent({
    entityType: input.entityType as
      | "psyche_value"
      | "behavior_pattern"
      | "behavior"
      | "belief_entry"
      | "mode_profile"
      | "flashcard"
      | "trigger_report"
      | "event_type"
      | "emotion_definition",
    entityId: input.entityId,
    eventType: input.eventKind,
    title: input.title,
    description: input.title,
    actor: input.actor ?? null,
    source: input.source,
    metadata: input.metadata ?? {}
  });
  recordEventLog({
    eventKind: input.eventKind,
    entityType: input.entityType,
    entityId: input.entityId,
    actor: input.actor ?? null,
    source: input.source,
    metadata: input.metadata ?? {}
  });
}

function getRow<T>(sql: string, id: string): T | undefined {
  return getDatabase().prepare(sql).get(id) as T | undefined;
}

function unlinkEntityNotes(entityType: string, entityId: string): void {
  unlinkNotesForEntity(
    entityType as Parameters<typeof unlinkNotesForEntity>[0],
    entityId,
    { source: "system", actor: null }
  );
}

function rewriteJsonColumn<T>(
  table: string,
  column: string,
  transform: (value: T) => T
): void {
  const rows = getDatabase()
    .prepare(`SELECT id, ${column} AS payload FROM ${table}`)
    .all() as Array<{ id: string; payload: string }>;
  const update = getDatabase().prepare(
    `UPDATE ${table} SET ${column} = ?, updated_at = ? WHERE id = ?`
  );
  for (const row of rows) {
    const current = parseJson<T>(row.payload);
    const next = transform(current);
    const currentJson = JSON.stringify(current);
    const nextJson = JSON.stringify(next);
    if (nextJson !== currentJson) {
      update.run(nextJson, new Date().toISOString(), row.id);
    }
  }
}

function removeIdFromStringArrayColumn(
  table: string,
  column: string,
  targetId: string
): void {
  rewriteJsonColumn<string[]>(table, column, (values) =>
    values.filter((value) => value !== targetId)
  );
}

function nullifyTriggerThoughtBeliefReferences(beliefId: string): void {
  rewriteJsonColumn<TriggerReport["thoughts"]>(
    "trigger_reports",
    "thoughts_json",
    (thoughts) =>
      thoughts.map((thought) =>
        thought.beliefId === beliefId ? { ...thought, beliefId: null } : thought
      )
  );
}

function nullifyTriggerBehaviorReferences(behaviorId: string): void {
  rewriteJsonColumn<TriggerReport["behaviors"]>(
    "trigger_reports",
    "behaviors_json",
    (behaviors) =>
      behaviors.map((behavior) =>
        behavior.behaviorId === behaviorId
          ? { ...behavior, behaviorId: null }
          : behavior
      )
  );
}

function nullifyTriggerEmotionReferences(emotionId: string): void {
  rewriteJsonColumn<TriggerReport["emotions"]>(
    "trigger_reports",
    "emotions_json",
    (emotions) =>
      emotions.map((emotion) =>
        emotion.emotionDefinitionId === emotionId
          ? { ...emotion, emotionDefinitionId: null }
          : emotion
      )
  );
}

function nullifyTriggerTimelineModeReferences(modeId: string): void {
  rewriteJsonColumn<TriggerReport["modeTimeline"]>(
    "trigger_reports",
    "mode_timeline_json",
    (entries) =>
      entries.map((entry) =>
        entry.modeId === modeId ? { ...entry, modeId: null } : entry
      )
  );
}

export function pruneLinkedEntityReferences(
  entityType: "goal" | "project" | "task",
  entityId: string
): void {
  const columnByEntityType = {
    goal: "linked_goal_ids_json",
    project: "linked_project_ids_json",
    task: "linked_task_ids_json"
  } as const;
  const column = columnByEntityType[entityType];
  removeIdFromStringArrayColumn("psyche_values", column, entityId);
  removeIdFromStringArrayColumn("trigger_reports", column, entityId);
}

export function getPsycheDomain(): Domain | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, slug, title, description, theme_color, sensitive, created_at, updated_at
       FROM domains
       WHERE id = ?`
    )
    .get(PSYCHE_DOMAIN_ID) as DomainRow | undefined;
  return row ? mapDomain(row) : undefined;
}

export function listSchemaCatalog(): SchemaCatalogEntry[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, slug, title, family, schema_type, description, created_at, updated_at
       FROM schema_catalog
       ORDER BY CASE schema_type WHEN 'maladaptive' THEN 0 ELSE 1 END, family, title`
    )
    .all() as SchemaCatalogRow[];
  return rows.map(mapSchemaCatalogEntry);
}

export function listEventTypes(): EventType[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, domain_id, label, description, system, created_at, updated_at
       FROM event_types
       WHERE domain_id = ?
       ORDER BY system DESC, label`
    )
    .all(PSYCHE_DOMAIN_ID) as EventTypeRow[];
  return filterDeletedEntities("event_type", rows.map(mapEventType));
}

export function getEventTypeById(eventTypeId: string): EventType | undefined {
  if (isEntityDeleted("event_type", eventTypeId)) {
    return undefined;
  }
  const row = getRow<EventTypeRow>(
    `SELECT id, domain_id, label, description, system, created_at, updated_at
     FROM event_types
     WHERE id = ?`,
    eventTypeId
  );
  return row ? decorateOwnedEntity("event_type", mapEventType(row)) : undefined;
}

export function createEventType(
  input: CreateEventTypeInput,
  context: PsycheContext
): EventType {
  const parsed = createEventTypeSchema.parse(input);
  const owner = resolvePsycheVocabularyOwner(
    "event_type",
    parsed.userId,
    context
  );
  const idempotencyKey = context.idempotencyKey?.trim() || null;
  const payload: PsycheVocabularyCreatePayload = {
    label: parsed.label,
    description: parsed.description,
    category: ""
  };
  const entityId = buildPsycheVocabularyId("evt", owner.id, idempotencyKey);
  const fingerprint = fingerprintPsycheVocabularyCreate({
    entityType: "event_type",
    ownerUserId: owner.id,
    payload
  });
  const now = new Date().toISOString();
  const eventType = eventTypeSchema.parse({
    id: entityId,
    domainId: PSYCHE_DOMAIN_ID,
    label: parsed.label,
    description: parsed.description,
    system: false,
    createdAt: now,
    updatedAt: now
  });
  return runInTransaction(() => {
    const receipt = resolvePsycheVocabularyIdempotencyReplay({
      entityType: "event_type",
      ownerUserId: owner.id,
      idempotencyKey,
      entityId,
      payload,
      fingerprint
    });
    if (receipt) {
      const replayRow = getRow<EventTypeRow>(
        `SELECT id, domain_id, label, description, system, created_at, updated_at
         FROM event_types
         WHERE id = ?`,
        receipt.entity_id
      );
      if (
        !replayRow ||
        getEntityOwnerId("event_type", receipt.entity_id) !== owner.id
      ) {
        throw new HttpError(
          409,
          "psyche_vocabulary_idempotency_target_deleted",
          "The original vocabulary entry is unavailable. This idempotency key remains consumed and cannot recreate it.",
          { entityType: "event_type", entityId: receipt.entity_id }
        );
      }
      return decorateOwnedEntity("event_type", mapEventType(replayRow));
    }
    if (
      getRow<EventTypeRow>(
        `SELECT id, domain_id, label, description, system, created_at, updated_at
         FROM event_types
         WHERE id = ?`,
        eventType.id
      )
    ) {
      throw new HttpError(
        409,
        "idempotency_conflict",
        "The event type id collides with an existing record."
      );
    }
    requireUniquePsycheVocabularyLabel({
      entityType: "event_type",
      label: eventType.label,
      ownerUserId: owner.id
    });
    getDatabase()
      .prepare(
        `INSERT INTO event_types (id, domain_id, label, description, system, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        eventType.id,
        eventType.domainId,
        eventType.label,
        eventType.description,
        eventType.createdAt,
        eventType.updatedAt
      );
    assignOwnedEntity("event_type", eventType.id, owner.id, context.actor);
    recordPsycheVocabularyIdempotencyReceipt({
      entityType: "event_type",
      ownerUserId: owner.id,
      idempotencyKey,
      fingerprint,
      entityId: eventType.id,
      payload,
      createdAt: now
    });
    mapCreateUpdateContext({
      entityType: "event_type",
      entityId: eventType.id,
      title: "Event type added",
      eventKind: "event_type.created",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { domainId: eventType.domainId }
    });
    return decorateOwnedEntity("event_type", eventType);
  });
}

export function updateEventType(
  eventTypeId: string,
  patch: UpdateEventTypeInput,
  context: PsycheContext
): EventType | undefined {
  const existing = getEventTypeById(eventTypeId);
  if (!existing) {
    return undefined;
  }
  requirePsycheVocabularyWriteScope(
    "event_type",
    eventTypeId,
    context,
    existing as unknown as Record<string, unknown>
  );

  const parsed = updateEventTypeSchema.parse(patch);
  const nextOwner =
    parsed.userId !== undefined
      ? resolvePsycheVocabularyOwner("event_type", parsed.userId, context)
      : null;
  const updated = eventTypeSchema.parse({
    ...existing,
    ...parsed,
    updatedAt: new Date().toISOString()
  });

  return runInTransaction(() => {
    requireUniquePsycheVocabularyLabel({
      entityType: "event_type",
      label: updated.label,
      ownerUserId: nextOwner?.id ?? getEntityOwnerId("event_type", eventTypeId),
      excludeId: eventTypeId
    });
    getDatabase()
      .prepare(
        `UPDATE event_types
         SET label = ?, description = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(updated.label, updated.description, updated.updatedAt, eventTypeId);
    if (nextOwner) {
      assignOwnedEntity("event_type", eventTypeId, nextOwner.id, context.actor);
    }

    mapCreateUpdateContext({
      entityType: "event_type",
      entityId: eventTypeId,
      title: "Event type updated",
      eventKind: "event_type.updated",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { domainId: updated.domainId }
    });

    return decorateOwnedEntity("event_type", updated);
  });
}

export function deleteEventType(
  eventTypeId: string,
  context: PsycheContext
): EventType | undefined {
  const existing = getEventTypeById(eventTypeId);
  if (!existing) {
    return undefined;
  }
  requirePsycheVocabularyWriteScope(
    "event_type",
    eventTypeId,
    context,
    existing as unknown as Record<string, unknown>
  );

  return runInTransaction(() => {
    unlinkEntityNotes("event_type", eventTypeId);
    clearEntityOwner("event_type", eventTypeId);
    getDatabase()
      .prepare(`DELETE FROM event_types WHERE id = ?`)
      .run(eventTypeId);

    mapCreateUpdateContext({
      entityType: "event_type",
      entityId: eventTypeId,
      title: "Event type deleted",
      eventKind: "event_type.deleted",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { domainId: existing.domainId }
    });
    return existing;
  });
}

export function listEmotionDefinitions(): EmotionDefinition[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, domain_id, label, description, category, system, created_at, updated_at
       FROM emotion_definitions
       WHERE domain_id = ?
       ORDER BY system DESC, label`
    )
    .all(PSYCHE_DOMAIN_ID) as EmotionDefinitionRow[];
  return filterDeletedEntities(
    "emotion_definition",
    rows.map(mapEmotionDefinition)
  );
}

export function getEmotionDefinitionById(
  emotionId: string
): EmotionDefinition | undefined {
  if (isEntityDeleted("emotion_definition", emotionId)) {
    return undefined;
  }
  const row = getRow<EmotionDefinitionRow>(
    `SELECT id, domain_id, label, description, category, system, created_at, updated_at
     FROM emotion_definitions
     WHERE id = ?`,
    emotionId
  );
  return row
    ? decorateOwnedEntity("emotion_definition", mapEmotionDefinition(row))
    : undefined;
}

export function createEmotionDefinition(
  input: CreateEmotionDefinitionInput,
  context: PsycheContext
): EmotionDefinition {
  const parsed = createEmotionDefinitionSchema.parse(input);
  const owner = resolvePsycheVocabularyOwner(
    "emotion_definition",
    parsed.userId,
    context
  );
  const idempotencyKey = context.idempotencyKey?.trim() || null;
  const payload: PsycheVocabularyCreatePayload = {
    label: parsed.label,
    description: parsed.description,
    category: parsed.category
  };
  const entityId = buildPsycheVocabularyId("emo", owner.id, idempotencyKey);
  const fingerprint = fingerprintPsycheVocabularyCreate({
    entityType: "emotion_definition",
    ownerUserId: owner.id,
    payload
  });
  const now = new Date().toISOString();
  const emotion = emotionDefinitionSchema.parse({
    id: entityId,
    domainId: PSYCHE_DOMAIN_ID,
    label: parsed.label,
    description: parsed.description,
    category: parsed.category,
    system: false,
    createdAt: now,
    updatedAt: now
  });
  return runInTransaction(() => {
    const receipt = resolvePsycheVocabularyIdempotencyReplay({
      entityType: "emotion_definition",
      ownerUserId: owner.id,
      idempotencyKey,
      entityId,
      payload,
      fingerprint
    });
    if (receipt) {
      const replayRow = getRow<EmotionDefinitionRow>(
        `SELECT id, domain_id, label, description, category, system, created_at, updated_at
         FROM emotion_definitions
         WHERE id = ?`,
        receipt.entity_id
      );
      if (
        !replayRow ||
        getEntityOwnerId("emotion_definition", receipt.entity_id) !== owner.id
      ) {
        throw new HttpError(
          409,
          "psyche_vocabulary_idempotency_target_deleted",
          "The original vocabulary entry is unavailable. This idempotency key remains consumed and cannot recreate it.",
          { entityType: "emotion_definition", entityId: receipt.entity_id }
        );
      }
      return decorateOwnedEntity(
        "emotion_definition",
        mapEmotionDefinition(replayRow)
      );
    }
    if (
      getRow<EmotionDefinitionRow>(
        `SELECT id, domain_id, label, description, category, system, created_at, updated_at
         FROM emotion_definitions
         WHERE id = ?`,
        emotion.id
      )
    ) {
      throw new HttpError(
        409,
        "idempotency_conflict",
        "The emotion definition id collides with an existing record."
      );
    }
    requireUniquePsycheVocabularyLabel({
      entityType: "emotion_definition",
      label: emotion.label,
      ownerUserId: owner.id
    });
    getDatabase()
      .prepare(
        `INSERT INTO emotion_definitions (id, domain_id, label, description, category, system, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        emotion.id,
        emotion.domainId,
        emotion.label,
        emotion.description,
        emotion.category,
        emotion.createdAt,
        emotion.updatedAt
      );
    assignOwnedEntity(
      "emotion_definition",
      emotion.id,
      owner.id,
      context.actor
    );
    recordPsycheVocabularyIdempotencyReceipt({
      entityType: "emotion_definition",
      ownerUserId: owner.id,
      idempotencyKey,
      fingerprint,
      entityId: emotion.id,
      payload,
      createdAt: now
    });
    mapCreateUpdateContext({
      entityType: "emotion_definition",
      entityId: emotion.id,
      title: "Emotion definition added",
      eventKind: "emotion_definition.created",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { domainId: emotion.domainId }
    });
    return decorateOwnedEntity("emotion_definition", emotion);
  });
}

export function updateEmotionDefinition(
  emotionId: string,
  patch: UpdateEmotionDefinitionInput,
  context: PsycheContext
): EmotionDefinition | undefined {
  const existing = getEmotionDefinitionById(emotionId);
  if (!existing) {
    return undefined;
  }
  requirePsycheVocabularyWriteScope(
    "emotion_definition",
    emotionId,
    context,
    existing as unknown as Record<string, unknown>
  );

  const parsed = updateEmotionDefinitionSchema.parse(patch);
  const nextOwner =
    parsed.userId !== undefined
      ? resolvePsycheVocabularyOwner(
          "emotion_definition",
          parsed.userId,
          context
        )
      : null;
  const updated = emotionDefinitionSchema.parse({
    ...existing,
    ...parsed,
    updatedAt: new Date().toISOString()
  });

  return runInTransaction(() => {
    requireUniquePsycheVocabularyLabel({
      entityType: "emotion_definition",
      label: updated.label,
      ownerUserId:
        nextOwner?.id ?? getEntityOwnerId("emotion_definition", emotionId),
      excludeId: emotionId
    });
    getDatabase()
      .prepare(
        `UPDATE emotion_definitions
         SET label = ?, description = ?, category = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        updated.label,
        updated.description,
        updated.category,
        updated.updatedAt,
        emotionId
      );
    if (nextOwner) {
      assignOwnedEntity(
        "emotion_definition",
        emotionId,
        nextOwner.id,
        context.actor
      );
    }

    mapCreateUpdateContext({
      entityType: "emotion_definition",
      entityId: emotionId,
      title: "Emotion definition updated",
      eventKind: "emotion_definition.updated",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { domainId: updated.domainId }
    });

    return decorateOwnedEntity("emotion_definition", updated);
  });
}

export function deleteEmotionDefinition(
  emotionId: string,
  context: PsycheContext
): EmotionDefinition | undefined {
  const existing = getEmotionDefinitionById(emotionId);
  if (!existing) {
    return undefined;
  }
  requirePsycheVocabularyWriteScope(
    "emotion_definition",
    emotionId,
    context,
    existing as unknown as Record<string, unknown>
  );

  return runInTransaction(() => {
    nullifyTriggerEmotionReferences(emotionId);
    unlinkEntityNotes("emotion_definition", emotionId);
    clearEntityOwner("emotion_definition", emotionId);
    getDatabase()
      .prepare(`DELETE FROM emotion_definitions WHERE id = ?`)
      .run(emotionId);

    mapCreateUpdateContext({
      entityType: "emotion_definition",
      entityId: emotionId,
      title: "Emotion definition deleted",
      eventKind: "emotion_definition.deleted",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { domainId: existing.domainId }
    });
    return existing;
  });
}

export function listPsycheValues(): PsycheValue[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
         id, domain_id, title, description, valued_direction, why_it_matters,
         linked_goal_ids_json, linked_project_ids_json, linked_task_ids_json, committed_actions_json, created_at, updated_at
       FROM psyche_values
       WHERE domain_id = ?
       ORDER BY updated_at DESC`
    )
    .all(PSYCHE_DOMAIN_ID) as PsycheValueRow[];
  return filterDeletedEntities("psyche_value", rows.map(mapPsycheValue));
}

export function getPsycheValueById(valueId: string): PsycheValue | undefined {
  if (isEntityDeleted("psyche_value", valueId)) {
    return undefined;
  }
  const row = getRow<PsycheValueRow>(
    `SELECT
       id, domain_id, title, description, valued_direction, why_it_matters,
       linked_goal_ids_json, linked_project_ids_json, linked_task_ids_json, committed_actions_json, created_at, updated_at
     FROM psyche_values
     WHERE id = ?`,
    valueId
  );
  return row
    ? decorateOwnedEntity("psyche_value", mapPsycheValue(row))
    : undefined;
}

export function createPsycheValue(
  input: CreatePsycheValueInput,
  context: PsycheContext
): PsycheValue {
  const parsed = createPsycheValueSchema.parse(input);
  const now = new Date().toISOString();
  const value = psycheValueSchema.parse({
    id: buildId("psy"),
    domainId: PSYCHE_DOMAIN_ID,
    title: parsed.title,
    description: parsed.description,
    valuedDirection: parsed.valuedDirection,
    whyItMatters: parsed.whyItMatters,
    linkedGoalIds: parsed.linkedGoalIds,
    linkedProjectIds: parsed.linkedProjectIds,
    linkedTaskIds: parsed.linkedTaskIds,
    committedActions: parsed.committedActions,
    createdAt: now,
    updatedAt: now
  });

  getDatabase()
    .prepare(
      `INSERT INTO psyche_values (
        id, domain_id, title, description, valued_direction, why_it_matters, linked_goal_ids_json, linked_project_ids_json,
        linked_task_ids_json, committed_actions_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      value.id,
      value.domainId,
      value.title,
      value.description,
      value.valuedDirection,
      value.whyItMatters,
      JSON.stringify(value.linkedGoalIds),
      JSON.stringify(value.linkedProjectIds),
      JSON.stringify(value.linkedTaskIds),
      JSON.stringify(value.committedActions),
      value.createdAt,
      value.updatedAt
    );
  assignOwnedEntity("psyche_value", value.id, parsed.userId, context.actor);

  mapCreateUpdateContext({
    entityType: "psyche_value",
    entityId: value.id,
    title: "Psyche value added",
    eventKind: "psyche_value.created",
    source: context.source,
    actor: context.actor ?? null,
    metadata: { domainId: value.domainId }
  });
  recordPsycheClarityReward(
    "psyche_value",
    value.id,
    value.title,
    "psyche_value_defined",
    context
  );
  return decorateOwnedEntity("psyche_value", value);
}

export function updatePsycheValue(
  valueId: string,
  patch: UpdatePsycheValueInput,
  context: PsycheContext
): PsycheValue | undefined {
  const existing = getPsycheValueById(valueId);
  if (!existing) {
    return undefined;
  }
  const parsed = updatePsycheValueSchema.parse(patch);
  const updated = psycheValueSchema.parse({
    ...existing,
    ...parsed,
    committedActions: parsed.committedActions ?? existing.committedActions,
    updatedAt: new Date().toISOString()
  });

  getDatabase()
    .prepare(
      `UPDATE psyche_values
       SET title = ?, description = ?, valued_direction = ?, why_it_matters = ?, linked_goal_ids_json = ?,
           linked_project_ids_json = ?, linked_task_ids_json = ?, committed_actions_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updated.title,
      updated.description,
      updated.valuedDirection,
      updated.whyItMatters,
      JSON.stringify(updated.linkedGoalIds),
      JSON.stringify(updated.linkedProjectIds),
      JSON.stringify(updated.linkedTaskIds),
      JSON.stringify(updated.committedActions),
      updated.updatedAt,
      valueId
    );
  if (parsed.userId !== undefined) {
    assignOwnedEntity("psyche_value", valueId, parsed.userId, context.actor);
  }

  mapCreateUpdateContext({
    entityType: "psyche_value",
    entityId: valueId,
    title: "Psyche value updated",
    eventKind: "psyche_value.updated",
    source: context.source,
    actor: context.actor ?? null,
    metadata: { domainId: updated.domainId }
  });
  return decorateOwnedEntity("psyche_value", updated);
}

export function deletePsycheValue(
  valueId: string,
  context: PsycheContext
): PsycheValue | undefined {
  const existing = getPsycheValueById(valueId);
  if (!existing) {
    return undefined;
  }

  return runInTransaction(() => {
    removeIdFromStringArrayColumn(
      "behavior_patterns",
      "linked_value_ids_json",
      valueId
    );
    removeIdFromStringArrayColumn(
      "psyche_behaviors",
      "linked_value_ids_json",
      valueId
    );
    removeIdFromStringArrayColumn(
      "belief_entries",
      "linked_value_ids_json",
      valueId
    );
    removeIdFromStringArrayColumn(
      "mode_profiles",
      "linked_value_ids_json",
      valueId
    );
    removeIdFromStringArrayColumn(
      "trigger_reports",
      "linked_value_ids_json",
      valueId
    );
    removeIdFromStringArrayColumn(
      "psyche_flashcards",
      "linked_value_ids_json",
      valueId
    );
    unlinkEntityNotes("psyche_value", valueId);
    clearEntityOwner("psyche_value", valueId);
    getDatabase()
      .prepare(`DELETE FROM psyche_values WHERE id = ?`)
      .run(valueId);

    mapCreateUpdateContext({
      entityType: "psyche_value",
      entityId: valueId,
      title: "Psyche value deleted",
      eventKind: "psyche_value.deleted",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { domainId: existing.domainId }
    });
    return existing;
  });
}

export function listBehaviorPatterns(): BehaviorPattern[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
         id, domain_id, title, description, target_behavior, cue_contexts_json, short_term_payoff, long_term_cost,
         preferred_response, linked_value_ids_json, linked_schema_labels_json, linked_mode_labels_json, linked_mode_ids_json,
         linked_belief_ids_json, created_at, updated_at
       FROM behavior_patterns
       WHERE domain_id = ?
       ORDER BY updated_at DESC`
    )
    .all(PSYCHE_DOMAIN_ID) as BehaviorPatternRow[];
  return filterDeletedEntities(
    "behavior_pattern",
    rows.map(mapBehaviorPattern)
  );
}

export function getBehaviorPatternById(
  patternId: string
): BehaviorPattern | undefined {
  if (isEntityDeleted("behavior_pattern", patternId)) {
    return undefined;
  }
  const row = getRow<BehaviorPatternRow>(
    `SELECT
       id, domain_id, title, description, target_behavior, cue_contexts_json, short_term_payoff, long_term_cost,
       preferred_response, linked_value_ids_json, linked_schema_labels_json, linked_mode_labels_json, linked_mode_ids_json,
       linked_belief_ids_json, created_at, updated_at
     FROM behavior_patterns
     WHERE id = ?`,
    patternId
  );
  return row
    ? decorateOwnedEntity("behavior_pattern", mapBehaviorPattern(row))
    : undefined;
}

export function createBehaviorPattern(
  input: CreateBehaviorPatternInput,
  context: PsycheContext
): BehaviorPattern {
  const parsed = createBehaviorPatternSchema.parse(input);
  const now = new Date().toISOString();
  const pattern = behaviorPatternSchema.parse({
    id: buildId("pat"),
    domainId: PSYCHE_DOMAIN_ID,
    title: parsed.title,
    description: parsed.description,
    targetBehavior: parsed.targetBehavior,
    cueContexts: parsed.cueContexts,
    shortTermPayoff: parsed.shortTermPayoff,
    longTermCost: parsed.longTermCost,
    preferredResponse: parsed.preferredResponse,
    linkedValueIds: parsed.linkedValueIds,
    linkedSchemaLabels: parsed.linkedSchemaLabels,
    linkedModeLabels: parsed.linkedModeLabels,
    linkedModeIds: parsed.linkedModeIds,
    linkedBeliefIds: parsed.linkedBeliefIds,
    createdAt: now,
    updatedAt: now
  });

  getDatabase()
    .prepare(
      `INSERT INTO behavior_patterns (
        id, domain_id, title, description, target_behavior, cue_contexts_json, short_term_payoff, long_term_cost,
        preferred_response, linked_value_ids_json, linked_schema_labels_json, linked_mode_labels_json, linked_mode_ids_json,
        linked_belief_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      pattern.id,
      pattern.domainId,
      pattern.title,
      pattern.description,
      pattern.targetBehavior,
      JSON.stringify(pattern.cueContexts),
      pattern.shortTermPayoff,
      pattern.longTermCost,
      pattern.preferredResponse,
      JSON.stringify(pattern.linkedValueIds),
      JSON.stringify(pattern.linkedSchemaLabels),
      JSON.stringify(pattern.linkedModeLabels),
      JSON.stringify(pattern.linkedModeIds),
      JSON.stringify(pattern.linkedBeliefIds),
      pattern.createdAt,
      pattern.updatedAt
    );
  assignOwnedEntity(
    "behavior_pattern",
    pattern.id,
    parsed.userId,
    context.actor
  );

  mapCreateUpdateContext({
    entityType: "behavior_pattern",
    entityId: pattern.id,
    title: "Behavior pattern added",
    eventKind: "behavior_pattern.created",
    source: context.source,
    actor: context.actor ?? null,
    metadata: { domainId: pattern.domainId }
  });
  recordPsycheClarityReward(
    "behavior_pattern",
    pattern.id,
    pattern.title,
    "psyche_pattern_defined",
    context
  );
  return decorateOwnedEntity("behavior_pattern", pattern);
}

export function updateBehaviorPattern(
  patternId: string,
  patch: UpdateBehaviorPatternInput,
  context: PsycheContext
): BehaviorPattern | undefined {
  const existing = getBehaviorPatternById(patternId);
  if (!existing) {
    return undefined;
  }
  const parsed = updateBehaviorPatternSchema.parse(patch);
  const updated = behaviorPatternSchema.parse({
    ...existing,
    ...parsed,
    updatedAt: new Date().toISOString()
  });

  getDatabase()
    .prepare(
      `UPDATE behavior_patterns
       SET title = ?, description = ?, target_behavior = ?, cue_contexts_json = ?, short_term_payoff = ?, long_term_cost = ?,
           preferred_response = ?, linked_value_ids_json = ?, linked_schema_labels_json = ?, linked_mode_labels_json = ?,
           linked_mode_ids_json = ?, linked_belief_ids_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updated.title,
      updated.description,
      updated.targetBehavior,
      JSON.stringify(updated.cueContexts),
      updated.shortTermPayoff,
      updated.longTermCost,
      updated.preferredResponse,
      JSON.stringify(updated.linkedValueIds),
      JSON.stringify(updated.linkedSchemaLabels),
      JSON.stringify(updated.linkedModeLabels),
      JSON.stringify(updated.linkedModeIds),
      JSON.stringify(updated.linkedBeliefIds),
      updated.updatedAt,
      patternId
    );
  if (parsed.userId !== undefined) {
    assignOwnedEntity(
      "behavior_pattern",
      patternId,
      parsed.userId,
      context.actor
    );
  }

  mapCreateUpdateContext({
    entityType: "behavior_pattern",
    entityId: patternId,
    title: "Behavior pattern updated",
    eventKind: "behavior_pattern.updated",
    source: context.source,
    actor: context.actor ?? null,
    metadata: { domainId: updated.domainId }
  });
  return decorateOwnedEntity("behavior_pattern", updated);
}

export function deleteBehaviorPattern(
  patternId: string,
  context: PsycheContext
): BehaviorPattern | undefined {
  const existing = getBehaviorPatternById(patternId);
  if (!existing) {
    return undefined;
  }

  return runInTransaction(() => {
    removeIdFromStringArrayColumn(
      "psyche_behaviors",
      "linked_pattern_ids_json",
      patternId
    );
    removeIdFromStringArrayColumn(
      "mode_profiles",
      "linked_pattern_ids_json",
      patternId
    );
    removeIdFromStringArrayColumn(
      "trigger_reports",
      "linked_pattern_ids_json",
      patternId
    );
    removeIdFromStringArrayColumn(
      "psyche_flashcards",
      "linked_pattern_ids_json",
      patternId
    );
    unlinkEntityNotes("behavior_pattern", patternId);
    clearEntityOwner("behavior_pattern", patternId);
    getDatabase()
      .prepare(`DELETE FROM behavior_patterns WHERE id = ?`)
      .run(patternId);

    mapCreateUpdateContext({
      entityType: "behavior_pattern",
      entityId: patternId,
      title: "Behavior pattern deleted",
      eventKind: "behavior_pattern.deleted",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { domainId: existing.domainId }
    });
    return existing;
  });
}

export function listBehaviors(): Behavior[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
         id, domain_id, kind, title, description, common_cues_json, urge_story, short_term_payoff, long_term_cost,
         replacement_move, repair_plan, linked_pattern_ids_json, linked_value_ids_json, linked_schema_ids_json,
         linked_mode_ids_json, created_at, updated_at
       FROM psyche_behaviors
       WHERE domain_id = ?
       ORDER BY kind, updated_at DESC`
    )
    .all(PSYCHE_DOMAIN_ID) as BehaviorRow[];
  return filterDeletedEntities("behavior", rows.map(mapBehavior));
}

export function getBehaviorById(behaviorId: string): Behavior | undefined {
  if (isEntityDeleted("behavior", behaviorId)) {
    return undefined;
  }
  const row = getRow<BehaviorRow>(
    `SELECT
       id, domain_id, kind, title, description, common_cues_json, urge_story, short_term_payoff, long_term_cost,
       replacement_move, repair_plan, linked_pattern_ids_json, linked_value_ids_json, linked_schema_ids_json,
       linked_mode_ids_json, created_at, updated_at
     FROM psyche_behaviors
     WHERE id = ?`,
    behaviorId
  );
  return row ? decorateOwnedEntity("behavior", mapBehavior(row)) : undefined;
}

export function createBehavior(
  input: CreateBehaviorInput,
  context: PsycheContext
): Behavior {
  const parsed = createBehaviorSchema.parse(input);
  const now = new Date().toISOString();
  const behavior = behaviorSchema.parse({
    id: buildId("bhv"),
    domainId: PSYCHE_DOMAIN_ID,
    ...parsed,
    createdAt: now,
    updatedAt: now
  });

  getDatabase()
    .prepare(
      `INSERT INTO psyche_behaviors (
        id, domain_id, kind, title, description, common_cues_json, urge_story, short_term_payoff, long_term_cost,
        replacement_move, repair_plan, linked_pattern_ids_json, linked_value_ids_json, linked_schema_ids_json, linked_mode_ids_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      behavior.id,
      behavior.domainId,
      behavior.kind,
      behavior.title,
      behavior.description,
      JSON.stringify(behavior.commonCues),
      behavior.urgeStory,
      behavior.shortTermPayoff,
      behavior.longTermCost,
      behavior.replacementMove,
      behavior.repairPlan,
      JSON.stringify(behavior.linkedPatternIds),
      JSON.stringify(behavior.linkedValueIds),
      JSON.stringify(behavior.linkedSchemaIds),
      JSON.stringify(behavior.linkedModeIds),
      behavior.createdAt,
      behavior.updatedAt
    );
  assignOwnedEntity("behavior", behavior.id, parsed.userId, context.actor);

  mapCreateUpdateContext({
    entityType: "behavior",
    entityId: behavior.id,
    title: "Behavior added",
    eventKind: "behavior.created",
    source: context.source,
    actor: context.actor ?? null,
    metadata: { kind: behavior.kind, domainId: behavior.domainId }
  });
  recordPsycheClarityReward(
    "behavior",
    behavior.id,
    behavior.title,
    "psyche_behavior_defined",
    context
  );
  return decorateOwnedEntity("behavior", behavior);
}

export function updateBehavior(
  behaviorId: string,
  patch: UpdateBehaviorInput,
  context: PsycheContext
): Behavior | undefined {
  const existing = getBehaviorById(behaviorId);
  if (!existing) {
    return undefined;
  }
  const parsed = updateBehaviorSchema.parse(patch);
  const updated = behaviorSchema.parse({
    ...existing,
    ...parsed,
    updatedAt: new Date().toISOString()
  });

  getDatabase()
    .prepare(
      `UPDATE psyche_behaviors
       SET kind = ?, title = ?, description = ?, common_cues_json = ?, urge_story = ?, short_term_payoff = ?, long_term_cost = ?,
           replacement_move = ?, repair_plan = ?, linked_pattern_ids_json = ?, linked_value_ids_json = ?, linked_schema_ids_json = ?,
           linked_mode_ids_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updated.kind,
      updated.title,
      updated.description,
      JSON.stringify(updated.commonCues),
      updated.urgeStory,
      updated.shortTermPayoff,
      updated.longTermCost,
      updated.replacementMove,
      updated.repairPlan,
      JSON.stringify(updated.linkedPatternIds),
      JSON.stringify(updated.linkedValueIds),
      JSON.stringify(updated.linkedSchemaIds),
      JSON.stringify(updated.linkedModeIds),
      updated.updatedAt,
      behaviorId
    );
  if (parsed.userId !== undefined) {
    assignOwnedEntity("behavior", behaviorId, parsed.userId, context.actor);
  }

  mapCreateUpdateContext({
    entityType: "behavior",
    entityId: behaviorId,
    title: "Behavior updated",
    eventKind: "behavior.updated",
    source: context.source,
    actor: context.actor ?? null,
    metadata: { kind: updated.kind, domainId: updated.domainId }
  });
  return decorateOwnedEntity("behavior", updated);
}

export function deleteBehavior(
  behaviorId: string,
  context: PsycheContext
): Behavior | undefined {
  const existing = getBehaviorById(behaviorId);
  if (!existing) {
    return undefined;
  }

  return runInTransaction(() => {
    removeIdFromStringArrayColumn(
      "belief_entries",
      "linked_behavior_ids_json",
      behaviorId
    );
    removeIdFromStringArrayColumn(
      "mode_profiles",
      "linked_behavior_ids_json",
      behaviorId
    );
    removeIdFromStringArrayColumn(
      "trigger_reports",
      "linked_behavior_ids_json",
      behaviorId
    );
    removeIdFromStringArrayColumn(
      "psyche_flashcards",
      "linked_behavior_ids_json",
      behaviorId
    );
    nullifyTriggerBehaviorReferences(behaviorId);
    unlinkEntityNotes("behavior", behaviorId);
    clearEntityOwner("behavior", behaviorId);
    getDatabase()
      .prepare(`DELETE FROM psyche_behaviors WHERE id = ?`)
      .run(behaviorId);

    mapCreateUpdateContext({
      entityType: "behavior",
      entityId: behaviorId,
      title: "Behavior deleted",
      eventKind: "behavior.deleted",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { kind: existing.kind, domainId: existing.domainId }
    });
    return existing;
  });
}

export function listBeliefEntries(): BeliefEntry[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
         id, domain_id, schema_id, statement, belief_type, origin_note, confidence, evidence_for_json, evidence_against_json,
         flexible_alternative, linked_value_ids_json, linked_behavior_ids_json, linked_mode_ids_json, linked_report_ids_json,
         created_at, updated_at
       FROM belief_entries
       WHERE domain_id = ?
       ORDER BY updated_at DESC`
    )
    .all(PSYCHE_DOMAIN_ID) as BeliefEntryRow[];
  return filterDeletedEntities("belief_entry", rows.map(mapBeliefEntry));
}

export function getBeliefEntryById(beliefId: string): BeliefEntry | undefined {
  if (isEntityDeleted("belief_entry", beliefId)) {
    return undefined;
  }
  const row = getRow<BeliefEntryRow>(
    `SELECT
       id, domain_id, schema_id, statement, belief_type, origin_note, confidence, evidence_for_json, evidence_against_json,
       flexible_alternative, linked_value_ids_json, linked_behavior_ids_json, linked_mode_ids_json, linked_report_ids_json,
       created_at, updated_at
     FROM belief_entries
     WHERE id = ?`,
    beliefId
  );
  return row
    ? decorateOwnedEntity("belief_entry", mapBeliefEntry(row))
    : undefined;
}

export function createBeliefEntry(
  input: CreateBeliefEntryInput,
  context: PsycheContext
): BeliefEntry {
  const parsed = createBeliefEntrySchema.parse(input);
  const now = new Date().toISOString();
  const belief = beliefEntrySchema.parse({
    id: buildId("blf"),
    domainId: PSYCHE_DOMAIN_ID,
    ...parsed,
    createdAt: now,
    updatedAt: now
  });

  getDatabase()
    .prepare(
      `INSERT INTO belief_entries (
        id, domain_id, schema_id, statement, belief_type, origin_note, confidence, evidence_for_json, evidence_against_json,
        flexible_alternative, linked_value_ids_json, linked_behavior_ids_json, linked_mode_ids_json, linked_report_ids_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      belief.id,
      belief.domainId,
      belief.schemaId,
      belief.statement,
      belief.beliefType,
      belief.originNote,
      belief.confidence,
      JSON.stringify(belief.evidenceFor),
      JSON.stringify(belief.evidenceAgainst),
      belief.flexibleAlternative,
      JSON.stringify(belief.linkedValueIds),
      JSON.stringify(belief.linkedBehaviorIds),
      JSON.stringify(belief.linkedModeIds),
      JSON.stringify(belief.linkedReportIds),
      belief.createdAt,
      belief.updatedAt
    );
  assignOwnedEntity("belief_entry", belief.id, parsed.userId, context.actor);

  mapCreateUpdateContext({
    entityType: "belief_entry",
    entityId: belief.id,
    title: "Belief captured",
    eventKind: "belief_entry.created",
    source: context.source,
    actor: context.actor ?? null,
    metadata: { schemaId: belief.schemaId ?? "" }
  });
  recordPsycheClarityReward(
    "belief_entry",
    belief.id,
    belief.statement,
    "psyche_belief_captured",
    context
  );
  return decorateOwnedEntity("belief_entry", belief);
}

export function updateBeliefEntry(
  beliefId: string,
  patch: UpdateBeliefEntryInput,
  context: PsycheContext
): BeliefEntry | undefined {
  const existing = getBeliefEntryById(beliefId);
  if (!existing) {
    return undefined;
  }
  const parsed = updateBeliefEntrySchema.parse(patch);
  const updated = beliefEntrySchema.parse({
    ...existing,
    ...parsed,
    updatedAt: new Date().toISOString()
  });

  getDatabase()
    .prepare(
      `UPDATE belief_entries
       SET schema_id = ?, statement = ?, belief_type = ?, origin_note = ?, confidence = ?, evidence_for_json = ?,
           evidence_against_json = ?, flexible_alternative = ?, linked_value_ids_json = ?, linked_behavior_ids_json = ?,
           linked_mode_ids_json = ?, linked_report_ids_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updated.schemaId,
      updated.statement,
      updated.beliefType,
      updated.originNote,
      updated.confidence,
      JSON.stringify(updated.evidenceFor),
      JSON.stringify(updated.evidenceAgainst),
      updated.flexibleAlternative,
      JSON.stringify(updated.linkedValueIds),
      JSON.stringify(updated.linkedBehaviorIds),
      JSON.stringify(updated.linkedModeIds),
      JSON.stringify(updated.linkedReportIds),
      updated.updatedAt,
      beliefId
    );
  if (parsed.userId !== undefined) {
    assignOwnedEntity("belief_entry", beliefId, parsed.userId, context.actor);
  }

  mapCreateUpdateContext({
    entityType: "belief_entry",
    entityId: beliefId,
    title: "Belief updated",
    eventKind: "belief_entry.updated",
    source: context.source,
    actor: context.actor ?? null,
    metadata: { schemaId: updated.schemaId ?? "" }
  });
  return decorateOwnedEntity("belief_entry", updated);
}

export function deleteBeliefEntry(
  beliefId: string,
  context: PsycheContext
): BeliefEntry | undefined {
  const existing = getBeliefEntryById(beliefId);
  if (!existing) {
    return undefined;
  }

  return runInTransaction(() => {
    removeIdFromStringArrayColumn(
      "behavior_patterns",
      "linked_belief_ids_json",
      beliefId
    );
    removeIdFromStringArrayColumn(
      "trigger_reports",
      "linked_belief_ids_json",
      beliefId
    );
    removeIdFromStringArrayColumn(
      "psyche_flashcards",
      "linked_belief_ids_json",
      beliefId
    );
    nullifyTriggerThoughtBeliefReferences(beliefId);
    unlinkEntityNotes("belief_entry", beliefId);
    clearEntityOwner("belief_entry", beliefId);
    getDatabase()
      .prepare(`DELETE FROM belief_entries WHERE id = ?`)
      .run(beliefId);

    mapCreateUpdateContext({
      entityType: "belief_entry",
      entityId: beliefId,
      title: "Belief deleted",
      eventKind: "belief_entry.deleted",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { schemaId: existing.schemaId ?? "" }
    });
    return existing;
  });
}

export function listModeProfiles(): ModeProfile[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
         id, domain_id, family, archetype, title, persona, imagery, symbolic_form, facial_expression, fear, burden, protective_job,
         origin_context, first_appearance_at, linked_pattern_ids_json, linked_behavior_ids_json, linked_value_ids_json, created_at, updated_at
       FROM mode_profiles
       WHERE domain_id = ?
       ORDER BY family, updated_at DESC`
    )
    .all(PSYCHE_DOMAIN_ID) as ModeProfileRow[];
  return filterDeletedEntities("mode_profile", rows.map(mapModeProfile));
}

export function getModeProfileById(modeId: string): ModeProfile | undefined {
  if (isEntityDeleted("mode_profile", modeId)) {
    return undefined;
  }
  const row = getRow<ModeProfileRow>(
    `SELECT
       id, domain_id, family, archetype, title, persona, imagery, symbolic_form, facial_expression, fear, burden, protective_job,
       origin_context, first_appearance_at, linked_pattern_ids_json, linked_behavior_ids_json, linked_value_ids_json, created_at, updated_at
     FROM mode_profiles
     WHERE id = ?`,
    modeId
  );
  return row
    ? decorateOwnedEntity("mode_profile", mapModeProfile(row))
    : undefined;
}

export function createModeProfile(
  input: CreateModeProfileInput,
  context: PsycheContext
): ModeProfile {
  const parsed = createModeProfileSchema.parse(input);
  const now = new Date().toISOString();
  const mode = modeProfileSchema.parse({
    id: buildId("mod"),
    domainId: PSYCHE_DOMAIN_ID,
    ...parsed,
    createdAt: now,
    updatedAt: now
  });

  getDatabase()
    .prepare(
      `INSERT INTO mode_profiles (
        id, domain_id, family, archetype, title, persona, imagery, symbolic_form, facial_expression, fear, burden, protective_job,
        origin_context, first_appearance_at, linked_pattern_ids_json, linked_behavior_ids_json, linked_value_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      mode.id,
      mode.domainId,
      mode.family,
      mode.archetype,
      mode.title,
      mode.persona,
      mode.imagery,
      mode.symbolicForm,
      mode.facialExpression,
      mode.fear,
      mode.burden,
      mode.protectiveJob,
      mode.originContext,
      mode.firstAppearanceAt,
      JSON.stringify(mode.linkedPatternIds),
      JSON.stringify(mode.linkedBehaviorIds),
      JSON.stringify(mode.linkedValueIds),
      mode.createdAt,
      mode.updatedAt
    );
  assignOwnedEntity("mode_profile", mode.id, parsed.userId, context.actor);

  mapCreateUpdateContext({
    entityType: "mode_profile",
    entityId: mode.id,
    title: "Mode profile added",
    eventKind: "mode_profile.created",
    source: context.source,
    actor: context.actor ?? null,
    metadata: { family: mode.family }
  });
  recordPsycheClarityReward(
    "mode_profile",
    mode.id,
    mode.title,
    "psyche_mode_named",
    context
  );
  return decorateOwnedEntity("mode_profile", mode);
}

export function updateModeProfile(
  modeId: string,
  patch: UpdateModeProfileInput,
  context: PsycheContext
): ModeProfile | undefined {
  const existing = getModeProfileById(modeId);
  if (!existing) {
    return undefined;
  }
  const parsed = updateModeProfileSchema.parse(patch);
  if (parsed.family) {
    modeFamilySchema.parse(parsed.family);
  }
  const updated = modeProfileSchema.parse({
    ...existing,
    ...parsed,
    updatedAt: new Date().toISOString()
  });

  getDatabase()
    .prepare(
      `UPDATE mode_profiles
       SET family = ?, archetype = ?, title = ?, persona = ?, imagery = ?, symbolic_form = ?, facial_expression = ?, fear = ?,
           burden = ?, protective_job = ?, origin_context = ?, first_appearance_at = ?, linked_pattern_ids_json = ?,
           linked_behavior_ids_json = ?, linked_value_ids_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updated.family,
      updated.archetype,
      updated.title,
      updated.persona,
      updated.imagery,
      updated.symbolicForm,
      updated.facialExpression,
      updated.fear,
      updated.burden,
      updated.protectiveJob,
      updated.originContext,
      updated.firstAppearanceAt,
      JSON.stringify(updated.linkedPatternIds),
      JSON.stringify(updated.linkedBehaviorIds),
      JSON.stringify(updated.linkedValueIds),
      updated.updatedAt,
      modeId
    );
  if (parsed.userId !== undefined) {
    assignOwnedEntity("mode_profile", modeId, parsed.userId, context.actor);
  }

  mapCreateUpdateContext({
    entityType: "mode_profile",
    entityId: modeId,
    title: "Mode profile updated",
    eventKind: "mode_profile.updated",
    source: context.source,
    actor: context.actor ?? null,
    metadata: { family: updated.family }
  });
  return decorateOwnedEntity("mode_profile", updated);
}

export function deleteModeProfile(
  modeId: string,
  context: PsycheContext
): ModeProfile | undefined {
  const existing = getModeProfileById(modeId);
  if (!existing) {
    return undefined;
  }

  return runInTransaction(() => {
    removeIdFromStringArrayColumn(
      "behavior_patterns",
      "linked_mode_ids_json",
      modeId
    );
    removeIdFromStringArrayColumn(
      "psyche_behaviors",
      "linked_mode_ids_json",
      modeId
    );
    removeIdFromStringArrayColumn(
      "belief_entries",
      "linked_mode_ids_json",
      modeId
    );
    removeIdFromStringArrayColumn(
      "trigger_reports",
      "linked_mode_ids_json",
      modeId
    );
    removeIdFromStringArrayColumn(
      "psyche_flashcards",
      "linked_mode_ids_json",
      modeId
    );
    nullifyTriggerTimelineModeReferences(modeId);
    unlinkEntityNotes("mode_profile", modeId);
    clearEntityOwner("mode_profile", modeId);
    getDatabase().prepare(`DELETE FROM mode_profiles WHERE id = ?`).run(modeId);

    mapCreateUpdateContext({
      entityType: "mode_profile",
      entityId: modeId,
      title: "Mode profile deleted",
      eventKind: "mode_profile.deleted",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { family: existing.family }
    });
    return existing;
  });
}

export function listModeGuideSessions(limit = 20): ModeGuideSession[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, summary, answers_json, results_json, created_at, updated_at
       FROM mode_guide_sessions
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as ModeGuideSessionRow[];
  return filterDeletedEntities(
    "mode_guide_session",
    rows.map(mapModeGuideSession)
  );
}

export function getModeGuideSessionById(
  sessionId: string
): ModeGuideSession | undefined {
  if (isEntityDeleted("mode_guide_session", sessionId)) {
    return undefined;
  }
  const row = getRow<ModeGuideSessionRow>(
    `SELECT id, summary, answers_json, results_json, created_at, updated_at
     FROM mode_guide_sessions
     WHERE id = ?`,
    sessionId
  );
  return row
    ? decorateOwnedEntity("mode_guide_session", mapModeGuideSession(row))
    : undefined;
}

export function createModeGuideSession(
  input: CreateModeGuideSessionInput,
  context: PsycheContext
): ModeGuideSession {
  const parsed = createModeGuideSessionSchema.parse(input);
  const now = new Date().toISOString();
  const session = modeGuideSessionSchema.parse({
    id: buildId("mgs"),
    summary: parsed.summary,
    answers: parsed.answers,
    results: scoreModeGuideSession(parsed),
    createdAt: now,
    updatedAt: now
  });

  getDatabase()
    .prepare(
      `INSERT INTO mode_guide_sessions (id, summary, answers_json, results_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      session.id,
      session.summary,
      JSON.stringify(session.answers),
      JSON.stringify(session.results),
      session.createdAt,
      session.updatedAt
    );
  assignOwnedEntity(
    "mode_guide_session",
    session.id,
    parsed.userId,
    context.actor
  );

  recordEventLog({
    eventKind: "mode_guide_session.created",
    entityType: "system",
    entityId: session.id,
    actor: context.actor ?? null,
    source: context.source,
    metadata: { summary: session.summary }
  });

  return decorateOwnedEntity("mode_guide_session", session);
}

export function updateModeGuideSession(
  sessionId: string,
  patch: UpdateModeGuideSessionInput,
  context: PsycheContext
): ModeGuideSession | undefined {
  const existing = getModeGuideSessionById(sessionId);
  if (!existing) {
    return undefined;
  }

  const parsed = updateModeGuideSessionSchema.parse(patch);
  const summary = parsed.summary ?? existing.summary;
  const answers = parsed.answers ?? existing.answers;
  const updated = modeGuideSessionSchema.parse({
    ...existing,
    summary,
    answers,
    results: scoreModeGuideSession({ summary, answers }),
    updatedAt: new Date().toISOString()
  });

  getDatabase()
    .prepare(
      `UPDATE mode_guide_sessions
       SET summary = ?, answers_json = ?, results_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updated.summary,
      JSON.stringify(updated.answers),
      JSON.stringify(updated.results),
      updated.updatedAt,
      sessionId
    );
  if (parsed.userId !== undefined) {
    assignOwnedEntity(
      "mode_guide_session",
      sessionId,
      parsed.userId,
      context.actor
    );
  }

  recordEventLog({
    eventKind: "mode_guide_session.updated",
    entityType: "system",
    entityId: sessionId,
    actor: context.actor ?? null,
    source: context.source,
    metadata: { summary: updated.summary }
  });

  return decorateOwnedEntity("mode_guide_session", updated);
}

export function deleteModeGuideSession(
  sessionId: string,
  context: PsycheContext
): ModeGuideSession | undefined {
  const existing = getModeGuideSessionById(sessionId);
  if (!existing) {
    return undefined;
  }

  return runInTransaction(() => {
    clearEntityOwner("mode_guide_session", sessionId);
    getDatabase()
      .prepare(`DELETE FROM mode_guide_sessions WHERE id = ?`)
      .run(sessionId);

    recordEventLog({
      eventKind: "mode_guide_session.deleted",
      entityType: "system",
      entityId: sessionId,
      actor: context.actor ?? null,
      source: context.source,
      metadata: { summary: existing.summary }
    });
    return existing;
  });
}

const FLASHCARD_SELECT = `SELECT
  id, domain_id, title, message, trigger_sentence, trigger_situation, tags_json,
  background_color, text_color, accent_color, typography, image_url, image_alt,
  layout, visual_style, linked_value_ids_json, linked_behavior_ids_json,
  linked_pattern_ids_json, linked_belief_ids_json, linked_mode_ids_json,
  linked_report_ids_json, created_at, updated_at
 FROM psyche_flashcards`;

export function listFlashcards(): Flashcard[] {
  const rows = getDatabase()
    .prepare(
      `${FLASHCARD_SELECT}
       WHERE domain_id = ?
       ORDER BY updated_at DESC`
    )
    .all(PSYCHE_DOMAIN_ID) as FlashcardRow[];
  return filterDeletedEntities("flashcard", rows.map(mapFlashcard));
}

export function getFlashcardById(flashcardId: string): Flashcard | undefined {
  if (isEntityDeleted("flashcard", flashcardId)) {
    return undefined;
  }
  const row = getRow<FlashcardRow>(
    `${FLASHCARD_SELECT}
     WHERE id = ?`,
    flashcardId
  );
  return row ? decorateOwnedEntity("flashcard", mapFlashcard(row)) : undefined;
}

export function createFlashcard(
  input: CreateFlashcardInput,
  context: PsycheContext
): Flashcard {
  const parsed = createFlashcardSchema.parse(input);
  const now = new Date().toISOString();
  const flashcard = flashcardSchema.parse({
    id: buildId("flc"),
    domainId: PSYCHE_DOMAIN_ID,
    ...parsed,
    createdAt: now,
    updatedAt: now
  });

  getDatabase()
    .prepare(
      `INSERT INTO psyche_flashcards (
        id, domain_id, title, message, trigger_sentence, trigger_situation, tags_json,
        background_color, text_color, accent_color, typography, image_url, image_alt,
        layout, visual_style, linked_value_ids_json, linked_behavior_ids_json,
        linked_pattern_ids_json, linked_belief_ids_json, linked_mode_ids_json,
        linked_report_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      flashcard.id,
      flashcard.domainId,
      flashcard.title,
      flashcard.message,
      flashcard.triggerSentence,
      flashcard.triggerSituation,
      JSON.stringify(flashcard.tags),
      flashcard.backgroundColor,
      flashcard.textColor,
      flashcard.accentColor,
      flashcard.typography,
      flashcard.imageUrl,
      flashcard.imageAlt,
      flashcard.layout,
      flashcard.visualStyle,
      JSON.stringify(flashcard.linkedValueIds),
      JSON.stringify(flashcard.linkedBehaviorIds),
      JSON.stringify(flashcard.linkedPatternIds),
      JSON.stringify(flashcard.linkedBeliefIds),
      JSON.stringify(flashcard.linkedModeIds),
      JSON.stringify(flashcard.linkedReportIds),
      flashcard.createdAt,
      flashcard.updatedAt
    );
  assignOwnedEntity("flashcard", flashcard.id, parsed.userId, context.actor);

  mapCreateUpdateContext({
    entityType: "flashcard",
    entityId: flashcard.id,
    title: "Flashcard added",
    eventKind: "flashcard.created",
    source: context.source,
    actor: context.actor ?? null,
    metadata: { domainId: flashcard.domainId }
  });
  return decorateOwnedEntity("flashcard", flashcard);
}

export function updateFlashcard(
  flashcardId: string,
  patch: UpdateFlashcardInput,
  context: PsycheContext
): Flashcard | undefined {
  const existing = getFlashcardById(flashcardId);
  if (!existing) {
    return undefined;
  }
  const parsed = updateFlashcardSchema.parse(patch);
  const updated = flashcardSchema.parse({
    ...existing,
    ...parsed,
    updatedAt: new Date().toISOString()
  });

  getDatabase()
    .prepare(
      `UPDATE psyche_flashcards
       SET title = ?, message = ?, trigger_sentence = ?, trigger_situation = ?,
           tags_json = ?, background_color = ?, text_color = ?, accent_color = ?,
           typography = ?, image_url = ?, image_alt = ?, layout = ?, visual_style = ?,
           linked_value_ids_json = ?, linked_behavior_ids_json = ?, linked_pattern_ids_json = ?,
           linked_belief_ids_json = ?, linked_mode_ids_json = ?, linked_report_ids_json = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      updated.title,
      updated.message,
      updated.triggerSentence,
      updated.triggerSituation,
      JSON.stringify(updated.tags),
      updated.backgroundColor,
      updated.textColor,
      updated.accentColor,
      updated.typography,
      updated.imageUrl,
      updated.imageAlt,
      updated.layout,
      updated.visualStyle,
      JSON.stringify(updated.linkedValueIds),
      JSON.stringify(updated.linkedBehaviorIds),
      JSON.stringify(updated.linkedPatternIds),
      JSON.stringify(updated.linkedBeliefIds),
      JSON.stringify(updated.linkedModeIds),
      JSON.stringify(updated.linkedReportIds),
      updated.updatedAt,
      flashcardId
    );
  if (parsed.userId !== undefined) {
    assignOwnedEntity("flashcard", flashcardId, parsed.userId, context.actor);
  }

  mapCreateUpdateContext({
    entityType: "flashcard",
    entityId: flashcardId,
    title: "Flashcard updated",
    eventKind: "flashcard.updated",
    source: context.source,
    actor: context.actor ?? null,
    metadata: { domainId: updated.domainId }
  });
  return decorateOwnedEntity("flashcard", updated);
}

export function deleteFlashcard(
  flashcardId: string,
  context: PsycheContext
): Flashcard | undefined {
  const existing = getFlashcardById(flashcardId);
  if (!existing) {
    return undefined;
  }

  return runInTransaction(() => {
    unlinkEntityNotes("flashcard", flashcardId);
    clearEntityOwner("flashcard", flashcardId);
    getDatabase()
      .prepare(`DELETE FROM psyche_flashcards WHERE id = ?`)
      .run(flashcardId);

    mapCreateUpdateContext({
      entityType: "flashcard",
      entityId: flashcardId,
      title: "Flashcard deleted",
      eventKind: "flashcard.deleted",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { domainId: existing.domainId }
    });
    return existing;
  });
}

const TRIGGER_REPORT_SELECT = `SELECT
  trigger_reports.id, trigger_reports.domain_id, trigger_reports.title,
  trigger_reports.status, trigger_reports.event_type_id,
  trigger_reports.custom_event_type, trigger_reports.event_situation,
  trigger_reports.occurred_at, trigger_reports.body_cues_json,
  trigger_reports.emotions_json, trigger_reports.thoughts_json,
  trigger_reports.behaviors_json, trigger_reports.consequences_json,
  trigger_reports.linked_pattern_ids_json,
  trigger_reports.linked_value_ids_json,
  trigger_reports.linked_goal_ids_json,
  trigger_reports.linked_project_ids_json,
  trigger_reports.linked_task_ids_json,
  trigger_reports.linked_behavior_ids_json,
  trigger_reports.linked_belief_ids_json,
  trigger_reports.linked_mode_ids_json,
  trigger_reports.mode_overlays_json, trigger_reports.schema_links_json,
  trigger_reports.mode_timeline_json, trigger_reports.next_moves_json,
  trigger_reports.memory_clarity, trigger_reports.reflection,
  trigger_reports.hypothesis, trigger_reports.hypothesis_fit,
  trigger_reports.hypothesis_correction,
  trigger_reports.interpretation_consent, trigger_reports.revision,
  trigger_reports.created_at, trigger_reports.updated_at
 FROM trigger_reports`;

type TriggerReportCursor = {
  createdAt: string;
  id: string;
};

function encodeTriggerReportCursor(cursor: TriggerReportCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeTriggerReportCursor(cursor: string): TriggerReportCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as Partial<TriggerReportCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new HttpError(
      400,
      "trigger_report_cursor_invalid",
      "The trigger report cursor is invalid."
    );
  }
}

function triggerReportScopeSql(userIds: readonly string[]) {
  if (userIds.length === 0) {
    return { sql: "", params: [] as string[] };
  }
  return {
    sql: `AND EXISTS (
      SELECT 1
      FROM entity_owners
      WHERE entity_owners.entity_type = 'trigger_report'
        AND entity_owners.entity_id = trigger_reports.id
        AND entity_owners.user_id IN (${userIds.map(() => "?").join(", ")})
        AND entity_owners.role = 'owner'
    )`,
    params: [...userIds]
  };
}

export function listTriggerReportsPage(
  options: {
    limit?: number;
    cursor?: string;
    userIds?: string[];
  } = {}
) {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const userIds = [...new Set(options.userIds ?? [])];
  const scope = triggerReportScopeSql(userIds);
  const cursor = options.cursor
    ? decodeTriggerReportCursor(options.cursor)
    : null;
  const cursorSql = cursor
    ? `AND (
        trigger_reports.created_at < ?
        OR (
          trigger_reports.created_at = ?
          AND trigger_reports.id < ?
        )
      )`
    : "";
  const cursorParams = cursor
    ? [cursor.createdAt, cursor.createdAt, cursor.id]
    : [];
  const baseWhere = `trigger_reports.domain_id = ?
    AND NOT EXISTS (
      SELECT 1
      FROM deleted_entities
      WHERE deleted_entities.entity_type = 'trigger_report'
        AND deleted_entities.entity_id = trigger_reports.id
    )
    ${scope.sql}`;
  const rows = getDatabase()
    .prepare(
      `${TRIGGER_REPORT_SELECT}
       WHERE ${baseWhere}
       ${cursorSql}
       ORDER BY trigger_reports.created_at DESC, trigger_reports.id DESC
       LIMIT ?`
    )
    .all(
      PSYCHE_DOMAIN_ID,
      ...scope.params,
      ...cursorParams,
      limit + 1
    ) as TriggerReportRow[];
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const reports = pageRows.map((row) =>
    decorateOwnedEntity("trigger_report", mapTriggerReport(row))
  );
  const total = (
    getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM trigger_reports
         WHERE ${baseWhere}`
      )
      .get(PSYCHE_DOMAIN_ID, ...scope.params) as { count: number }
  ).count;
  const last = pageRows.at(-1);
  return {
    reports,
    total,
    limit,
    nextCursor:
      hasMore && last
        ? encodeTriggerReportCursor({
            createdAt: last.created_at,
            id: last.id
          })
        : null,
    hasMore
  };
}

export function listTriggerReports(limit = 200): TriggerReport[] {
  const boundedLimit = Math.min(Math.max(limit, 1), 1_000);
  const reports: TriggerReport[] = [];
  let cursor: string | undefined;

  while (reports.length < boundedLimit) {
    const page = listTriggerReportsPage({
      limit: Math.min(100, boundedLimit - reports.length),
      cursor
    });
    reports.push(...page.reports);
    if (!page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }

  return reports;
}

function escapeTriggerReportLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

export function searchTriggerReports(options: {
  userIds?: string[];
  ids?: string[];
  query?: string;
  statuses?: string[];
  linkedTo?: { entityType: string; id: string };
  limit?: number;
}): TriggerReport[] {
  const userIds = [...new Set(options.userIds ?? [])];
  const ids = [...new Set(options.ids ?? [])];
  const statuses = [...new Set(options.statuses ?? [])];
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 200);
  const scope = triggerReportScopeSql(userIds);
  const clauses = [
    "trigger_reports.domain_id = ?",
    `NOT EXISTS (
      SELECT 1
      FROM deleted_entities
      WHERE deleted_entities.entity_type = 'trigger_report'
        AND deleted_entities.entity_id = trigger_reports.id
    )`
  ];
  const params: Array<string | number> = [PSYCHE_DOMAIN_ID];

  if (scope.sql) {
    clauses.push(scope.sql.replace(/^AND\s+/, ""));
    params.push(...scope.params);
  }
  if (ids.length > 0) {
    clauses.push(`trigger_reports.id IN (${ids.map(() => "?").join(", ")})`);
    params.push(...ids);
  }
  if (statuses.length > 0) {
    clauses.push(
      `trigger_reports.status IN (${statuses.map(() => "?").join(", ")})`
    );
    params.push(...statuses);
  }
  const query = options.query?.trim().toLowerCase();
  if (query) {
    const searchableColumns = [
      "trigger_reports.id",
      "trigger_reports.title",
      "trigger_reports.status",
      "trigger_reports.custom_event_type",
      "trigger_reports.event_situation",
      "trigger_reports.body_cues_json",
      "trigger_reports.emotions_json",
      "trigger_reports.thoughts_json",
      "trigger_reports.behaviors_json",
      "trigger_reports.consequences_json",
      "trigger_reports.mode_overlays_json",
      "trigger_reports.schema_links_json",
      "trigger_reports.next_moves_json",
      "trigger_reports.reflection",
      "trigger_reports.hypothesis",
      "trigger_reports.hypothesis_correction"
    ];
    const pattern = `%${escapeTriggerReportLike(query)}%`;
    clauses.push(
      `(${searchableColumns
        .map((column) => `LOWER(COALESCE(${column}, '')) LIKE ? ESCAPE '\\'`)
        .join(" OR ")})`
    );
    params.push(...searchableColumns.map(() => pattern));
  }
  if (options.linkedTo) {
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM entity_links
        WHERE (
          entity_links.source_entity_type = 'trigger_report'
          AND entity_links.source_entity_id = trigger_reports.id
          AND entity_links.target_entity_type = ?
          AND entity_links.target_entity_id = ?
        ) OR (
          entity_links.target_entity_type = 'trigger_report'
          AND entity_links.target_entity_id = trigger_reports.id
          AND entity_links.source_entity_type = ?
          AND entity_links.source_entity_id = ?
        )
      )`
    );
    params.push(
      options.linkedTo.entityType,
      options.linkedTo.id,
      options.linkedTo.entityType,
      options.linkedTo.id
    );
  }

  const rows = getDatabase()
    .prepare(
      `${TRIGGER_REPORT_SELECT}
       WHERE ${clauses.join(" AND ")}
       ORDER BY trigger_reports.created_at DESC, trigger_reports.id DESC
       LIMIT ?`
    )
    .all(...params, limit) as TriggerReportRow[];
  return rows.map((row) =>
    decorateOwnedEntity("trigger_report", mapTriggerReport(row))
  );
}

export function getTriggerReportById(
  reportId: string,
  options: { userIds?: string[] } = {}
): TriggerReport | undefined {
  const report = getPersistedTriggerReportById(reportId, options);
  return report ? serializeTriggerReport(report) : undefined;
}

function getPersistedTriggerReportById(
  reportId: string,
  options: { userIds?: string[] } = {}
): TriggerReport | undefined {
  if (isEntityDeleted("trigger_report", reportId)) {
    return undefined;
  }
  const row = getRow<TriggerReportRow>(
    `${TRIGGER_REPORT_SELECT}
     WHERE trigger_reports.id = ?`,
    reportId
  );
  if (!row) {
    return undefined;
  }
  const report = decorateOwnedEntity(
    "trigger_report",
    mapPersistedTriggerReport(row)
  );
  return options.userIds?.length &&
    !options.userIds.includes(report.userId ?? "")
    ? undefined
    : report;
}

function resolveTriggerReportOwner(
  requestedUserId: string | null | undefined,
  context: PsycheContext
) {
  const allowedUserIds = [...new Set(context.userIds ?? [])];
  if (
    requestedUserId &&
    allowedUserIds.length > 0 &&
    !allowedUserIds.includes(requestedUserId)
  ) {
    throw new HttpError(
      403,
      "user_scope_forbidden",
      "The requested trigger report owner is outside this token's allowed users."
    );
  }
  if (!requestedUserId && allowedUserIds.length > 1) {
    throw new HttpError(
      400,
      "trigger_report_owner_required",
      "Choose one owner for this trigger report."
    );
  }
  const owner = resolveUserForMutation(
    requestedUserId ?? allowedUserIds[0],
    context.actor
  );
  if (allowedUserIds.length > 0 && !allowedUserIds.includes(owner.id)) {
    throw new HttpError(
      403,
      "user_scope_forbidden",
      "The trigger report owner is outside this token's allowed users."
    );
  }
  return owner;
}

function requireTriggerReportWriteScope(
  reportId: string,
  context: PsycheContext
) {
  const allowedUserIds = context.userIds ?? [];
  if (allowedUserIds.length === 0) {
    return;
  }
  const ownerUserId = getEntityOwnerId("trigger_report", reportId);
  if (!ownerUserId || !allowedUserIds.includes(ownerUserId)) {
    throw new HttpError(
      404,
      "trigger_report_not_found",
      "Trigger report not found."
    );
  }
}

const TRIGGER_LINK_TARGETS = {
  event_type: "event_types",
  behavior_pattern: "behavior_patterns",
  psyche_value: "psyche_values",
  goal: "goals",
  project: "projects",
  task: "tasks",
  behavior: "psyche_behaviors",
  belief_entry: "belief_entries",
  mode_profile: "mode_profiles",
  emotion_definition: "emotion_definitions"
} as const;

const TRIGGER_REPORT_MANAGED_RELATIONSHIPS = new Set([
  "event_context",
  "pattern_context",
  "value_context",
  "goal_context",
  "project_context",
  "task_context",
  "behavior_context",
  "belief_context",
  "mode_context",
  "emotion_context",
  "thought_belief",
  "observed_behavior",
  "mode_timeline"
]);

function buildTriggerReportLinks(
  report: Pick<
    TriggerReport,
    | "eventTypeId"
    | "linkedPatternIds"
    | "linkedValueIds"
    | "linkedGoalIds"
    | "linkedProjectIds"
    | "linkedTaskIds"
    | "linkedBehaviorIds"
    | "linkedBeliefIds"
    | "linkedModeIds"
    | "emotions"
    | "thoughts"
    | "behaviors"
    | "modeTimeline"
  >
): EntityLinkInput[] {
  const links: EntityLinkInput[] = [];
  const add = (
    entityType: keyof typeof TRIGGER_LINK_TARGETS,
    ids: Array<string | null | undefined>,
    relationship: string
  ) => {
    for (const entityId of ids) {
      if (entityId) {
        links.push({ entityType, entityId, relationship });
      }
    }
  };
  add("event_type", [report.eventTypeId], "event_context");
  add("behavior_pattern", report.linkedPatternIds, "pattern_context");
  add("psyche_value", report.linkedValueIds, "value_context");
  add("goal", report.linkedGoalIds, "goal_context");
  add("project", report.linkedProjectIds, "project_context");
  add("task", report.linkedTaskIds, "task_context");
  add("behavior", report.linkedBehaviorIds, "behavior_context");
  add("belief_entry", report.linkedBeliefIds, "belief_context");
  add("mode_profile", report.linkedModeIds, "mode_context");
  add(
    "emotion_definition",
    report.emotions.map((entry) => entry.emotionDefinitionId),
    "emotion_context"
  );
  add(
    "belief_entry",
    report.thoughts.map((entry) => entry.beliefId),
    "thought_belief"
  );
  add(
    "behavior",
    report.behaviors.map((entry) => entry.behaviorId),
    "observed_behavior"
  );
  add(
    "mode_profile",
    report.modeTimeline.map((entry) => entry.modeId),
    "mode_timeline"
  );
  return links;
}

function validateTriggerReportLinks(
  links: EntityLinkInput[],
  context: PsycheContext,
  allowedDeletedKeys: ReadonlySet<string> = new Set()
) {
  const allowedUserIds = new Set(context.userIds ?? []);
  const seen = new Set<string>();
  for (const link of links) {
    const entityType = link.entityType as keyof typeof TRIGGER_LINK_TARGETS;
    const key = `${entityType}:${link.entityId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const table = TRIGGER_LINK_TARGETS[entityType];
    const exists = getDatabase()
      .prepare(`SELECT 1 AS present FROM ${table} WHERE id = ? LIMIT 1`)
      .get(link.entityId) as { present: number } | undefined;
    if (
      !exists ||
      (isEntityDeleted(entityType, link.entityId) &&
        !allowedDeletedKeys.has(key))
    ) {
      throw new HttpError(
        400,
        "trigger_report_link_invalid",
        `Linked ${entityType} record ${link.entityId} was not found.`
      );
    }
    const ownerUserId = getEntityOwnerId(entityType, link.entityId);
    if (
      allowedUserIds.size > 0 &&
      ownerUserId &&
      !allowedUserIds.has(ownerUserId)
    ) {
      throw new HttpError(
        404,
        "trigger_report_link_not_found",
        "One linked record was not found in the allowed user scope."
      );
    }
  }
}

function validateTriggerInterpretation(
  report: Pick<
    TriggerReport,
    | "hypothesis"
    | "hypothesisFit"
    | "hypothesisCorrection"
    | "interpretationConsent"
  >
) {
  const hasHypothesis = report.hypothesis.trim().length > 0;
  const hasCorrection = report.hypothesisCorrection.trim().length > 0;
  const hasInterpretation =
    hasHypothesis || hasCorrection || report.hypothesisFit !== "not_reviewed";
  if (hasInterpretation && !report.interpretationConsent) {
    throw new HttpError(
      400,
      "trigger_report_interpretation_consent_required",
      "Confirm or correct the tentative interpretation before storing it."
    );
  }
  if (
    !hasHypothesis &&
    (hasCorrection || report.hypothesisFit !== "not_reviewed")
  ) {
    throw new HttpError(
      400,
      "trigger_report_hypothesis_required",
      "A hypothesis fit or correction cannot be recorded without a tentative hypothesis."
    );
  }
}

export function createTriggerReport(
  input: CreateTriggerReportInput,
  context: PsycheContext
): TriggerReport {
  const parsed = createTriggerReportSchema.parse(input);
  const owner = resolveTriggerReportOwner(parsed.userId, context);
  const selectedEventType = parsed.eventTypeId
    ? requireReadablePsycheVocabularyReference(
        "event_type",
        parsed.eventTypeId,
        context
      )
    : null;
  for (const emotion of parsed.emotions) {
    if (emotion.emotionDefinitionId) {
      requireReadablePsycheVocabularyReference(
        "emotion_definition",
        emotion.emotionDefinitionId,
        context
      );
    }
  }
  const customEventType =
    parsed.customEventType.trim() || selectedEventType?.label || "";
  const now = new Date().toISOString();
  const report = triggerReportSchema.parse({
    id: buildId("trg"),
    domainId: PSYCHE_DOMAIN_ID,
    title: parsed.title,
    status: parsed.status,
    eventTypeId: parsed.eventTypeId,
    customEventType,
    eventSituation: parsed.eventSituation,
    occurredAt: parsed.occurredAt,
    bodyCues: parsed.bodyCues,
    emotions: enrichTriggerItems(parsed.emotions, "emo"),
    thoughts: enrichTriggerItems(parsed.thoughts, "tht"),
    behaviors: enrichTriggerItems(parsed.behaviors, "beh"),
    consequences: parsed.consequences,
    linkedPatternIds: parsed.linkedPatternIds,
    linkedValueIds: parsed.linkedValueIds,
    linkedGoalIds: parsed.linkedGoalIds,
    linkedProjectIds: parsed.linkedProjectIds,
    linkedTaskIds: parsed.linkedTaskIds,
    linkedBehaviorIds: parsed.linkedBehaviorIds,
    linkedBeliefIds: parsed.linkedBeliefIds,
    linkedModeIds: parsed.linkedModeIds,
    modeOverlays: parsed.modeOverlays,
    schemaLinks: parsed.schemaLinks,
    modeTimeline: enrichTriggerItems(parsed.modeTimeline, "mdl").map((entry) =>
      modeTimelineEntrySchema.parse(entry)
    ),
    nextMoves: parsed.nextMoves,
    memoryClarity: parsed.memoryClarity,
    reflection: parsed.reflection,
    hypothesis: parsed.hypothesis,
    hypothesisFit: parsed.hypothesisFit,
    hypothesisCorrection: parsed.hypothesisCorrection,
    interpretationConsent: parsed.interpretationConsent,
    revision: 1,
    createdAt: now,
    updatedAt: now
  });
  const links = buildTriggerReportLinks(report);
  const idempotencyKey = context.idempotencyKey?.trim() || null;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ ownerUserId: owner.id, report: parsed }))
    .digest("hex");

  return runInTransaction(() => {
    if (idempotencyKey) {
      const existingReceipt = getDatabase()
        .prepare(
          `SELECT request_fingerprint, report_id
           FROM trigger_report_create_idempotency
           WHERE owner_user_id = ? AND idempotency_key = ?`
        )
        .get(owner.id, idempotencyKey) as
        | { request_fingerprint: string; report_id: string }
        | undefined;
      if (existingReceipt) {
        if (existingReceipt.request_fingerprint !== fingerprint) {
          throw new HttpError(
            409,
            "idempotency_conflict",
            "This idempotency key was already used for a different trigger report."
          );
        }
        const replay = getTriggerReportById(existingReceipt.report_id, {
          userIds: context.userIds
        });
        if (!replay) {
          throw new HttpError(
            409,
            "idempotency_target_missing",
            "The original trigger report for this idempotency key is unavailable."
          );
        }
        return replay;
      }
    }

    validateTriggerReportLinks(links, context);
    validateTriggerInterpretation(report);

    getDatabase()
      .prepare(
        `INSERT INTO trigger_reports (
          id, domain_id, title, status, event_type_id, custom_event_type,
          event_situation, occurred_at, body_cues_json, emotions_json,
          thoughts_json, behaviors_json, consequences_json,
          linked_pattern_ids_json, linked_value_ids_json,
          linked_goal_ids_json, linked_project_ids_json,
          linked_task_ids_json, linked_behavior_ids_json,
          linked_belief_ids_json, linked_mode_ids_json, mode_overlays_json,
          schema_links_json, mode_timeline_json, next_moves_json,
          memory_clarity, reflection, hypothesis, hypothesis_fit,
          hypothesis_correction, interpretation_consent, revision,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        report.id,
        report.domainId,
        report.title,
        report.status,
        report.eventTypeId,
        report.customEventType,
        report.eventSituation,
        report.occurredAt,
        JSON.stringify(report.bodyCues),
        JSON.stringify(report.emotions),
        JSON.stringify(report.thoughts),
        JSON.stringify(report.behaviors),
        JSON.stringify(report.consequences),
        JSON.stringify(report.linkedPatternIds),
        JSON.stringify(report.linkedValueIds),
        JSON.stringify(report.linkedGoalIds),
        JSON.stringify(report.linkedProjectIds),
        JSON.stringify(report.linkedTaskIds),
        JSON.stringify(report.linkedBehaviorIds),
        JSON.stringify(report.linkedBeliefIds),
        JSON.stringify(report.linkedModeIds),
        JSON.stringify(report.modeOverlays),
        JSON.stringify(report.schemaLinks),
        JSON.stringify(report.modeTimeline),
        JSON.stringify(report.nextMoves),
        report.memoryClarity,
        report.reflection,
        report.hypothesis,
        report.hypothesisFit,
        report.hypothesisCorrection,
        report.interpretationConsent ? 1 : 0,
        report.revision,
        report.createdAt,
        report.updatedAt
      );
    assignOwnedEntity("trigger_report", report.id, owner.id, context.actor);
    replaceEntityLinksForSource({
      sourceEntityType: "trigger_report",
      sourceEntityId: report.id,
      links,
      actor: context.actor
    });
    mapCreateUpdateContext({
      entityType: "trigger_report",
      entityId: report.id,
      title: "Trigger report captured",
      eventKind: "trigger_report.created",
      source: context.source,
      actor: context.actor ?? null,
      metadata: {
        domainId: report.domainId,
        status: report.status,
        revision: report.revision
      }
    });
    recordPsycheReflectionReward(report.id, report.title, {
      actor: context.actor ?? null,
      source: context.source
    });
    if (idempotencyKey) {
      getDatabase()
        .prepare(
          `INSERT INTO trigger_report_create_idempotency (
            owner_user_id, idempotency_key, request_fingerprint, report_id,
            created_at
          ) VALUES (?, ?, ?, ?, ?)`
        )
        .run(owner.id, idempotencyKey, fingerprint, report.id, now);
    }
    return decorateOwnedEntity("trigger_report", report);
  });
}

export function updateTriggerReport(
  reportId: string,
  patch: UpdateTriggerReportInput,
  context: PsycheContext
): TriggerReport | undefined {
  requireTriggerReportWriteScope(reportId, context);
  const existing = getPersistedTriggerReportById(reportId, {
    userIds: context.userIds
  });
  if (!existing) {
    return undefined;
  }
  const parsed = updateTriggerReportSchema.parse(patch);
  if (
    parsed.expectedRevision !== undefined &&
    parsed.expectedRevision !== existing.revision
  ) {
    throw new HttpError(
      409,
      "trigger_report_revision_conflict",
      "This trigger report changed after it was opened. Read the latest version before applying the correction.",
      {
        expectedRevision: parsed.expectedRevision,
        actualRevision: existing.revision
      }
    );
  }
  const { expectedRevision: _expectedRevision, ...parsedPatch } = parsed;
  const nextEventTypeId =
    parsed.eventTypeId === undefined
      ? existing.eventTypeId
      : parsed.eventTypeId;
  const selectedEventType =
    parsed.eventTypeId === undefined || parsed.eventTypeId === null
      ? null
      : requireReadablePsycheVocabularyReference(
          "event_type",
          parsed.eventTypeId,
          context
        );
  if (parsed.emotions) {
    for (const emotion of parsed.emotions) {
      if (emotion.emotionDefinitionId) {
        requireReadablePsycheVocabularyReference(
          "emotion_definition",
          emotion.emotionDefinitionId,
          context
        );
      }
    }
  }
  const nextCustomEventType =
    parsed.customEventType === undefined
      ? existing.customEventType
      : parsed.customEventType.trim();
  const preservedEventWording =
    nextCustomEventType ||
    selectedEventType?.label ||
    (parsed.eventTypeId === undefined && nextEventTypeId
      ? (getEventTypeById(nextEventTypeId)?.label ?? "")
      : "");
  const updated = triggerReportSchema.parse({
    ...existing,
    ...parsedPatch,
    customEventType: preservedEventWording,
    emotions: parsed.emotions
      ? enrichTriggerItems(parsed.emotions, "emo")
      : existing.emotions,
    thoughts: parsed.thoughts
      ? enrichTriggerItems(parsed.thoughts, "tht")
      : existing.thoughts,
    behaviors: parsed.behaviors
      ? enrichTriggerItems(parsed.behaviors, "beh")
      : existing.behaviors,
    modeTimeline: parsed.modeTimeline
      ? enrichTriggerItems(parsed.modeTimeline, "mdl").map((entry) =>
          modeTimelineEntrySchema.parse(entry)
        )
      : existing.modeTimeline,
    revision: existing.revision + 1,
    updatedAt: new Date().toISOString()
  });
  const links = buildTriggerReportLinks(updated);
  const preservedDeletedLinkKeys = new Set(
    buildTriggerReportLinks(existing).map(
      (link) => `${link.entityType}:${link.entityId}`
    )
  );
  validateTriggerReportLinks(links, context, preservedDeletedLinkKeys);
  validateTriggerInterpretation(updated);
  const nextOwner =
    parsed.userId !== undefined
      ? resolveTriggerReportOwner(parsed.userId, context)
      : null;

  return runInTransaction(() => {
    const result = getDatabase()
      .prepare(
        `UPDATE trigger_reports
         SET title = ?, status = ?, event_type_id = ?,
             custom_event_type = ?, event_situation = ?, occurred_at = ?,
             body_cues_json = ?, emotions_json = ?, thoughts_json = ?,
             behaviors_json = ?, consequences_json = ?,
             linked_pattern_ids_json = ?, linked_value_ids_json = ?,
             linked_goal_ids_json = ?, linked_project_ids_json = ?,
             linked_task_ids_json = ?, linked_behavior_ids_json = ?,
             linked_belief_ids_json = ?, linked_mode_ids_json = ?,
             mode_overlays_json = ?, schema_links_json = ?,
             mode_timeline_json = ?, next_moves_json = ?,
             memory_clarity = ?, reflection = ?, hypothesis = ?,
             hypothesis_fit = ?, hypothesis_correction = ?,
             interpretation_consent = ?, revision = ?, updated_at = ?
         WHERE id = ? AND revision = ?`
      )
      .run(
        updated.title,
        updated.status,
        updated.eventTypeId,
        updated.customEventType,
        updated.eventSituation,
        updated.occurredAt,
        JSON.stringify(updated.bodyCues),
        JSON.stringify(updated.emotions),
        JSON.stringify(updated.thoughts),
        JSON.stringify(updated.behaviors),
        JSON.stringify(updated.consequences),
        JSON.stringify(updated.linkedPatternIds),
        JSON.stringify(updated.linkedValueIds),
        JSON.stringify(updated.linkedGoalIds),
        JSON.stringify(updated.linkedProjectIds),
        JSON.stringify(updated.linkedTaskIds),
        JSON.stringify(updated.linkedBehaviorIds),
        JSON.stringify(updated.linkedBeliefIds),
        JSON.stringify(updated.linkedModeIds),
        JSON.stringify(updated.modeOverlays),
        JSON.stringify(updated.schemaLinks),
        JSON.stringify(updated.modeTimeline),
        JSON.stringify(updated.nextMoves),
        updated.memoryClarity,
        updated.reflection,
        updated.hypothesis,
        updated.hypothesisFit,
        updated.hypothesisCorrection,
        updated.interpretationConsent ? 1 : 0,
        updated.revision,
        updated.updatedAt,
        reportId,
        existing.revision
      );
    if (result.changes !== 1) {
      throw new HttpError(
        409,
        "trigger_report_revision_conflict",
        "This trigger report changed while the correction was being saved."
      );
    }
    if (nextOwner) {
      assignOwnedEntity(
        "trigger_report",
        reportId,
        nextOwner.id,
        context.actor
      );
    }
    replaceEntityLinksForSourceRelationships({
      sourceEntityType: "trigger_report",
      sourceEntityId: reportId,
      relationships: [...TRIGGER_REPORT_MANAGED_RELATIONSHIPS],
      links,
      actor: context.actor
    });
    mapCreateUpdateContext({
      entityType: "trigger_report",
      entityId: reportId,
      title: "Trigger report updated",
      eventKind: "trigger_report.updated",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { status: updated.status, revision: updated.revision }
    });
    return decorateOwnedEntity(
      "trigger_report",
      serializeTriggerReport(updated)
    );
  });
}

export function deleteTriggerReport(
  reportId: string,
  context: PsycheContext
): TriggerReport | undefined {
  requireTriggerReportWriteScope(reportId, context);
  const existing = getTriggerReportById(reportId, {
    userIds: context.userIds
  });
  if (!existing) {
    return undefined;
  }

  return runInTransaction(() => {
    removeIdFromStringArrayColumn(
      "belief_entries",
      "linked_report_ids_json",
      reportId
    );
    removeIdFromStringArrayColumn(
      "psyche_flashcards",
      "linked_report_ids_json",
      reportId
    );
    unlinkEntityNotes("trigger_report", reportId);
    replaceEntityLinksForSource({
      sourceEntityType: "trigger_report",
      sourceEntityId: reportId,
      links: [],
      actor: context.actor
    });
    clearEntityOwner("trigger_report", reportId);
    getDatabase()
      .prepare(`DELETE FROM trigger_reports WHERE id = ?`)
      .run(reportId);

    mapCreateUpdateContext({
      entityType: "trigger_report",
      entityId: reportId,
      title: "Trigger report deleted",
      eventKind: "trigger_report.deleted",
      source: context.source,
      actor: context.actor ?? null,
      metadata: { status: existing.status }
    });
    return existing;
  });
}
