import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import {
  createPersonSchema,
  normalizePersonSearchText,
  normalizePersonWhitespace,
  peopleListQuerySchema,
  personActorBindingKindSchema,
  personActorBindingSchema,
  personAliasInputSchema,
  personAliasSchema,
  personContactMethodInputSchema,
  personContactMethodSchema,
  personFactInputSchema,
  personFactSchema,
  personLinkInputSchema,
  personLinkSchema,
  personSchema,
  updatePersonSchema,
  type CreatePersonInput,
  type PeopleListQuery,
  type Person,
  type PersonActorBinding,
  type PersonActorBindingAuthorizationCallback,
  type PersonAlias,
  type PersonAliasInput,
  type PersonContactMethod,
  type PersonContactMethodInput,
  type PersonEntityAuthorizationCallback,
  type PersonFact,
  type PersonFactInput,
  type PersonJsonValue,
  type PersonLink,
  type PersonLinkInput,
  type UpdatePersonInput
} from "../people-types.js";

type PersonRow = {
  id: string;
  user_id: string;
  display_name: string;
  normalized_display_name: string;
  given_name: string;
  middle_name: string;
  family_name: string;
  preferred_name: string;
  pronouns: string;
  relationship_category: string;
  relationship_label: string;
  closeness: number | null;
  importance: number | null;
  short_description: string;
  description: string;
  private_notes: string;
  how_we_met: string;
  met_at: string | null;
  birthday_year: number | null;
  birthday_month: number | null;
  birthday_day: number | null;
  birthday_precision: string;
  timezone: string;
  home_place_label: string;
  contact_preferences_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type PersonAliasRow = {
  id: string;
  person_id: string;
  alias: string;
  normalized_alias: string;
  kind: string;
  created_at: string;
  updated_at: string;
};

type PersonContactMethodRow = {
  id: string;
  person_id: string;
  kind: string;
  label: string;
  value: string;
  normalized_value: string;
  is_primary: number;
  visibility: string;
  provenance_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type PersonFactRow = {
  id: string;
  person_id: string;
  fact_type: string;
  label: string;
  value_json: string;
  sensitivity: string;
  source_kind: string;
  source_entity_type: string | null;
  source_entity_id: string | null;
  observed_at: string | null;
  confidence: number | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type PersonActorBindingRow = {
  id: string;
  person_id: string;
  owner_user_id: string;
  actor_user_id: string;
  binding_kind: string;
  verified_at: string | null;
  created_at: string;
};

type EntityLinkRow = {
  source_entity_type: string;
  source_entity_id: string;
  target_entity_type: string;
  target_entity_id: string;
  anchor_key: string;
  relationship: string;
  created_by_actor: string | null;
  created_at: string;
};

export type PeoplePage = {
  people: Person[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type PeopleEntitySearch = {
  userIds?: string[];
  ids?: string[];
  query?: string;
  limit?: number;
};

const MAX_PERSON_BULK_ROWS = 500;
const MAX_WIKI_PEOPLE_ROOTS = 100;
const MAX_WIKI_PROFILE_ASSOCIATION_NOTES = 20_000;
const MAX_WIKI_PEOPLE_SCAN_ROWS = 20_000;
const WIKI_PEOPLE_SCAN_CHUNK_ROWS = 500;

export type WikiPeopleRootRow = {
  id: string;
  spaceId: string;
  slug: string;
};

export type WikiPeopleCandidatePageRow = {
  id: string;
  rootNoteId: string;
  spaceId: string;
  title: string;
  slug: string;
  parentSlug: string | null;
  aliasesJson: string;
  summary: string;
  updatedAt: string;
};

export type WikiPeopleCandidatePageWindow = {
  roots: WikiPeopleRootRow[];
  pages: WikiPeopleCandidatePageRow[];
  truncated: boolean;
};

export type PersonIdentityRecord = {
  personId: string;
  names: string[];
};

type WikiPersonAssociationPreviewRow = {
  id: string;
  owner_user_id: string;
  preview_hash: string;
  decisions_json: string;
  source_versions_json: string;
  status: "active" | "consumed" | "expired";
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

export type WikiPersonAssociationPreviewRecord = {
  id: string;
  ownerUserId: string;
  previewHash: string;
  decisionsJson: string;
  sourceVersionsJson: string;
  status: "active" | "consumed" | "expired";
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

type PeopleIdempotencyRow = {
  owner_user_id: string;
  operation_id: string;
  idempotency_key: string;
  request_hash: string;
  response_status: number;
  response_json: string;
  created_at: string;
  expires_at: string;
};

export type PeopleIdempotencyRecord = {
  ownerUserId: string;
  operationId: string;
  idempotencyKey: string;
  requestHash: string;
  responseStatus: number;
  responseJson: string;
  createdAt: string;
  expiresAt: string;
};

type MutationOptions = {
  id?: string;
  now?: Date;
};

function mapWikiPersonAssociationPreview(
  row: WikiPersonAssociationPreviewRow
): WikiPersonAssociationPreviewRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    previewHash: row.preview_hash,
    decisionsJson: row.decisions_json,
    sourceVersionsJson: row.source_versions_json,
    status: row.status,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at
  };
}

function mapPeopleIdempotency(
  row: PeopleIdempotencyRow
): PeopleIdempotencyRecord {
  return {
    ownerUserId: row.owner_user_id,
    operationId: row.operation_id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    responseStatus: row.response_status,
    responseJson: row.response_json,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

const PERSON_SELECT = `
  id, user_id, display_name, normalized_display_name, given_name, middle_name,
  family_name, preferred_name, pronouns, relationship_category, relationship_label,
  closeness, importance, short_description, description, private_notes, how_we_met,
  met_at, birthday_year, birthday_month, birthday_day, birthday_precision, timezone,
  home_place_label, contact_preferences_json, metadata_json, created_at, updated_at,
  deleted_at
`;

const ALIAS_SELECT = `
  id, person_id, alias, normalized_alias, kind, created_at, updated_at
`;

const CONTACT_SELECT = `
  id, person_id, kind, label, value, normalized_value, is_primary, visibility,
  provenance_json, created_at, updated_at, deleted_at
`;

const FACT_SELECT = `
  id, person_id, fact_type, label, value_json, sensitivity, source_kind,
  source_entity_type, source_entity_id, observed_at, confidence, reviewed_at,
  created_at, updated_at, deleted_at
`;

const BINDING_SELECT = `
  id, person_id, owner_user_id, actor_user_id, binding_kind, verified_at, created_at
`;

const LINK_SELECT = `
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
`;

export class PersonNotFoundError extends Error {
  constructor() {
    super("Person was not found for this owner.");
    this.name = "PersonNotFoundError";
  }
}

export class PersonConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonConflictError";
  }
}

export class PeopleAuthorizationError extends Error {
  constructor() {
    super("The owner is not authorized for both sides of this entity link.");
    this.name = "PeopleAuthorizationError";
  }
}

function makeId(prefix: string, requestedId?: string): string {
  return requestedId ?? `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function timestamp(options?: MutationOptions): string {
  return (options?.now ?? new Date()).toISOString();
}

function monotonicTimestamp(
  previousTimestamp: string,
  options?: MutationOptions
): string {
  const previous = Date.parse(previousTimestamp);
  const requested = (options?.now ?? new Date()).getTime();
  if (!Number.isFinite(previous) || !Number.isFinite(requested)) {
    throw new PersonConflictError(
      "Person timestamps must be valid ISO date-times."
    );
  }
  return new Date(Math.max(requested, previous + 1)).toISOString();
}

function nextPersonMutationTimestamp(
  personId: string,
  userId: string,
  options?: MutationOptions,
  includeDeleted = false
): string {
  const current = requireOwnedPersonRow(personId, userId, includeDeleted);
  return monotonicTimestamp(current.updated_at, options);
}

function parseJsonValue(raw: string): PersonJsonValue {
  return JSON.parse(raw) as PersonJsonValue;
}

function parseJsonObject(raw: string): Record<string, PersonJsonValue> {
  const parsed = parseJsonValue(raw);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Stored Person JSON object is malformed.");
  }
  return parsed;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function mapAlias(row: PersonAliasRow): PersonAlias {
  return personAliasSchema.parse({
    id: row.id,
    personId: row.person_id,
    alias: row.alias,
    normalizedAlias: row.normalized_alias,
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapContact(row: PersonContactMethodRow): PersonContactMethod {
  return personContactMethodSchema.parse({
    id: row.id,
    personId: row.person_id,
    kind: row.kind,
    label: row.label,
    value: row.value,
    normalizedValue: row.normalized_value,
    isPrimary: Boolean(row.is_primary),
    visibility: row.visibility,
    provenance: parseJsonObject(row.provenance_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  });
}

function mapFact(row: PersonFactRow): PersonFact {
  return personFactSchema.parse({
    id: row.id,
    personId: row.person_id,
    factType: row.fact_type,
    label: row.label,
    value: parseJsonValue(row.value_json),
    sensitivity: row.sensitivity,
    sourceKind: row.source_kind,
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    observedAt: row.observed_at,
    confidence: row.confidence,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  });
}

function mapBinding(row: PersonActorBindingRow): PersonActorBinding {
  return personActorBindingSchema.parse({
    id: row.id,
    personId: row.person_id,
    ownerUserId: row.owner_user_id,
    actorUserId: row.actor_user_id,
    bindingKind: row.binding_kind,
    verifiedAt: row.verified_at,
    createdAt: row.created_at
  });
}

function mapLink(row: EntityLinkRow): PersonLink {
  return personLinkSchema.parse({
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    targetEntityType: row.target_entity_type,
    targetEntityId: row.target_entity_id,
    anchorKey: row.anchor_key.trim().length > 0 ? row.anchor_key : null,
    relationship: row.relationship,
    createdByActor: row.created_by_actor,
    createdAt: row.created_at
  });
}

function groupRows<T extends { person_id: string }>(
  rows: T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.person_id) ?? [];
    existing.push(row);
    grouped.set(row.person_id, existing);
  }
  return grouped;
}

function hydratePeople(rows: PersonRow[]): Person[] {
  if (rows.length === 0) {
    return [];
  }
  const personIds = rows.map((row) => row.id);
  const values = placeholders(personIds);
  const aliases = getDatabase()
    .prepare(
      `SELECT ${ALIAS_SELECT}
       FROM person_aliases
       WHERE person_id IN (${values})
       ORDER BY created_at, id`
    )
    .all(...personIds) as PersonAliasRow[];
  const contacts = getDatabase()
    .prepare(
      `SELECT ${CONTACT_SELECT}
       FROM person_contact_methods
       WHERE person_id IN (${values}) AND deleted_at IS NULL
       ORDER BY is_primary DESC, kind, created_at, id`
    )
    .all(...personIds) as PersonContactMethodRow[];
  const facts = getDatabase()
    .prepare(
      `SELECT ${FACT_SELECT}
       FROM person_facts
       WHERE person_id IN (${values}) AND deleted_at IS NULL
       ORDER BY fact_type, created_at, id`
    )
    .all(...personIds) as PersonFactRow[];
  const bindings = getDatabase()
    .prepare(
      `SELECT ${BINDING_SELECT}
       FROM person_actor_bindings
       WHERE person_id IN (${values})
       ORDER BY created_at, id`
    )
    .all(...personIds) as PersonActorBindingRow[];
  const aliasRows = groupRows(aliases);
  const contactRows = groupRows(contacts);
  const factRows = groupRows(facts);
  const bindingRows = groupRows(bindings);

  return rows.map((row) =>
    personSchema.parse({
      id: row.id,
      userId: row.user_id,
      displayName: row.display_name,
      normalizedDisplayName: row.normalized_display_name,
      givenName: row.given_name,
      middleName: row.middle_name,
      familyName: row.family_name,
      preferredName: row.preferred_name,
      pronouns: row.pronouns,
      relationshipCategory: row.relationship_category,
      relationshipLabel: row.relationship_label,
      closeness: row.closeness,
      importance: row.importance,
      shortDescription: row.short_description,
      description: row.description,
      privateNotes: row.private_notes,
      howWeMet: row.how_we_met,
      metAt: row.met_at,
      birthdayYear: row.birthday_year,
      birthdayMonth: row.birthday_month,
      birthdayDay: row.birthday_day,
      birthdayPrecision: row.birthday_precision,
      timezone: row.timezone,
      homePlaceLabel: row.home_place_label,
      contactPreferences: parseJsonObject(row.contact_preferences_json),
      metadata: parseJsonObject(row.metadata_json),
      aliases: (aliasRows.get(row.id) ?? []).map(mapAlias),
      contacts: (contactRows.get(row.id) ?? []).map(mapContact),
      facts: (factRows.get(row.id) ?? []).map(mapFact),
      actorBindings: (bindingRows.get(row.id) ?? []).map(mapBinding),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at
    })
  );
}

function getOwnedPersonRow(
  personId: string,
  userId: string,
  includeDeleted = false
): PersonRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT ${PERSON_SELECT}
       FROM people
       WHERE id = ? AND user_id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`
    )
    .get(personId, userId) as PersonRow | undefined;
}

function requireOwnedPersonRow(
  personId: string,
  userId: string,
  includeDeleted = false
): PersonRow {
  const row = getOwnedPersonRow(personId, userId, includeDeleted);
  if (!row) {
    throw new PersonNotFoundError();
  }
  return row;
}

function assertUserExists(userId: string): void {
  const user = getDatabase()
    .prepare("SELECT id FROM users WHERE id = ?")
    .get(userId) as { id: string } | undefined;
  if (!user) {
    throw new PersonNotFoundError();
  }
}

function touchPerson(personId: string, userId: string, at: string): void {
  const result = getDatabase()
    .prepare(
      `UPDATE people
       SET updated_at = ?
       WHERE id = ? AND user_id = ? AND updated_at < ?`
    )
    .run(at, personId, userId, at);
  if (Number(result.changes) !== 1) {
    if (getOwnedPersonRow(personId, userId, true)) {
      throw new PersonConflictError(
        "Person changed while the related record was being saved."
      );
    }
    throw new PersonNotFoundError();
  }
}

function insertAlias(
  personId: string,
  input: PersonAliasInput,
  at: string,
  requestedId?: string
): { alias: PersonAlias; created: boolean } {
  const parsed = personAliasInputSchema.parse(input);
  const normalizedAlias = normalizePersonSearchText(parsed.alias);
  const existing = getDatabase()
    .prepare(
      `SELECT ${ALIAS_SELECT}
       FROM person_aliases
       WHERE person_id = ? AND normalized_alias = ?`
    )
    .get(personId, normalizedAlias) as PersonAliasRow | undefined;
  if (existing) {
    return { alias: mapAlias(existing), created: false };
  }
  const id = makeId("personalias", requestedId);
  getDatabase()
    .prepare(
      `INSERT INTO person_aliases (
         id, person_id, alias, normalized_alias, kind, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, personId, parsed.alias, normalizedAlias, parsed.kind, at, at);
  return {
    alias: mapAlias(
      getDatabase()
        .prepare(`SELECT ${ALIAS_SELECT} FROM person_aliases WHERE id = ?`)
        .get(id) as PersonAliasRow
    ),
    created: true
  };
}

export function normalizePersonContactValue(
  kind: PersonContactMethod["kind"],
  value: string
): string {
  const trimmed = normalizePersonWhitespace(value);
  if (kind === "email") {
    return trimmed.toLocaleLowerCase("und");
  }
  if (kind === "phone") {
    const extensionMatch =
      /(?:\s*(?:x|ext\.?|extension)\s*([0-9]{1,10}))$/iu.exec(trimmed);
    const main = extensionMatch
      ? trimmed.slice(0, extensionMatch.index)
      : trimmed;
    const hasLeadingPlus = trimmed.startsWith("+");
    const digits = main.replace(/\D/gu, "");
    const extension = extensionMatch?.[1] ?? "";
    return `${hasLeadingPlus ? "+" : ""}${digits}${extension ? `x${extension}` : ""}`;
  }
  if (kind === "website") {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLocaleLowerCase("und");
    return url.toString();
  }
  return normalizePersonSearchText(trimmed);
}

function clearPrimaryContact(
  personId: string,
  kind: PersonContactMethod["kind"],
  exceptId: string | null,
  at: string
): void {
  getDatabase()
    .prepare(
      `UPDATE person_contact_methods
       SET is_primary = 0, updated_at = ?
       WHERE person_id = ? AND kind = ? AND is_primary = 1 AND deleted_at IS NULL
         AND (? IS NULL OR id != ?)`
    )
    .run(at, personId, kind, exceptId, exceptId);
}

function insertContact(
  personId: string,
  input: PersonContactMethodInput,
  at: string,
  requestedId?: string
): PersonContactMethod {
  const parsed = personContactMethodInputSchema.parse(input);
  if (parsed.isPrimary) {
    clearPrimaryContact(personId, parsed.kind, null, at);
  }
  const id = makeId("personcontact", requestedId);
  getDatabase()
    .prepare(
      `INSERT INTO person_contact_methods (
         id, person_id, kind, label, value, normalized_value, is_primary,
         visibility, provenance_json, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      id,
      personId,
      parsed.kind,
      parsed.label,
      parsed.value,
      normalizePersonContactValue(parsed.kind, parsed.value),
      parsed.isPrimary ? 1 : 0,
      parsed.visibility,
      JSON.stringify(parsed.provenance),
      at,
      at
    );
  return mapContact(
    getDatabase()
      .prepare(
        `SELECT ${CONTACT_SELECT} FROM person_contact_methods WHERE id = ?`
      )
      .get(id) as PersonContactMethodRow
  );
}

function insertFact(
  personId: string,
  input: PersonFactInput,
  at: string,
  requestedId?: string
): PersonFact {
  const parsed = personFactInputSchema.parse(input);
  const id = makeId("personfact", requestedId);
  getDatabase()
    .prepare(
      `INSERT INTO person_facts (
         id, person_id, fact_type, label, value_json, sensitivity, source_kind,
         source_entity_type, source_entity_id, observed_at, confidence, reviewed_at,
         created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      id,
      personId,
      parsed.factType,
      parsed.label,
      JSON.stringify(parsed.value),
      parsed.sensitivity,
      parsed.sourceKind,
      parsed.sourceEntityType,
      parsed.sourceEntityId,
      parsed.observedAt,
      parsed.confidence,
      parsed.reviewedAt,
      at,
      at
    );
  return mapFact(
    getDatabase()
      .prepare(`SELECT ${FACT_SELECT} FROM person_facts WHERE id = ?`)
      .get(id) as PersonFactRow
  );
}

export function createPerson(
  input: CreatePersonInput,
  options: MutationOptions = {}
): Person {
  const parsed = createPersonSchema.parse(input);
  return runInTransaction(() => {
    assertUserExists(parsed.userId);
    const id = makeId("person", options.id);
    const at = timestamp(options);
    getDatabase()
      .prepare(
        `INSERT INTO people (
           id, user_id, display_name, normalized_display_name, given_name, middle_name,
           family_name, preferred_name, pronouns, relationship_category, relationship_label,
           closeness, importance, short_description, description, private_notes, how_we_met,
           met_at, birthday_year, birthday_month, birthday_day, birthday_precision, timezone,
           home_place_label, contact_preferences_json, metadata_json, created_at, updated_at,
           deleted_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
         )`
      )
      .run(
        id,
        parsed.userId,
        parsed.displayName,
        normalizePersonSearchText(parsed.displayName),
        parsed.givenName,
        parsed.middleName,
        parsed.familyName,
        parsed.preferredName,
        parsed.pronouns,
        parsed.relationshipCategory,
        parsed.relationshipLabel,
        parsed.closeness,
        parsed.importance,
        parsed.shortDescription,
        parsed.description,
        parsed.privateNotes,
        parsed.howWeMet,
        parsed.metAt,
        parsed.birthdayYear,
        parsed.birthdayMonth,
        parsed.birthdayDay,
        parsed.birthdayPrecision,
        parsed.timezone,
        parsed.homePlaceLabel,
        JSON.stringify(parsed.contactPreferences),
        JSON.stringify(parsed.metadata),
        at,
        at
      );
    getDatabase()
      .prepare(
        `INSERT INTO entity_owners (
           entity_type, entity_id, user_id, role, created_at, updated_at
         ) VALUES ('person', ?, ?, 'owner', ?, ?)
         ON CONFLICT(entity_type, entity_id)
         DO UPDATE SET user_id = excluded.user_id, role = 'owner', updated_at = excluded.updated_at`
      )
      .run(id, parsed.userId, at, at);
    for (const alias of parsed.aliases) {
      insertAlias(id, alias, at);
    }
    for (const contact of parsed.contacts) {
      insertContact(id, contact, at);
    }
    for (const fact of parsed.facts) {
      insertFact(id, fact, at);
    }
    return getPersonById(id, parsed.userId)!;
  });
}

export function getPersonById(
  personId: string,
  userId: string,
  options: { includeDeleted?: boolean } = {}
): Person | undefined {
  const row = getOwnedPersonRow(
    personId,
    userId,
    options.includeDeleted ?? false
  );
  return row ? hydratePeople([row])[0] : undefined;
}

export function getPeopleByIdsForUser(
  personIds: readonly string[],
  userId: string,
  options: { includeDeleted?: boolean } = {}
): Person[] {
  const uniqueIds = Array.from(new Set(personIds));
  if (uniqueIds.length === 0) {
    return [];
  }
  if (uniqueIds.length > MAX_PERSON_BULK_ROWS) {
    throw new RangeError(
      `A Person bulk read cannot exceed ${MAX_PERSON_BULK_ROWS} records.`
    );
  }
  const rows = getDatabase()
    .prepare(
      `SELECT ${PERSON_SELECT}
       FROM people
       WHERE user_id = ?
         AND id IN (${placeholders(uniqueIds)})
         ${options.includeDeleted ? "" : "AND deleted_at IS NULL"}`
    )
    .all(userId, ...uniqueIds) as PersonRow[];
  const byId = new Map(
    hydratePeople(rows).map((person) => [person.id, person])
  );
  return uniqueIds.flatMap((personId) => {
    const person = byId.get(personId);
    return person ? [person] : [];
  });
}

export function getPersonByIdAcrossOwners(
  personId: string,
  options: { includeDeleted?: boolean } = {}
): Person | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT ${PERSON_SELECT}
       FROM people
       WHERE id = ?${options.includeDeleted ? "" : " AND deleted_at IS NULL"}`
    )
    .get(personId) as PersonRow | undefined;
  return row ? hydratePeople([row])[0] : undefined;
}

export function listPeople(input: PeopleListQuery): PeoplePage {
  const query = peopleListQuerySchema.parse(input);
  const conditions = ["people.user_id = ?"];
  const parameters: Array<string | number> = [query.userId];
  if (!query.includeDeleted) {
    conditions.push("people.deleted_at IS NULL");
  }
  if (query.relationshipCategory !== undefined) {
    conditions.push("people.relationship_category = ?");
    parameters.push(query.relationshipCategory);
  }
  if (query.q.length > 0) {
    const normalized = normalizePersonSearchText(query.q);
    const pattern = `%${escapeLikePattern(normalized)}%`;
    conditions.push(
      `(people.normalized_display_name LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM person_aliases
          WHERE person_aliases.person_id = people.id
            AND person_aliases.normalized_alias LIKE ? ESCAPE '\\'
        )
        OR LOWER(people.given_name) LIKE ? ESCAPE '\\'
        OR LOWER(people.family_name) LIKE ? ESCAPE '\\'
        OR LOWER(people.preferred_name) LIKE ? ESCAPE '\\')`
    );
    parameters.push(pattern, pattern, pattern, pattern, pattern);
  }
  const where = conditions.join(" AND ");
  const total = (
    getDatabase()
      .prepare(`SELECT COUNT(*) AS count FROM people WHERE ${where}`)
      .get(...parameters) as { count: number }
  ).count;
  const orderBy =
    query.sort === "updated"
      ? "people.updated_at DESC, people.normalized_display_name, people.id"
      : query.sort === "importance"
        ? "people.importance IS NULL, people.importance DESC, people.normalized_display_name, people.id"
        : "people.normalized_display_name, people.id";
  const rows = getDatabase()
    .prepare(
      `SELECT ${PERSON_SELECT}
       FROM people
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .all(...parameters, query.limit, query.offset) as PersonRow[];
  const people = hydratePeople(rows);
  return {
    people,
    total,
    limit: query.limit,
    offset: query.offset,
    hasMore: query.offset + people.length < total
  };
}

export function listPeopleForUser(
  userId: string,
  options: Omit<PeopleListQuery, "userId"> = {}
): Person[] {
  return listPeople({ userId, ...options }).people;
}

export function searchPeopleAcrossOwners(
  input: PeopleEntitySearch = {}
): Person[] {
  const limit = Math.max(1, Math.min(500, input.limit ?? 100));
  const conditions = ["people.deleted_at IS NULL"];
  const parameters: Array<string | number> = [];
  if (input.userIds !== undefined && input.userIds.length === 0) {
    return [];
  }
  const userIds = Array.from(new Set(input.userIds ?? [])).slice(0, 500);
  if (userIds.length > 0) {
    conditions.push(`people.user_id IN (${placeholders(userIds)})`);
    parameters.push(...userIds);
  }
  if (input.ids !== undefined && input.ids.length === 0) {
    return [];
  }
  const ids = Array.from(new Set(input.ids ?? [])).slice(0, 500);
  if (ids.length > 0) {
    conditions.push(`people.id IN (${placeholders(ids)})`);
    parameters.push(...ids);
  }
  const query = input.query?.trim() ?? "";
  if (query.length > 240) {
    throw new RangeError(
      "Person search queries must not exceed 240 characters."
    );
  }
  if (query.length > 0) {
    const pattern = `%${escapeLikePattern(normalizePersonSearchText(query))}%`;
    conditions.push(
      `(people.normalized_display_name LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM person_aliases
          WHERE person_aliases.person_id = people.id
            AND person_aliases.normalized_alias LIKE ? ESCAPE '\\'
        ))`
    );
    parameters.push(pattern, pattern);
  }
  const rows = getDatabase()
    .prepare(
      `SELECT ${PERSON_SELECT}
       FROM people
       WHERE ${conditions.join(" AND ")}
       ORDER BY people.normalized_display_name, people.id
       LIMIT ?`
    )
    .all(...parameters, limit) as PersonRow[];
  return hydratePeople(rows);
}

export function updatePerson(
  personId: string,
  userId: string,
  input: UpdatePersonInput,
  options: MutationOptions = {}
): Person | undefined {
  const patch = updatePersonSchema.parse(input);
  return runInTransaction(() => {
    const current = getPersonById(personId, userId);
    if (!current) {
      return undefined;
    }
    if (
      patch.expectedUpdatedAt !== undefined &&
      patch.expectedUpdatedAt !== current.updatedAt
    ) {
      throw new PersonConflictError("Person changed after it was read.");
    }
    const { expectedUpdatedAt: _expectedUpdatedAt, ...fields } = patch;
    const validated = createPersonSchema.parse({
      userId,
      displayName: fields.displayName ?? current.displayName,
      givenName: fields.givenName ?? current.givenName,
      middleName: fields.middleName ?? current.middleName,
      familyName: fields.familyName ?? current.familyName,
      preferredName: fields.preferredName ?? current.preferredName,
      pronouns: fields.pronouns ?? current.pronouns,
      relationshipCategory:
        fields.relationshipCategory ?? current.relationshipCategory,
      relationshipLabel: fields.relationshipLabel ?? current.relationshipLabel,
      closeness:
        fields.closeness === undefined ? current.closeness : fields.closeness,
      importance:
        fields.importance === undefined
          ? current.importance
          : fields.importance,
      shortDescription: fields.shortDescription ?? current.shortDescription,
      description: fields.description ?? current.description,
      privateNotes: fields.privateNotes ?? current.privateNotes,
      howWeMet: fields.howWeMet ?? current.howWeMet,
      metAt: fields.metAt === undefined ? current.metAt : fields.metAt,
      birthdayYear:
        fields.birthdayYear === undefined
          ? current.birthdayYear
          : fields.birthdayYear,
      birthdayMonth:
        fields.birthdayMonth === undefined
          ? current.birthdayMonth
          : fields.birthdayMonth,
      birthdayDay:
        fields.birthdayDay === undefined
          ? current.birthdayDay
          : fields.birthdayDay,
      birthdayPrecision: fields.birthdayPrecision ?? current.birthdayPrecision,
      timezone: fields.timezone ?? current.timezone,
      homePlaceLabel: fields.homePlaceLabel ?? current.homePlaceLabel,
      contactPreferences:
        fields.contactPreferences ?? current.contactPreferences,
      metadata: fields.metadata ?? current.metadata,
      aliases: [],
      contacts: [],
      facts: []
    });
    const at = monotonicTimestamp(current.updatedAt, options);
    const result = getDatabase()
      .prepare(
        `UPDATE people
         SET display_name = ?, normalized_display_name = ?, given_name = ?, middle_name = ?,
             family_name = ?, preferred_name = ?, pronouns = ?, relationship_category = ?,
             relationship_label = ?, closeness = ?, importance = ?, short_description = ?,
             description = ?, private_notes = ?, how_we_met = ?, met_at = ?, birthday_year = ?,
             birthday_month = ?, birthday_day = ?, birthday_precision = ?, timezone = ?,
             home_place_label = ?, contact_preferences_json = ?, metadata_json = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL
           AND (? IS NULL OR updated_at = ?)`
      )
      .run(
        validated.displayName,
        normalizePersonSearchText(validated.displayName),
        validated.givenName,
        validated.middleName,
        validated.familyName,
        validated.preferredName,
        validated.pronouns,
        validated.relationshipCategory,
        validated.relationshipLabel,
        validated.closeness,
        validated.importance,
        validated.shortDescription,
        validated.description,
        validated.privateNotes,
        validated.howWeMet,
        validated.metAt,
        validated.birthdayYear,
        validated.birthdayMonth,
        validated.birthdayDay,
        validated.birthdayPrecision,
        validated.timezone,
        validated.homePlaceLabel,
        JSON.stringify(validated.contactPreferences),
        JSON.stringify(validated.metadata),
        at,
        personId,
        userId,
        patch.expectedUpdatedAt ?? null,
        patch.expectedUpdatedAt ?? null
      );
    if (Number(result.changes) !== 1) {
      if (getOwnedPersonRow(personId, userId)) {
        throw new PersonConflictError(
          "Person changed while the update was being saved."
        );
      }
      return undefined;
    }
    getDatabase()
      .prepare(
        `UPDATE entity_owners
         SET user_id = ?, updated_at = ?
         WHERE entity_type = 'person' AND entity_id = ?`
      )
      .run(userId, at, personId);
    return getPersonById(personId, userId)!;
  });
}

export function softDeletePerson(
  personId: string,
  userId: string,
  options: MutationOptions = {}
): Person | undefined {
  return runInTransaction(() => {
    const current = getPersonById(personId, userId);
    if (!current) {
      return undefined;
    }
    const at = monotonicTimestamp(current.updatedAt, options);
    const result = getDatabase()
      .prepare(
        `UPDATE people
         SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL
           AND updated_at = ?`
      )
      .run(at, at, personId, userId, current.updatedAt);
    if (Number(result.changes) !== 1) {
      throw new PersonConflictError(
        "Person changed while it was being soft-deleted."
      );
    }
    return getPersonById(personId, userId, { includeDeleted: true });
  });
}

export function restorePerson(
  personId: string,
  userId: string,
  options: MutationOptions = {}
): Person | undefined {
  return runInTransaction(() => {
    const current = getPersonById(personId, userId, { includeDeleted: true });
    if (!current) {
      return undefined;
    }
    if (current.deletedAt === null) {
      return current;
    }
    const at = monotonicTimestamp(current.updatedAt, options);
    const result = getDatabase()
      .prepare(
        `UPDATE people
         SET deleted_at = NULL, updated_at = ?
         WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL
           AND updated_at = ?`
      )
      .run(at, personId, userId, current.updatedAt);
    if (Number(result.changes) !== 1) {
      throw new PersonConflictError(
        "Person changed while it was being restored."
      );
    }
    return getPersonById(personId, userId);
  });
}

function listProtectedPersonReferences(
  personId: string,
  userId: string
): string[] {
  return (
    getDatabase()
      .prepare(
        `SELECT 'forge_principals' AS source
         WHERE EXISTS (
           SELECT 1 FROM forge_principals
           WHERE local_person_id = ? AND owner_user_id = ?
         )
         UNION ALL
         SELECT 'peer_relationships' AS source
         WHERE EXISTS (
           SELECT 1 FROM peer_relationships
           WHERE local_person_id = ? AND owner_user_id = ?
         )
         UNION ALL
         SELECT 'peer_query_audit' AS source
         WHERE EXISTS (
           SELECT 1 FROM peer_query_audit
           WHERE person_id = ? AND owner_user_id = ?
         )
         UNION ALL
         SELECT 'peer_question_interpretations' AS source
         WHERE EXISTS (
           SELECT 1 FROM peer_question_interpretations
           WHERE person_id = ? AND owner_user_id = ?
         )`
      )
      .all(
        personId,
        userId,
        personId,
        userId,
        personId,
        userId,
        personId,
        userId
      ) as Array<{ source: string }>
  ).map((row) => row.source);
}

export function hardDeletePerson(
  personId: string,
  userId: string
): Person | undefined {
  return runInTransaction(() => {
    const current = getPersonById(personId, userId, { includeDeleted: true });
    if (!current) {
      return undefined;
    }
    const protectedReferences = listProtectedPersonReferences(personId, userId);
    if (protectedReferences.length > 0) {
      throw new PersonConflictError(
        `Person cannot be hard-deleted while preserved peer or audit records reference it: ${protectedReferences.join(", ")}.`
      );
    }
    getDatabase()
      .prepare(
        `DELETE FROM entity_links
         WHERE (source_entity_type = 'person' AND source_entity_id = ?)
            OR (target_entity_type = 'person' AND target_entity_id = ?)`
      )
      .run(personId, personId);
    getDatabase()
      .prepare(
        `DELETE FROM entity_owners
         WHERE entity_type = 'person' AND entity_id = ? AND user_id = ?`
      )
      .run(personId, userId);
    let deleted: { changes: number | bigint };
    try {
      deleted = getDatabase()
        .prepare("DELETE FROM people WHERE id = ? AND user_id = ?")
        .run(personId, userId);
    } catch (error) {
      if (
        error instanceof Error &&
        /FOREIGN KEY constraint failed/iu.test(error.message)
      ) {
        throw new PersonConflictError(
          "Person cannot be hard-deleted while preserved records reference it."
        );
      }
      throw error;
    }
    if (Number(deleted.changes) !== 1) {
      throw new PersonConflictError(
        "Person changed while it was being deleted."
      );
    }
    return current;
  });
}

export function listPersonAliases(
  personId: string,
  userId: string
): PersonAlias[] {
  requireOwnedPersonRow(personId, userId);
  return (
    getDatabase()
      .prepare(
        `SELECT ${ALIAS_SELECT}
         FROM person_aliases
         WHERE person_id = ?
         ORDER BY created_at, id`
      )
      .all(personId) as PersonAliasRow[]
  ).map(mapAlias);
}

export function addPersonAlias(
  personId: string,
  userId: string,
  input: PersonAliasInput,
  options: MutationOptions = {}
): PersonAlias {
  return runInTransaction(() => {
    const at = nextPersonMutationTimestamp(personId, userId, options);
    const { alias, created } = insertAlias(personId, input, at, options.id);
    if (created) {
      touchPerson(personId, userId, at);
    }
    return alias;
  });
}

export function updatePersonAlias(
  aliasId: string,
  personId: string,
  userId: string,
  input: PersonAliasInput,
  options: MutationOptions = {}
): PersonAlias | undefined {
  return runInTransaction(() => {
    const at = nextPersonMutationTimestamp(personId, userId, options);
    const parsed = personAliasInputSchema.parse(input);
    const normalized = normalizePersonSearchText(parsed.alias);
    const collision = getDatabase()
      .prepare(
        `SELECT id FROM person_aliases
         WHERE person_id = ? AND normalized_alias = ? AND id != ?`
      )
      .get(personId, normalized, aliasId) as { id: string } | undefined;
    if (collision) {
      throw new PersonConflictError(
        "This Person already has that normalized alias."
      );
    }
    const result = getDatabase()
      .prepare(
        `UPDATE person_aliases
         SET alias = ?, normalized_alias = ?, kind = ?, updated_at = ?
         WHERE id = ? AND person_id = ?`
      )
      .run(parsed.alias, normalized, parsed.kind, at, aliasId, personId);
    if (Number(result.changes) !== 1) {
      return undefined;
    }
    touchPerson(personId, userId, at);
    return mapAlias(
      getDatabase()
        .prepare(`SELECT ${ALIAS_SELECT} FROM person_aliases WHERE id = ?`)
        .get(aliasId) as PersonAliasRow
    );
  });
}

export function deletePersonAlias(
  aliasId: string,
  personId: string,
  userId: string,
  options: MutationOptions = {}
): boolean {
  return runInTransaction(() => {
    const at = nextPersonMutationTimestamp(personId, userId, options);
    const result = getDatabase()
      .prepare("DELETE FROM person_aliases WHERE id = ? AND person_id = ?")
      .run(aliasId, personId);
    if (Number(result.changes) === 0) {
      return false;
    }
    touchPerson(personId, userId, at);
    return true;
  });
}

export function listPersonContactMethods(
  personId: string,
  userId: string,
  options: { includeDeleted?: boolean } = {}
): PersonContactMethod[] {
  requireOwnedPersonRow(personId, userId, options.includeDeleted ?? false);
  const rows = getDatabase()
    .prepare(
      `SELECT ${CONTACT_SELECT}
       FROM person_contact_methods
       WHERE person_id = ?${options.includeDeleted ? "" : " AND deleted_at IS NULL"}
       ORDER BY deleted_at IS NOT NULL, is_primary DESC, kind, created_at, id`
    )
    .all(personId) as PersonContactMethodRow[];
  return rows.map(mapContact);
}

export function addPersonContactMethod(
  personId: string,
  userId: string,
  input: PersonContactMethodInput,
  options: MutationOptions = {}
): PersonContactMethod {
  return runInTransaction(() => {
    const at = nextPersonMutationTimestamp(personId, userId, options);
    const contact = insertContact(personId, input, at, options.id);
    touchPerson(personId, userId, at);
    return contact;
  });
}

function getOwnedContact(
  contactId: string,
  personId: string,
  userId: string,
  includeDeleted = false
): PersonContactMethod | undefined {
  requireOwnedPersonRow(personId, userId, includeDeleted);
  const row = getDatabase()
    .prepare(
      `SELECT ${CONTACT_SELECT}
       FROM person_contact_methods
       WHERE id = ? AND person_id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`
    )
    .get(contactId, personId) as PersonContactMethodRow | undefined;
  return row ? mapContact(row) : undefined;
}

export function updatePersonContactMethod(
  contactId: string,
  personId: string,
  userId: string,
  patch: Partial<PersonContactMethodInput>,
  options: MutationOptions = {}
): PersonContactMethod | undefined {
  return runInTransaction(() => {
    const current = getOwnedContact(contactId, personId, userId);
    if (!current) {
      return undefined;
    }
    const parsed = personContactMethodInputSchema.parse({
      kind: patch.kind ?? current.kind,
      label: patch.label ?? current.label,
      value: patch.value ?? current.value,
      isPrimary: patch.isPrimary ?? current.isPrimary,
      visibility: patch.visibility ?? current.visibility,
      provenance: patch.provenance ?? current.provenance
    });
    const at = nextPersonMutationTimestamp(personId, userId, options);
    if (parsed.isPrimary) {
      clearPrimaryContact(personId, parsed.kind, contactId, at);
    }
    const result = getDatabase()
      .prepare(
        `UPDATE person_contact_methods
         SET kind = ?, label = ?, value = ?, normalized_value = ?, is_primary = ?,
             visibility = ?, provenance_json = ?, updated_at = ?
         WHERE id = ? AND person_id = ? AND deleted_at IS NULL`
      )
      .run(
        parsed.kind,
        parsed.label,
        parsed.value,
        normalizePersonContactValue(parsed.kind, parsed.value),
        parsed.isPrimary ? 1 : 0,
        parsed.visibility,
        JSON.stringify(parsed.provenance),
        at,
        contactId,
        personId
      );
    if (Number(result.changes) !== 1) {
      return undefined;
    }
    touchPerson(personId, userId, at);
    return getOwnedContact(contactId, personId, userId)!;
  });
}

export function softDeletePersonContactMethod(
  contactId: string,
  personId: string,
  userId: string,
  options: MutationOptions = {}
): PersonContactMethod | undefined {
  return runInTransaction(() => {
    const current = getOwnedContact(contactId, personId, userId);
    if (!current) {
      return undefined;
    }
    const at = nextPersonMutationTimestamp(personId, userId, options);
    const result = getDatabase()
      .prepare(
        `UPDATE person_contact_methods
         SET deleted_at = ?, is_primary = 0, updated_at = ?
         WHERE id = ? AND person_id = ? AND deleted_at IS NULL`
      )
      .run(at, at, contactId, personId);
    if (Number(result.changes) !== 1) {
      return undefined;
    }
    touchPerson(personId, userId, at);
    return getOwnedContact(contactId, personId, userId, true)!;
  });
}

export function restorePersonContactMethod(
  contactId: string,
  personId: string,
  userId: string,
  options: MutationOptions = {}
): PersonContactMethod | undefined {
  return runInTransaction(() => {
    const current = getOwnedContact(contactId, personId, userId, true);
    if (!current) {
      return undefined;
    }
    if (current.deletedAt === null) {
      return current;
    }
    const at = nextPersonMutationTimestamp(personId, userId, options);
    const result = getDatabase()
      .prepare(
        `UPDATE person_contact_methods
         SET deleted_at = NULL, updated_at = ?
         WHERE id = ? AND person_id = ?`
      )
      .run(at, contactId, personId);
    if (Number(result.changes) !== 1) {
      return undefined;
    }
    touchPerson(personId, userId, at);
    return getOwnedContact(contactId, personId, userId)!;
  });
}

export function listPersonFacts(
  personId: string,
  userId: string,
  options: { includeDeleted?: boolean } = {}
): PersonFact[] {
  requireOwnedPersonRow(personId, userId, options.includeDeleted ?? false);
  const rows = getDatabase()
    .prepare(
      `SELECT ${FACT_SELECT}
       FROM person_facts
       WHERE person_id = ?${options.includeDeleted ? "" : " AND deleted_at IS NULL"}
       ORDER BY deleted_at IS NOT NULL, fact_type, created_at, id`
    )
    .all(personId) as PersonFactRow[];
  return rows.map(mapFact);
}

export function addPersonFact(
  personId: string,
  userId: string,
  input: PersonFactInput,
  options: MutationOptions = {}
): PersonFact {
  return runInTransaction(() => {
    const at = nextPersonMutationTimestamp(personId, userId, options);
    const fact = insertFact(personId, input, at, options.id);
    touchPerson(personId, userId, at);
    return fact;
  });
}

function getOwnedFact(
  factId: string,
  personId: string,
  userId: string,
  includeDeleted = false
): PersonFact | undefined {
  requireOwnedPersonRow(personId, userId, includeDeleted);
  const row = getDatabase()
    .prepare(
      `SELECT ${FACT_SELECT}
       FROM person_facts
       WHERE id = ? AND person_id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`
    )
    .get(factId, personId) as PersonFactRow | undefined;
  return row ? mapFact(row) : undefined;
}

export function updatePersonFact(
  factId: string,
  personId: string,
  userId: string,
  patch: Partial<PersonFactInput>,
  options: MutationOptions = {}
): PersonFact | undefined {
  return runInTransaction(() => {
    const current = getOwnedFact(factId, personId, userId);
    if (!current) {
      return undefined;
    }
    const parsed = personFactInputSchema.parse({
      factType: patch.factType ?? current.factType,
      label: patch.label ?? current.label,
      value: patch.value ?? current.value,
      sensitivity: patch.sensitivity ?? current.sensitivity,
      sourceKind: patch.sourceKind ?? current.sourceKind,
      sourceEntityType:
        patch.sourceEntityType === undefined
          ? current.sourceEntityType
          : patch.sourceEntityType,
      sourceEntityId:
        patch.sourceEntityId === undefined
          ? current.sourceEntityId
          : patch.sourceEntityId,
      observedAt:
        patch.observedAt === undefined ? current.observedAt : patch.observedAt,
      confidence:
        patch.confidence === undefined ? current.confidence : patch.confidence,
      reviewedAt:
        patch.reviewedAt === undefined ? current.reviewedAt : patch.reviewedAt
    });
    const at = nextPersonMutationTimestamp(personId, userId, options);
    const result = getDatabase()
      .prepare(
        `UPDATE person_facts
         SET fact_type = ?, label = ?, value_json = ?, sensitivity = ?, source_kind = ?,
             source_entity_type = ?, source_entity_id = ?, observed_at = ?, confidence = ?,
             reviewed_at = ?, updated_at = ?
         WHERE id = ? AND person_id = ? AND deleted_at IS NULL`
      )
      .run(
        parsed.factType,
        parsed.label,
        JSON.stringify(parsed.value),
        parsed.sensitivity,
        parsed.sourceKind,
        parsed.sourceEntityType,
        parsed.sourceEntityId,
        parsed.observedAt,
        parsed.confidence,
        parsed.reviewedAt,
        at,
        factId,
        personId
      );
    if (Number(result.changes) !== 1) {
      return undefined;
    }
    touchPerson(personId, userId, at);
    return getOwnedFact(factId, personId, userId)!;
  });
}

export function softDeletePersonFact(
  factId: string,
  personId: string,
  userId: string,
  options: MutationOptions = {}
): PersonFact | undefined {
  return runInTransaction(() => {
    const current = getOwnedFact(factId, personId, userId);
    if (!current) {
      return undefined;
    }
    const at = nextPersonMutationTimestamp(personId, userId, options);
    const result = getDatabase()
      .prepare(
        `UPDATE person_facts
         SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND person_id = ? AND deleted_at IS NULL`
      )
      .run(at, at, factId, personId);
    if (Number(result.changes) !== 1) {
      return undefined;
    }
    touchPerson(personId, userId, at);
    return getOwnedFact(factId, personId, userId, true)!;
  });
}

export function restorePersonFact(
  factId: string,
  personId: string,
  userId: string,
  options: MutationOptions = {}
): PersonFact | undefined {
  return runInTransaction(() => {
    const current = getOwnedFact(factId, personId, userId, true);
    if (!current) {
      return undefined;
    }
    if (current.deletedAt === null) {
      return current;
    }
    const at = nextPersonMutationTimestamp(personId, userId, options);
    const result = getDatabase()
      .prepare(
        `UPDATE person_facts
         SET deleted_at = NULL, updated_at = ?
         WHERE id = ? AND person_id = ?`
      )
      .run(at, factId, personId);
    if (Number(result.changes) !== 1) {
      return undefined;
    }
    touchPerson(personId, userId, at);
    return getOwnedFact(factId, personId, userId)!;
  });
}

export function listPersonActorBindings(
  personId: string,
  ownerUserId: string
): PersonActorBinding[] {
  requireOwnedPersonRow(personId, ownerUserId);
  return (
    getDatabase()
      .prepare(
        `SELECT ${BINDING_SELECT}
         FROM person_actor_bindings
         WHERE person_id = ? AND owner_user_id = ?
         ORDER BY created_at, id`
      )
      .all(personId, ownerUserId) as PersonActorBindingRow[]
  ).map(mapBinding);
}

export function bindPersonToActor(
  input: {
    personId: string;
    ownerUserId: string;
    actorUserId: string;
    bindingKind?: "self" | "local_actor";
    verifiedAt?: string | null;
  },
  authorizeCrossUser?: PersonActorBindingAuthorizationCallback,
  options: MutationOptions = {}
): PersonActorBinding {
  const bindingKind = personActorBindingKindSchema.parse(
    input.bindingKind ?? "self"
  );
  return runInTransaction(() => {
    requireOwnedPersonRow(input.personId, input.ownerUserId);
    assertUserExists(input.actorUserId);
    if (bindingKind === "self" && input.ownerUserId !== input.actorUserId) {
      throw new PeopleAuthorizationError();
    }
    if (
      input.ownerUserId !== input.actorUserId &&
      (!authorizeCrossUser ||
        !authorizeCrossUser({
          ownerUserId: input.ownerUserId,
          personId: input.personId,
          actorUserId: input.actorUserId,
          bindingKind
        }))
    ) {
      throw new PeopleAuthorizationError();
    }
    const existing = getDatabase()
      .prepare(
        `SELECT ${BINDING_SELECT}
         FROM person_actor_bindings
         WHERE person_id = ? AND actor_user_id = ? AND binding_kind = ?`
      )
      .get(input.personId, input.actorUserId, bindingKind) as
      | PersonActorBindingRow
      | undefined;
    if (existing) {
      return mapBinding(existing);
    }
    const at = nextPersonMutationTimestamp(
      input.personId,
      input.ownerUserId,
      options
    );
    const id = makeId("personbinding", options.id);
    getDatabase()
      .prepare(
        `INSERT INTO person_actor_bindings (
           id, person_id, owner_user_id, actor_user_id, binding_kind, verified_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.personId,
        input.ownerUserId,
        input.actorUserId,
        bindingKind,
        input.verifiedAt ?? null,
        at
      );
    touchPerson(input.personId, input.ownerUserId, at);
    return mapBinding(
      getDatabase()
        .prepare(
          `SELECT ${BINDING_SELECT} FROM person_actor_bindings WHERE id = ?`
        )
        .get(id) as PersonActorBindingRow
    );
  });
}

export function removePersonActorBinding(
  bindingId: string,
  ownerUserId: string,
  authorizeCrossUser?: PersonActorBindingAuthorizationCallback,
  options: MutationOptions = {}
): boolean {
  return runInTransaction(() => {
    const row = getDatabase()
      .prepare(
        `SELECT ${BINDING_SELECT}
         FROM person_actor_bindings
         WHERE id = ? AND owner_user_id = ?`
      )
      .get(bindingId, ownerUserId) as PersonActorBindingRow | undefined;
    if (!row) {
      return false;
    }
    if (
      row.owner_user_id !== row.actor_user_id &&
      (!authorizeCrossUser ||
        !authorizeCrossUser({
          ownerUserId: row.owner_user_id,
          personId: row.person_id,
          actorUserId: row.actor_user_id,
          bindingKind: personActorBindingKindSchema.parse(row.binding_kind)
        }))
    ) {
      throw new PeopleAuthorizationError();
    }
    const at = nextPersonMutationTimestamp(row.person_id, ownerUserId, options);
    const result = getDatabase()
      .prepare(
        "DELETE FROM person_actor_bindings WHERE id = ? AND owner_user_id = ?"
      )
      .run(bindingId, ownerUserId);
    if (Number(result.changes) === 0) {
      return false;
    }
    touchPerson(row.person_id, ownerUserId, at);
    return true;
  });
}

function assertEntityAuthorization(
  authorize: PersonEntityAuthorizationCallback,
  input: {
    userId: string;
    entityType: string;
    entityId: string;
    operation: "read" | "link" | "unlink";
  }
): void {
  if (!authorize(input)) {
    throw new PeopleAuthorizationError();
  }
}

function authorizeLinkRow(
  row: EntityLinkRow,
  userId: string,
  operation: "read" | "link" | "unlink",
  authorize: PersonEntityAuthorizationCallback
): boolean {
  return (
    authorize({
      userId,
      entityType: row.source_entity_type,
      entityId: row.source_entity_id,
      operation
    }) &&
    authorize({
      userId,
      entityType: row.target_entity_type,
      entityId: row.target_entity_id,
      operation
    })
  );
}

export function upsertAuthorizedPersonLink(
  input: {
    userId: string;
    personId: string;
    link: PersonLinkInput;
    actor?: string | null;
  },
  authorize: PersonEntityAuthorizationCallback,
  options: MutationOptions = {}
): { link: PersonLink; created: boolean } {
  const link = personLinkInputSchema.parse(input.link);
  return runInTransaction(() => {
    requireOwnedPersonRow(input.personId, input.userId);
    assertEntityAuthorization(authorize, {
      userId: input.userId,
      entityType: "person",
      entityId: input.personId,
      operation: "link"
    });
    assertEntityAuthorization(authorize, {
      userId: input.userId,
      entityType: link.targetEntityType,
      entityId: link.targetEntityId,
      operation: "link"
    });
    const at = timestamp(options);
    const result = getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO entity_links (
           source_entity_type, source_entity_id, target_entity_type, target_entity_id,
           anchor_key, relationship, created_by_actor, created_at
         ) VALUES ('person', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.personId,
        link.targetEntityType,
        link.targetEntityId,
        link.anchorKey,
        link.relationship,
        input.actor ?? null,
        at
      );
    const row = getDatabase()
      .prepare(
        `SELECT ${LINK_SELECT}
         FROM entity_links
         WHERE source_entity_type = 'person' AND source_entity_id = ?
           AND target_entity_type = ? AND target_entity_id = ?
           AND anchor_key = ? AND relationship = ?`
      )
      .get(
        input.personId,
        link.targetEntityType,
        link.targetEntityId,
        link.anchorKey,
        link.relationship
      ) as EntityLinkRow;
    return { link: mapLink(row), created: Number(result.changes) === 1 };
  });
}

export function listAuthorizedPersonLinks(
  input: {
    userId: string;
    personId: string;
    direction?: "outgoing" | "incoming" | "both";
    targetEntityType?: string;
    relationship?: string;
    limit?: number;
  },
  authorize: PersonEntityAuthorizationCallback
): PersonLink[] {
  requireOwnedPersonRow(input.personId, input.userId, true);
  assertEntityAuthorization(authorize, {
    userId: input.userId,
    entityType: "person",
    entityId: input.personId,
    operation: "read"
  });
  const direction = input.direction ?? "both";
  const condition =
    direction === "outgoing"
      ? "source_entity_type = 'person' AND source_entity_id = ?"
      : direction === "incoming"
        ? "target_entity_type = 'person' AND target_entity_id = ?"
        : `((source_entity_type = 'person' AND source_entity_id = ?)
            OR (target_entity_type = 'person' AND target_entity_id = ?))`;
  const parameters =
    direction === "both" ? [input.personId, input.personId] : [input.personId];
  const conditions = [condition];
  if (input.targetEntityType !== undefined) {
    conditions.push("target_entity_type = ?");
    parameters.push(input.targetEntityType);
  }
  if (input.relationship !== undefined) {
    conditions.push("relationship = ?");
    parameters.push(input.relationship);
  }
  const limit = input.limit;
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > 2_000)
  ) {
    throw new RangeError(
      "Person link reads must request between 1 and 2000 rows."
    );
  }
  const resultLimit = limit ?? 2_000;
  const authorized: PersonLink[] = [];
  let scanned = 0;
  let after: EntityLinkRow | null = null;
  while (authorized.length < resultLimit && scanned < 20_000) {
    const pageConditions = [...conditions];
    const pageParameters: Array<string | number> = [...parameters];
    if (after) {
      pageConditions.push(
        `(created_at, source_entity_type, source_entity_id,
          target_entity_type, target_entity_id, relationship, anchor_key)
         > (?, ?, ?, ?, ?, ?, ?)`
      );
      pageParameters.push(
        after.created_at,
        after.source_entity_type,
        after.source_entity_id,
        after.target_entity_type,
        after.target_entity_id,
        after.relationship,
        after.anchor_key
      );
    }
    const chunkSize = Math.min(256, 20_000 - scanned);
    const rows = getDatabase()
      .prepare(
        `SELECT ${LINK_SELECT}
         FROM entity_links
         WHERE ${pageConditions.join(" AND ")}
         ORDER BY created_at, source_entity_type, source_entity_id,
                  target_entity_type, target_entity_id, relationship, anchor_key
         LIMIT ?`
      )
      .all(...pageParameters, chunkSize) as EntityLinkRow[];
    if (rows.length === 0) break;
    scanned += rows.length;
    after = rows.at(-1)!;
    for (const row of rows) {
      if (authorizeLinkRow(row, input.userId, "read", authorize)) {
        authorized.push(mapLink(row));
        if (authorized.length === resultLimit) break;
      }
    }
    if (rows.length < chunkSize) break;
  }
  return authorized;
}

function deleteExactLink(row: EntityLinkRow): void {
  getDatabase()
    .prepare(
      `DELETE FROM entity_links
       WHERE source_entity_type = ? AND source_entity_id = ?
         AND target_entity_type = ? AND target_entity_id = ?
         AND anchor_key = ? AND relationship = ?`
    )
    .run(
      row.source_entity_type,
      row.source_entity_id,
      row.target_entity_type,
      row.target_entity_id,
      row.anchor_key,
      row.relationship
    );
}

export function replaceAuthorizedPersonLinks(
  input: {
    userId: string;
    personId: string;
    links: PersonLinkInput[];
    actor?: string | null;
  },
  authorize: PersonEntityAuthorizationCallback,
  options: MutationOptions = {}
): { links: PersonLink[]; preservedUnauthorizedCount: number } {
  const normalized = new Map<
    string,
    ReturnType<typeof personLinkInputSchema.parse>
  >();
  for (const rawLink of input.links) {
    const link = personLinkInputSchema.parse(rawLink);
    normalized.set(
      `${link.targetEntityType}\u0000${link.targetEntityId}\u0000${link.anchorKey}\u0000${link.relationship}`,
      link
    );
  }
  return runInTransaction(() => {
    requireOwnedPersonRow(input.personId, input.userId);
    assertEntityAuthorization(authorize, {
      userId: input.userId,
      entityType: "person",
      entityId: input.personId,
      operation: "link"
    });
    for (const link of normalized.values()) {
      assertEntityAuthorization(authorize, {
        userId: input.userId,
        entityType: link.targetEntityType,
        entityId: link.targetEntityId,
        operation: "link"
      });
    }
    const current = getDatabase()
      .prepare(
        `SELECT ${LINK_SELECT}
         FROM entity_links
         WHERE source_entity_type = 'person' AND source_entity_id = ?`
      )
      .all(input.personId) as EntityLinkRow[];
    const removable = current.filter((row) =>
      authorizeLinkRow(row, input.userId, "unlink", authorize)
    );
    const preservedUnauthorizedCount = current.length - removable.length;
    const at = timestamp(options);
    for (const row of removable) {
      const key = `${row.target_entity_type}\u0000${row.target_entity_id}\u0000${row.anchor_key}\u0000${row.relationship}`;
      if (!normalized.has(key)) {
        deleteExactLink(row);
      }
    }
    const links: PersonLink[] = [];
    for (const link of normalized.values()) {
      links.push(
        upsertAuthorizedPersonLink(
          {
            userId: input.userId,
            personId: input.personId,
            link,
            actor: input.actor
          },
          authorize,
          { now: new Date(at) }
        ).link
      );
    }
    return { links, preservedUnauthorizedCount };
  });
}

export function deleteAuthorizedPersonLink(
  input: {
    userId: string;
    personId: string;
    link: PersonLinkInput;
  },
  authorize: PersonEntityAuthorizationCallback
): boolean {
  const link = personLinkInputSchema.parse(input.link);
  return runInTransaction(() => {
    requireOwnedPersonRow(input.personId, input.userId, true);
    assertEntityAuthorization(authorize, {
      userId: input.userId,
      entityType: "person",
      entityId: input.personId,
      operation: "unlink"
    });
    assertEntityAuthorization(authorize, {
      userId: input.userId,
      entityType: link.targetEntityType,
      entityId: link.targetEntityId,
      operation: "unlink"
    });
    const result = getDatabase()
      .prepare(
        `DELETE FROM entity_links
         WHERE source_entity_type = 'person' AND source_entity_id = ?
           AND target_entity_type = ? AND target_entity_id = ?
           AND anchor_key = ? AND relationship = ?`
      )
      .run(
        input.personId,
        link.targetEntityType,
        link.targetEntityId,
        link.anchorKey,
        link.relationship
      );
    return Number(result.changes) === 1;
  });
}

export function listPersonIdentityRecords(
  userId: string
): PersonIdentityRecord[] {
  const people = getDatabase()
    .prepare(
      `SELECT id, display_name, given_name, middle_name, family_name, preferred_name
       FROM people
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY normalized_display_name, id`
    )
    .all(userId) as Array<{
    id: string;
    display_name: string;
    given_name: string;
    middle_name: string;
    family_name: string;
    preferred_name: string;
  }>;
  if (people.length === 0) {
    return [];
  }
  const aliases = getDatabase()
    .prepare(
      `SELECT person_id, alias
       FROM person_aliases
       WHERE person_id IN (${placeholders(people)})
       ORDER BY created_at, id`
    )
    .all(...people.map((person) => person.id)) as Array<{
    person_id: string;
    alias: string;
  }>;
  const aliasesByPerson = new Map<string, string[]>();
  for (const alias of aliases) {
    const values = aliasesByPerson.get(alias.person_id) ?? [];
    values.push(alias.alias);
    aliasesByPerson.set(alias.person_id, values);
  }
  return people.map((person) => ({
    personId: person.id,
    names: Array.from(
      new Set(
        [
          person.display_name,
          person.preferred_name,
          person.given_name,
          [person.given_name, person.middle_name, person.family_name]
            .filter(Boolean)
            .join(" "),
          ...(aliasesByPerson.get(person.id) ?? [])
        ]
          .map(normalizePersonWhitespace)
          .filter(Boolean)
      )
    )
  }));
}

export function listWikiProfileAssociations(
  userId: string,
  noteIds: string[]
): Map<string, string[]> {
  const uniqueNoteIds = Array.from(new Set(noteIds));
  if (uniqueNoteIds.length > MAX_WIKI_PROFILE_ASSOCIATION_NOTES) {
    throw new RangeError(
      `Wiki Person association reads cannot exceed ${MAX_WIKI_PROFILE_ASSOCIATION_NOTES} notes.`
    );
  }
  const result = new Map<string, string[]>();
  for (const noteId of noteIds) {
    result.set(noteId, []);
  }
  if (uniqueNoteIds.length === 0) {
    return result;
  }
  for (let offset = 0; offset < uniqueNoteIds.length; offset += 500) {
    const chunk = uniqueNoteIds.slice(offset, offset + 500);
    const rows = getDatabase()
      .prepare(
        `SELECT DISTINCT entity_links.target_entity_id AS note_id, people.id AS person_id
         FROM entity_links
         JOIN people
           ON entity_links.source_entity_type = 'person'
          AND entity_links.source_entity_id = people.id
         WHERE people.user_id = ?
           AND people.deleted_at IS NULL
           AND entity_links.target_entity_type = 'note'
           AND entity_links.relationship = 'profile_page'
           AND entity_links.target_entity_id IN (${placeholders(chunk)})
         ORDER BY entity_links.target_entity_id, people.id`
      )
      .all(userId, ...chunk) as Array<{
      note_id: string;
      person_id: string;
    }>;
    for (const row of rows) {
      result.get(row.note_id)!.push(row.person_id);
    }
  }
  return result;
}

function activeWikiPagePredicate(alias: string): string {
  return `NOT EXISTS (
      SELECT 1 FROM deleted_entities
      WHERE entity_type = 'note' AND entity_id = ${alias}.id
    )
    AND (${alias}.destroy_at IS NULL OR ${alias}.destroy_at = '' OR ${alias}.destroy_at > ?)`;
}

export function listWikiPeopleCandidatePages(input: {
  userId: string;
  rootSlug: string;
  spaceId?: string;
  maximumRows?: number;
  now?: Date;
}): WikiPeopleCandidatePageWindow {
  const userId = input.userId.trim();
  const rootSlug = input.rootSlug.trim();
  if (!userId || !rootSlug) {
    throw new Error(
      "Wiki candidate discovery requires an owner and root slug."
    );
  }
  const at = (input.now ?? new Date()).toISOString();
  const spaceCondition = input.spaceId ? "AND notes.space_id = ?" : "";
  const rootParameters: string[] = [rootSlug, userId];
  if (input.spaceId) {
    rootParameters.push(input.spaceId);
  }
  const rootRows = getDatabase()
    .prepare(
      `SELECT notes.id, notes.space_id, notes.slug
       FROM notes
       JOIN wiki_spaces ON wiki_spaces.id = notes.space_id
       WHERE notes.kind = 'wiki'
         AND notes.slug = ?
         AND (wiki_spaces.owner_user_id = ? OR wiki_spaces.visibility = 'shared')
         ${spaceCondition}
         AND ${activeWikiPagePredicate("notes")}
       ORDER BY notes.space_id, notes.id
       LIMIT ?`
    )
    .all(...rootParameters, at, MAX_WIKI_PEOPLE_ROOTS + 1) as Array<{
    id: string;
    space_id: string;
    slug: string;
  }>;
  const rootsTruncated = rootRows.length > MAX_WIKI_PEOPLE_ROOTS;
  const roots = rootRows.slice(0, MAX_WIKI_PEOPLE_ROOTS);
  if (roots.length === 0) {
    return { roots: [], pages: [], truncated: false };
  }
  const maximumRows = Math.min(
    Math.max(input.maximumRows ?? 5_000, 1),
    MAX_WIKI_PEOPLE_SCAN_ROWS
  );
  type CandidateRow = {
    id: string;
    root_note_id: string;
    space_id: string;
    title: string;
    slug: string;
    parent_slug: string | null;
    aliases_json: string;
    summary: string;
    updated_at: string;
    normalized_title: string;
  };
  const candidateRows: CandidateRow[] = [];
  let after:
    | { spaceId: string; normalizedTitle: string; id: string; rootNoteId: string }
    | null = null;
  while (candidateRows.length <= maximumRows) {
    const chunkSize = Math.min(
      WIKI_PEOPLE_SCAN_CHUNK_ROWS,
      maximumRows + 1 - candidateRows.length
    );
    if (chunkSize <= 0) break;
    const chunk = getDatabase()
      .prepare(
      `WITH RECURSIVE descendants (
         id, root_note_id, space_id, title, slug, parent_slug, aliases_json,
         summary, updated_at
       ) AS (
         SELECT child.id, roots.id, child.space_id, child.title, child.slug,
                child.parent_slug, child.aliases_json, child.summary, child.updated_at
         FROM notes AS child
         JOIN notes AS roots
           ON child.space_id = roots.space_id
          AND child.parent_slug = roots.slug
         WHERE roots.id IN (${placeholders(roots)})
           AND child.kind = 'wiki'
           AND ${activeWikiPagePredicate("child")}
         UNION
         SELECT child.id, descendants.root_note_id, child.space_id, child.title,
                child.slug, child.parent_slug, child.aliases_json, child.summary,
                child.updated_at
         FROM notes AS child
         JOIN descendants
           ON child.space_id = descendants.space_id
          AND child.parent_slug = descendants.slug
         WHERE child.kind = 'wiki'
           AND child.id != descendants.root_note_id
           AND ${activeWikiPagePredicate("child")}
       )
       SELECT id, root_note_id, space_id, title, slug, parent_slug, aliases_json,
              summary, updated_at, LOWER(title) AS normalized_title
       FROM descendants
       WHERE (? IS NULL
          OR space_id > ?
          OR (space_id = ? AND LOWER(title) > ?)
          OR (space_id = ? AND LOWER(title) = ? AND id > ?)
          OR (space_id = ? AND LOWER(title) = ? AND id = ? AND root_note_id > ?))
       ORDER BY space_id, LOWER(title), id, root_note_id
       LIMIT ?`
      )
      .all(
        ...roots.map((root) => root.id),
        at,
        at,
        after?.spaceId ?? null,
        after?.spaceId ?? "",
        after?.spaceId ?? "",
        after?.normalizedTitle ?? "",
        after?.spaceId ?? "",
        after?.normalizedTitle ?? "",
        after?.id ?? "",
        after?.spaceId ?? "",
        after?.normalizedTitle ?? "",
        after?.id ?? "",
        after?.rootNoteId ?? "",
        chunkSize
      ) as CandidateRow[];
    if (chunk.length === 0) break;
    candidateRows.push(...chunk);
    const last = chunk.at(-1)!;
    after = {
      spaceId: last.space_id,
      normalizedTitle: last.normalized_title,
      id: last.id,
      rootNoteId: last.root_note_id
    };
    if (chunk.length < chunkSize) break;
  }
  return {
    roots: roots.map((root) => ({
      id: root.id,
      spaceId: root.space_id,
      slug: root.slug
    })),
    pages: candidateRows.slice(0, maximumRows).map((row) => ({
      id: row.id,
      rootNoteId: row.root_note_id,
      spaceId: row.space_id,
      title: row.title,
      slug: row.slug,
      parentSlug: row.parent_slug,
      aliasesJson: row.aliases_json,
      summary: row.summary,
      updatedAt: row.updated_at
    })),
    truncated: rootsTruncated || candidateRows.length > maximumRows
  };
}

export function listWikiPeopleCandidatePagesByIds(input: {
  userId: string;
  rootSlug: string;
  candidateIds: readonly string[];
  spaceId?: string;
  now?: Date;
}): WikiPeopleCandidatePageRow[] {
  const candidateIds = [...new Set(input.candidateIds)];
  if (candidateIds.length === 0) return [];
  if (candidateIds.length > 100) {
    throw new RangeError("Wiki association validation cannot exceed 100 candidates.");
  }
  const userId = input.userId.trim();
  const rootSlug = input.rootSlug.trim();
  if (!userId || !rootSlug) {
    throw new Error("Wiki candidate validation requires an owner and root slug.");
  }
  const at = (input.now ?? new Date()).toISOString();
  const spaceCondition = input.spaceId ? "AND roots.space_id = ?" : "";
  const rootParameters: string[] = [rootSlug, userId];
  if (input.spaceId) rootParameters.push(input.spaceId);
  const roots = getDatabase()
    .prepare(
      `SELECT roots.id, roots.space_id
       FROM notes AS roots
       JOIN wiki_spaces ON wiki_spaces.id = roots.space_id
       WHERE roots.kind = 'wiki' AND roots.slug = ?
         AND (wiki_spaces.owner_user_id = ? OR wiki_spaces.visibility = 'shared')
         ${spaceCondition}
         AND ${activeWikiPagePredicate("roots")}
       ORDER BY roots.space_id, roots.id
       LIMIT ?`
    )
    .all(...rootParameters, at, MAX_WIKI_PEOPLE_ROOTS + 1) as Array<{
    id: string;
    space_id: string;
  }>;
  if (roots.length === 0 || roots.length > MAX_WIKI_PEOPLE_ROOTS) return [];
  const rows = getDatabase()
    .prepare(
      `WITH RECURSIVE ancestors (
         candidate_id, id, space_id, slug, parent_slug, depth
       ) AS (
         SELECT candidate.id, candidate.id, candidate.space_id, candidate.slug,
                candidate.parent_slug, 0
         FROM notes AS candidate
         WHERE candidate.id IN (${placeholders(candidateIds)})
           AND candidate.kind = 'wiki'
           AND ${activeWikiPagePredicate("candidate")}
         UNION
         SELECT ancestors.candidate_id, parent.id, parent.space_id, parent.slug,
                parent.parent_slug, ancestors.depth + 1
         FROM ancestors
         JOIN notes AS parent
           ON parent.space_id = ancestors.space_id
          AND parent.slug = ancestors.parent_slug
         WHERE ancestors.depth < 256
           AND parent.kind = 'wiki'
           AND ${activeWikiPagePredicate("parent")}
       )
       SELECT candidate.id, ancestors.id AS root_note_id,
              candidate.space_id, candidate.title, candidate.slug,
              candidate.parent_slug, candidate.aliases_json, candidate.summary,
              candidate.updated_at
       FROM ancestors
       JOIN notes AS candidate ON candidate.id = ancestors.candidate_id
       WHERE ancestors.id IN (${placeholders(roots)})
         AND candidate.id != ancestors.id
       ORDER BY candidate.space_id, LOWER(candidate.title), candidate.id,
                ancestors.id`
    )
    .all(
      ...candidateIds,
      at,
      at,
      ...roots.map((root) => root.id)
    ) as Array<{
    id: string;
    root_note_id: string;
    space_id: string;
    title: string;
    slug: string;
    parent_slug: string | null;
    aliases_json: string;
    summary: string;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    rootNoteId: row.root_note_id,
    spaceId: row.space_id,
    title: row.title,
    slug: row.slug,
    parentSlug: row.parent_slug,
    aliasesJson: row.aliases_json,
    summary: row.summary,
    updatedAt: row.updated_at
  }));
}

export function createWikiPersonAssociationPreviewRecord(
  input: {
    ownerUserId: string;
    previewHash: string;
    decisionsJson: string;
    sourceVersionsJson: string;
    expiresAt: string;
  },
  options: MutationOptions = {}
): WikiPersonAssociationPreviewRecord {
  assertUserExists(input.ownerUserId);
  const id = makeId("peoplewikipreview", options.id);
  const createdAt = timestamp(options);
  getDatabase()
    .prepare(
      `INSERT INTO people_wiki_association_previews (
         id, owner_user_id, preview_hash, decisions_json, source_versions_json,
         status, expires_at, consumed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, ?)`
    )
    .run(
      id,
      input.ownerUserId,
      input.previewHash,
      input.decisionsJson,
      input.sourceVersionsJson,
      input.expiresAt,
      createdAt
    );
  return getWikiPersonAssociationPreviewRecord(id, input.ownerUserId)!;
}

export function getWikiPersonAssociationPreviewRecord(
  previewId: string,
  ownerUserId: string
): WikiPersonAssociationPreviewRecord | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, owner_user_id, preview_hash, decisions_json,
              source_versions_json, status, expires_at, consumed_at, created_at
       FROM people_wiki_association_previews
       WHERE id = ? AND owner_user_id = ?`
    )
    .get(previewId, ownerUserId) as WikiPersonAssociationPreviewRow | undefined;
  return row ? mapWikiPersonAssociationPreview(row) : undefined;
}

export function consumeWikiPersonAssociationPreviewRecord(
  previewId: string,
  ownerUserId: string,
  consumedAt: string
): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE people_wiki_association_previews
       SET status = 'consumed', consumed_at = ?
       WHERE id = ? AND owner_user_id = ? AND status = 'active'
         AND expires_at > ?`
    )
    .run(consumedAt, previewId, ownerUserId, consumedAt);
  return Number(result.changes) === 1;
}

export function getPeopleIdempotencyRecord(
  ownerUserId: string,
  operationId: string,
  idempotencyKey: string,
  options: MutationOptions = {}
): PeopleIdempotencyRecord | undefined {
  const at = timestamp(options);
  const row = getDatabase()
    .prepare(
      `SELECT owner_user_id, operation_id, idempotency_key, request_hash,
              response_status, response_json, created_at, expires_at
       FROM peer_idempotency_records
       WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ?
         AND expires_at > ?`
    )
    .get(ownerUserId, operationId, idempotencyKey, at) as
    | PeopleIdempotencyRow
    | undefined;
  return row ? mapPeopleIdempotency(row) : undefined;
}

export function createPeopleIdempotencyRecord(input: {
  ownerUserId: string;
  operationId: string;
  idempotencyKey: string;
  requestHash: string;
  responseStatus: number;
  responseJson: string;
  createdAt: string;
  expiresAt: string;
}): PeopleIdempotencyRecord {
  return runInTransaction(() => {
    const existing = getDatabase()
      .prepare(
        `SELECT expires_at AS expiresAt
         FROM peer_idempotency_records
         WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ?`
      )
      .get(input.ownerUserId, input.operationId, input.idempotencyKey) as
      | { expiresAt: string }
      | undefined;
    if (existing) {
      if (existing.expiresAt > input.createdAt) {
        throw new PersonConflictError(
          "An active People idempotency record already uses this key."
        );
      }
      const removed = getDatabase()
        .prepare(
          `DELETE FROM peer_idempotency_records
           WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ?
             AND expires_at <= ?`
        )
        .run(
          input.ownerUserId,
          input.operationId,
          input.idempotencyKey,
          input.createdAt
        );
      if (Number(removed.changes) !== 1) {
        throw new PersonConflictError(
          "People idempotency state changed while the key was being reused."
        );
      }
    }
    getDatabase()
      .prepare(
        `INSERT INTO peer_idempotency_records (
           owner_user_id, operation_id, idempotency_key, request_hash,
           response_status, response_json, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.ownerUserId,
        input.operationId,
        input.idempotencyKey,
        input.requestHash,
        input.responseStatus,
        input.responseJson,
        input.createdAt,
        input.expiresAt
      );
    return getPeopleIdempotencyRecord(
      input.ownerUserId,
      input.operationId,
      input.idempotencyKey,
      { now: new Date(input.createdAt) }
    )!;
  });
}
