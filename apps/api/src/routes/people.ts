import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { getDatabase } from "../db.js";
import { HttpError } from "../errors.js";
import type { AuthContext } from "../managers/contracts.js";
import type { AuthorizationManager } from "../managers/platform/authorization-manager.js";
import type { LlmManager } from "../managers/platform/llm-manager.js";
import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import {
  PEER_API_SCHEMAS,
  parsePeerApiSuccess,
  type PeerApiOperationId
} from "../peer-api-schemas.js";
import {
  peerProjectionResponseMetadataSchema,
  peerQuerySourceSchema,
  type PeerProjectionId,
  type PeerProjectionResponseMetadata
} from "../peer-sharing-types.js";
import {
  getPeerRouteContract,
  PEER_ROUTE_CONTRACTS,
  type PeerRouteMethod
} from "../peer-route-contract.js";
import {
  getPersonById,
  getPeopleByIdsForUser,
  listWikiPeopleCandidatePagesByIds
} from "../repositories/people.js";
import {
  consumePeerQuestionInterpretation,
  createPeerQuestionInterpretation
} from "../repositories/peer-previews.js";
import {
  getVerifiedPeerQueryGrantEvidence,
  hashPeerApiValue,
  listPersonPeerQuestionHistory
} from "../repositories/peer-sharing.js";
import { getEntityOwnerId } from "../repositories/entity-ownership.js";
import { getDefaultUser, listUsers } from "../repositories/users.js";
import {
  getWikiPageDetail,
  getWikiPageAccessRecord,
  getWikiSpaceById,
  listWikiLlmProfiles
} from "../repositories/wiki-memory.js";
import {
  applyWikiPersonAssociationPreview,
  collectWikiPeopleCandidates,
  getPersonContextReadModel,
  previewWikiPersonAssociationDecisions
} from "../services/people.js";
import {
  decodePeerCursor,
  encodePeerCursor
} from "../services/peer-cursors.js";
import type { PeerCoreGateway } from "../services/peer-core-gateway.js";
import {
  decryptPeerCachePayload,
  encryptPeerCachePayload,
  PEER_CACHE_ENCRYPTION_ALGORITHM,
  PEER_CACHE_ENVELOPE_VERSION,
  PEER_CACHE_TAG_BYTES,
  peerCacheKeyId
} from "../services/peer-cache-crypto.js";
import { evaluatePeerProjectionAccess } from "../services/peer-grants.js";
import {
  getPeerProjectionDefinition,
  interpretPeopleQuestion,
  validatePeerProjectionOutput
} from "../services/peer-projections.js";
import {
  hashPeerQueryCacheIdentity,
  peerTypedQuestionSchema,
  type PeerTypedQuestion
} from "../services/peer-typed-query.js";
import {
  PeerOperationRateLimiter,
  PeerRateLimitError
} from "../services/peer-rate-limit.js";
import { resolveZonedDateTime } from "../services/calendar-time.js";
import { redactPersonForAuth } from "../services/people-redaction.js";
import { canAccessWikiSpace } from "../services/wiki-authorization.js";
import { normalizePersonSearchText } from "../people-types.js";

type PeopleRouteDependencies = {
  authenticate(headers: Record<string, unknown>): AuthContext;
  authorization: AuthorizationManager;
  llm: Pick<LlmManager, "runTextPrompt">;
  secrets: SecretsManager;
  peerCore: PeerCoreGateway;
  rateLimiter?: PeerOperationRateLimiter;
};

type LocalPeerActor = {
  auth: AuthContext;
  principalClass: "operator_session" | "agent_token";
  principalId: string;
  ownerUserId: string;
};

const PEOPLE_LIST_INITIAL_REQUESTS_PER_MINUTE = 180;
const PEOPLE_LIST_CONTINUATION_REQUESTS_PER_MINUTE = 480;
const PEOPLE_LIST_INVALID_CURSOR_REQUESTS_PER_MINUTE = 60;

function consumePeopleRateLimit(input: {
  limiter: PeerOperationRateLimiter;
  reply: FastifyReply;
  actor: LocalPeerActor;
  operationId: PeerApiOperationId;
  bucketId?: string;
  limit: number;
}) {
  try {
    input.limiter.consume({
      operationId: input.bucketId ?? input.operationId,
      principalId: input.actor.principalId,
      limit: input.limit
    });
  } catch (error) {
    if (!(error instanceof PeerRateLimitError)) throw error;
    input.reply.header("Retry-After", String(error.retryAfterSeconds));
    throw new HttpError(
      429,
      "peer_rate_limit_exceeded",
      "Too many People operations were requested.",
      {
        operationId: input.operationId,
        limit: input.limit,
        retryAfterSeconds: error.retryAfterSeconds
      }
    );
  }
}

const peopleCursorSchema = z
  .object({
    sortValue: z.string().max(500),
    id: z.string().min(1).max(240),
    snapshotAt: z.string().datetime({ offset: true }),
    readModelRevision: z.number().int().min(0)
  })
  .strict();
const historyCursorSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().min(1).max(240)
  })
  .strict();
const scanCursorSchema = z
  .object({
    offset: z.number().int().min(0),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict();

const wikiPeopleSuggestionSchema = z
  .object({
    pageId: z.string().trim().min(1).max(240),
    displayName: z.string().trim().min(1).max(160),
    preferredName: z.string().trim().max(160).default(""),
    relationshipCategory: z
      .enum([
        "family",
        "friend",
        "partner",
        "colleague",
        "community",
        "professional",
        "other"
      ])
      .default("other"),
    relationshipLabel: z.string().trim().max(240).default(""),
    shortDescription: z.string().trim().max(2000).default(""),
    aliases: z.array(z.string().trim().min(1).max(160)).max(32).default([])
  })
  .strict();

const wikiPeopleLlmResponseSchema = z
  .object({
    people: z.array(wikiPeopleSuggestionSchema).max(20)
  })
  .strict();

function parseWikiPeopleLlmResponse(outputText: string) {
  const trimmed = outputText.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new HttpError(
      502,
      "people_wiki_llm_invalid_response",
      "The configured LLM did not return valid Person suggestions."
    );
  }
  try {
    return wikiPeopleLlmResponseSchema.parse(
      JSON.parse(trimmed.slice(start, end + 1))
    );
  } catch {
    throw new HttpError(
      502,
      "people_wiki_llm_invalid_response",
      "The configured LLM returned Person suggestions in an invalid format."
    );
  }
}

function parseWikiPersonAliases(value: string): string[] {
  try {
    const aliases = JSON.parse(value) as unknown;
    if (!Array.isArray(aliases)) return [];
    return aliases.flatMap((alias) =>
      typeof alias === "string"
        ? [alias]
        : alias &&
            typeof alias === "object" &&
            typeof (alias as { alias?: unknown }).alias === "string"
          ? [(alias as { alias: string }).alias]
          : []
    );
  } catch {
    return [];
  }
}
const peerQueryEvidenceSchema = z
  .object({
    grantId: z.string().trim().min(1).max(240),
    grantSequence: z.number().int().positive(),
    grantVerificationId: z.string().trim().min(1).max(240),
    verifiedGrantHash: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .passthrough();
const peerAuthenticatedProjectionMetadataSchema =
  peerProjectionResponseMetadataSchema
    .extend({
      grantVerificationId: z.string().trim().min(1).max(240),
      verifiedGrantHash: z.string().regex(/^[a-f0-9]{64}$/)
    })
    .strict();
const peerCachedQueryMetadataSchema = z
  .object({
    grantId: z.string().trim().min(1).max(240),
    grantSequence: z.number().int().positive(),
    grantVerificationId: z.string().trim().min(1).max(240),
    verifiedGrantHash: z.string().regex(/^[a-f0-9]{64}$/),
    queryHash: z.string().regex(/^[a-f0-9]{64}$/),
    source: peerQuerySourceSchema,
    redactedFields: z
      .array(z.string().trim().min(1).max(120))
      .max(256)
      .default([])
  })
  .strict();

type TypedPeerQuestion = PeerTypedQuestion;

type QueryAuthorization = {
  grantId: string;
  grantSequence: number;
  grantVerificationId: string;
  verifiedGrantHash: string;
  effectiveFields: string[];
  redactedFields: string[];
  maximumResultCount: number;
  maximumPayloadBytes: number;
  precision: string;
  cachePolicy: {
    mode: "none" | "until_expiry" | "until_revoked" | "duration";
    maximumRetentionSeconds: number;
    purgeOnRevocation: boolean;
  };
  grantExpiresAt: string | null;
  evidence: Record<string, unknown>;
};

type ApiWikiDecision = {
  wikiPageId: string;
  action: "associate" | "create_person" | "skip";
  personId?: string;
  displayName?: string;
  preferredName?: string;
  relationshipCategory?:
    | "family"
    | "friend"
    | "partner"
    | "colleague"
    | "community"
    | "professional"
    | "other";
  relationshipLabel?: string;
  shortDescription?: string;
  aliases?: string[];
  expectedWikiVersion: string;
  expectedPersonVersion?: string;
};

function toServiceWikiDecisions(decisions: ApiWikiDecision[]) {
  return decisions.map((decision) => {
    if (decision.action === "associate") {
      return {
        action: "associate" as const,
        candidateNoteId: decision.wikiPageId,
        personId: decision.personId!,
        expectedWikiVersion: decision.expectedWikiVersion,
        expectedPersonVersion: decision.expectedPersonVersion!
      };
    }
    if (decision.action === "create_person") {
      return {
        action: "create" as const,
        candidateNoteId: decision.wikiPageId,
        person: {
          displayName: decision.displayName,
          preferredName: decision.preferredName,
          relationshipCategory: decision.relationshipCategory,
          relationshipLabel: decision.relationshipLabel,
          shortDescription: decision.shortDescription,
          aliases: decision.aliases?.map((alias) => ({
            alias,
            kind: "name" as const
          }))
        },
        expectedWikiVersion: decision.expectedWikiVersion
      };
    }
    return {
      action: "skip" as const,
      candidateNoteId: decision.wikiPageId,
      expectedWikiVersion: decision.expectedWikiVersion
    };
  });
}

function routeContract(operationId: PeerApiOperationId) {
  const contract = PEER_ROUTE_CONTRACTS.find(
    (candidate) => candidate.operationId === operationId
  );
  if (!contract) {
    throw new Error(`Missing People route contract for ${operationId}.`);
  }
  return contract;
}

function hasScope(auth: AuthContext, scope: string) {
  return Boolean(auth.session || auth.token?.scopes.includes(scope));
}

function resolvePersonOwnerUserId(
  personId: string,
  scopedUserIds: readonly string[]
): string | null {
  const row = getDatabase()
    .prepare("SELECT user_id FROM people WHERE id = ?")
    .get(personId) as { user_id: string } | undefined;
  if (!row) {
    return null;
  }
  if (scopedUserIds.length > 0 && !scopedUserIds.includes(row.user_id)) {
    return null;
  }
  return row.user_id;
}

function resolveOwnerUserId(
  auth: AuthContext,
  requested?: string,
  personId?: string
) {
  const validUserIds = new Set(listUsers().map((user) => user.id));
  if (requested && !validUserIds.has(requested)) {
    throw new HttpError(404, "person_owner_not_found", "Forge user not found.");
  }
  const scoped = auth.token?.scopePolicy.userIds ?? [];
  if (requested && scoped.length > 0 && !scoped.includes(requested)) {
    throw new HttpError(
      403,
      "people_user_scope_forbidden",
      "The requested People owner is outside this token's user scope."
    );
  }
  if (requested) {
    return requested;
  }
  if (personId) {
    const ownerUserId = resolvePersonOwnerUserId(personId, scoped);
    if (ownerUserId) {
      return ownerUserId;
    }
    if (scoped.length !== 1) {
      throw new HttpError(404, "person_not_found", "Person not found.");
    }
  }
  if (scoped.length === 1) {
    return scoped[0]!;
  }
  if (scoped.length > 1) {
    throw new HttpError(
      400,
      "people_owner_required",
      "Select one Forge user for this People request."
    );
  }
  return getDefaultUser().id;
}

function authenticatePeopleRoute(
  dependencies: PeopleRouteDependencies,
  headers: Record<string, unknown>,
  operationId: PeerApiOperationId,
  requestedUserId?: string,
  personId?: string
): LocalPeerActor {
  const contract = routeContract(operationId);
  const auth = dependencies.authenticate(headers);
  dependencies.authorization.requireAuthenticatedActor(auth, {
    operationId
  });
  dependencies.authorization.requireAllTokenScopes(
    auth,
    [...contract.requiredScopes],
    { operationId }
  );
  const principalClass: LocalPeerActor["principalClass"] = auth.session
    ? "operator_session"
    : "agent_token";
  if (!contract.principalClasses.includes(principalClass)) {
    throw new HttpError(
      403,
      "peer_principal_forbidden",
      "This principal cannot use the requested People operation."
    );
  }
  return {
    auth,
    principalClass,
    principalId: auth.session?.id ?? auth.token!.id,
    ownerUserId: resolveOwnerUserId(auth, requestedUserId, personId)
  };
}

function cursorKind(namespace: string, binding: unknown): string {
  return `${namespace}:${hashPeerApiValue(binding).slice(0, 48)}`;
}

function authorizeEntityForOwner(input: {
  userId: string;
  entityType: string;
  entityId: string;
  operation?: "read" | "link" | "unlink";
}) {
  if (input.entityType === "person") {
    return Boolean(
      getDatabase()
        .prepare("SELECT 1 FROM people WHERE id = ? AND user_id = ? LIMIT 1")
        .get(input.entityId, input.userId)
    );
  }
  if (input.entityType === "note") {
    const note = getDatabase()
      .prepare("SELECT kind FROM notes WHERE id = ?")
      .get(input.entityId) as { kind: string } | undefined;
    if (note?.kind === "wiki" || note?.kind === "evidence") {
      const access = getWikiPageAccessRecord(input.entityId);
      return Boolean(
        access &&
        canAccessWikiSpace(
          { userIds: [input.userId] },
          getWikiSpaceById(access.spaceId),
          input.operation === "read" ? "read" : "write"
        )
      );
    }
    return getEntityOwnerId(input.entityType, input.entityId) === input.userId;
  }
  const ownerId = getEntityOwnerId(input.entityType, input.entityId);
  if (ownerId !== null) {
    return ownerId === input.userId;
  }
  return false;
}

function peopleServiceDependencies(ownerUserId: string) {
  const authorizationCache = new Map<string, boolean>();
  return {
    authorizeEntity: (input: {
      userId: string;
      entityType: string;
      entityId: string;
      operation: "read" | "link" | "unlink";
    }) => {
      if (input.userId !== ownerUserId) {
        return false;
      }
      const key = `${input.operation}\u0000${input.entityType}\u0000${input.entityId}`;
      const cached = authorizationCache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const authorized = authorizeEntityForOwner({
        userId: ownerUserId,
        entityType: input.entityType,
        entityId: input.entityId,
        operation: input.operation
      });
      authorizationCache.set(key, authorized);
      return authorized;
    }
  };
}

function listPeopleRows(input: {
  ownerUserId: string;
  query?: string;
  relationshipStatus?: string;
  source: "local" | "shared" | "both";
  hasUpcomingSharedContext?: boolean;
  sort: "display_name" | "updated_at" | "next_shared_event";
  direction: "asc" | "desc";
  cursor: z.infer<typeof peopleCursorSchema> | null;
  limit: number;
  now: Date;
}) {
  const conditions = ["people.user_id = ?", "people.deleted_at IS NULL"];
  const parameters: Array<string | number> = [input.ownerUserId];
  if (input.query) {
    const pattern = `%${normalizePersonSearchText(input.query).replace(
      /[\\%_]/g,
      "\\$&"
    )}%`;
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
  if (input.relationshipStatus) {
    if (input.relationshipStatus === "none") {
      conditions.push(
        `NOT EXISTS (
          SELECT 1 FROM peer_relationships
          WHERE peer_relationships.owner_user_id = people.user_id
            AND peer_relationships.local_person_id = people.id
        )`
      );
    } else {
      conditions.push(
        `EXISTS (
        SELECT 1 FROM peer_relationships
        WHERE peer_relationships.owner_user_id = people.user_id
          AND peer_relationships.local_person_id = people.id
          AND peer_relationships.status = ?
      )`
      );
      parameters.push(
        input.relationshipStatus === "pending"
          ? "pending_verification"
          : input.relationshipStatus
      );
    }
  }
  if (input.source === "shared") {
    conditions.push(
      `EXISTS (
        SELECT 1 FROM peer_relationships
        WHERE peer_relationships.owner_user_id = people.user_id
          AND peer_relationships.local_person_id = people.id
          AND peer_relationships.status = 'active'
      )`
    );
  } else if (input.source === "local") {
    conditions.push(
      `NOT EXISTS (
        SELECT 1 FROM peer_relationships
        WHERE peer_relationships.owner_user_id = people.user_id
          AND peer_relationships.local_person_id = people.id
          AND peer_relationships.status = 'active'
      )`
    );
  }
  if (input.hasUpcomingSharedContext) {
    conditions.push(
      `EXISTS (
        SELECT 1
        FROM peer_relationships
        JOIN peer_remote_records
          ON peer_remote_records.owner_user_id = peer_relationships.owner_user_id
         AND peer_remote_records.relationship_id = peer_relationships.id
        WHERE peer_relationships.owner_user_id = people.user_id
          AND peer_relationships.local_person_id = people.id
          AND peer_relationships.status = 'active'
          AND peer_remote_records.projection_id IN (
            'calendar.availability.v1', 'calendar.selected_events.v1'
          )
          AND peer_remote_records.query_hash IS NOT NULL
          AND peer_remote_records.next_event_at IS NOT NULL
          AND julianday(peer_remote_records.next_event_at) >=
              julianday(query_clock.now_iso)
          AND peer_remote_records.cache_state = 'current'
          AND (peer_remote_records.valid_until IS NULL
               OR julianday(peer_remote_records.valid_until) >
                  julianday(query_clock.now_iso))
      )`
    );
  }
  const sortExpression =
    input.sort === "display_name"
      ? "people.normalized_display_name"
      : input.sort === "updated_at"
        ? "people.updated_at"
        : `COALESCE((
            SELECT MIN(peer_remote_records.next_event_at)
            FROM peer_relationships
            JOIN peer_remote_records
              ON peer_remote_records.owner_user_id = peer_relationships.owner_user_id
             AND peer_remote_records.relationship_id = peer_relationships.id
            WHERE peer_relationships.owner_user_id = people.user_id
              AND peer_relationships.local_person_id = people.id
              AND peer_relationships.status = 'active'
              AND peer_remote_records.projection_id IN (
                'calendar.availability.v1', 'calendar.selected_events.v1'
              )
              AND peer_remote_records.query_hash IS NOT NULL
              AND peer_remote_records.next_event_at IS NOT NULL
              AND julianday(peer_remote_records.next_event_at) >=
                  julianday(query_clock.now_iso)
              AND peer_remote_records.cache_state = 'current'
              AND (peer_remote_records.valid_until IS NULL
                   OR julianday(peer_remote_records.valid_until) >
                      julianday(query_clock.now_iso))
          ), ${input.direction === "asc" ? "'9999-12-31T23:59:59.999Z'" : "''"})`;
  const cursorParameters: string[] = [];
  const cursorCondition = input.cursor
    ? (() => {
        const comparison = input.direction === "asc" ? ">" : "<";
        cursorParameters.push(
          input.cursor.sortValue,
          input.cursor.sortValue,
          input.cursor.id
        );
        return `WHERE (sort_value ${comparison} ?
          OR (sort_value = ? AND id ${comparison} ?))`;
      })()
    : "";
  const order = input.direction === "asc" ? "ASC" : "DESC";
  return getDatabase()
    .prepare(
      `WITH query_clock(now_iso) AS (VALUES (?)),
       candidates AS (
         SELECT people.id, ${sortExpression} AS sort_value
         FROM people
         CROSS JOIN query_clock
         WHERE ${conditions.join(" AND ")}
       )
       SELECT id, sort_value
       FROM candidates
       ${cursorCondition}
       ORDER BY sort_value ${order}, id ${order}
       LIMIT ?`
    )
    .all(
      input.now.toISOString(),
      ...parameters,
      ...cursorParameters,
      input.limit + 1
    ) as Array<{
    id: string;
    sort_value: string;
  }>;
}

function readPeopleReadModelRevision(ownerUserId: string): number {
  const row = getDatabase()
    .prepare(
      `SELECT revision
       FROM people_read_model_revisions
       WHERE owner_user_id = ?`
    )
    .get(ownerUserId) as { revision: number } | undefined;
  return row?.revision ?? 0;
}

function stalePeopleCursor(input: {
  expectedRevision: number;
  currentRevision: number;
}): never {
  throw new HttpError(
    409,
    "people_cursor_snapshot_changed",
    "People changed while this list was being paged. Restart the list to avoid missing or duplicated people.",
    {
      expectedRevision: input.expectedRevision,
      currentRevision: input.currentRevision,
      restartRequired: true
    }
  );
}

function listPeopleRowsAtStableRevision(
  input: Parameters<typeof listPeopleRows>[0]
) {
  const expectedRevision = input.cursor?.readModelRevision;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const beforeRevision = readPeopleReadModelRevision(input.ownerUserId);
    if (expectedRevision !== undefined && expectedRevision !== beforeRevision) {
      stalePeopleCursor({
        expectedRevision,
        currentRevision: beforeRevision
      });
    }
    const rows = listPeopleRows(input);
    const afterRevision = readPeopleReadModelRevision(input.ownerUserId);
    if (beforeRevision === afterRevision) {
      return { rows, readModelRevision: beforeRevision };
    }
    if (expectedRevision !== undefined) {
      stalePeopleCursor({
        expectedRevision,
        currentRevision: afterRevision
      });
    }
  }
  throw new HttpError(
    409,
    "people_snapshot_busy",
    "People changed repeatedly while the list was loading. Retry the list from the beginning.",
    { restartRequired: true }
  );
}

function readWikiRoot(ownerUserId: string, rootPageId: string) {
  const access = getWikiPageAccessRecord(rootPageId);
  if (
    !access ||
    access.kind !== "wiki" ||
    !canAccessWikiSpace(
      { userIds: [ownerUserId] },
      getWikiSpaceById(access.spaceId),
      "read"
    )
  ) {
    throw new HttpError(
      404,
      "wiki_people_root_not_found",
      "The selected Wiki People root was not found."
    );
  }
  const row = getDatabase()
    .prepare(
      `SELECT notes.id, notes.slug, notes.space_id AS spaceId,
              notes.updated_at AS updatedAt
       FROM notes
       WHERE notes.id = ? AND notes.kind = 'wiki' AND notes.space_id = ?`
    )
    .get(rootPageId, access.spaceId) as
    | { id: string; slug: string; spaceId: string; updatedAt: string }
    | undefined;
  if (!row) {
    throw new HttpError(
      404,
      "wiki_people_root_not_found",
      "The selected Wiki People root was not found."
    );
  }
  return row;
}

function readWikiDecisionVersions(
  ownerUserId: string,
  rootPageId: string,
  decisions: Array<{
    wikiPageId: string;
    personId?: string;
    expectedWikiVersion: string;
    expectedPersonVersion?: string;
  }>
) {
  const root = readWikiRoot(ownerUserId, rootPageId);
  const candidateRows = listWikiPeopleCandidatePagesByIds({
    userId: ownerUserId,
    rootSlug: root.slug,
    spaceId: root.spaceId,
    candidateIds: decisions.map((decision) => decision.wikiPageId)
  });
  const candidates = new Map(
    candidateRows
      .filter((page) => page.rootNoteId === root.id)
      .map((page) => [page.id, page] as const)
  );
  const versions: Record<string, string> = {
    [`root:${root.id}`]: root.updatedAt
  };
  for (const decision of decisions) {
    const note = candidates.get(decision.wikiPageId);
    if (
      !note ||
      !authorizeEntityForOwner({
        userId: ownerUserId,
        entityType: "note",
        entityId: decision.wikiPageId
      })
    ) {
      throw new HttpError(
        404,
        "wiki_people_candidate_not_found",
        "A reviewed Wiki candidate was not found."
      );
    }
    if (note.updatedAt !== decision.expectedWikiVersion) {
      throw new HttpError(
        409,
        "wiki_people_candidate_changed",
        "A Wiki candidate changed after it was reviewed."
      );
    }
    versions[`note:${note.id}`] = note.updatedAt;
    if (decision.personId) {
      const person = getPersonById(decision.personId, ownerUserId);
      if (!person) {
        throw new HttpError(
          404,
          "person_not_found",
          "The reviewed Person was not found."
        );
      }
      if (person.updatedAt !== decision.expectedPersonVersion) {
        throw new HttpError(
          409,
          "person_changed",
          "The Person changed after the Wiki association was reviewed."
        );
      }
      versions[`person:${person.id}`] = person.updatedAt;
    }
  }
  return { root, versions };
}

function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

function firstDayOfMonth(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`;
}

function addMonths(dateKey: string, months: number) {
  const [year, month] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + months, 1));
  return date.toISOString().slice(0, 10);
}

function localDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    dateKey: `${read("year")}-${read("month")}-${read("day")}`,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      read("weekday")
    )
  };
}

function zonedMidnight(dateKey: string, timeZone: string) {
  const resolved = resolveZonedDateTime(`${dateKey}T00:00`, timeZone);
  if (resolved.kind !== "exact" && resolved.kind !== "ambiguous") {
    throw new HttpError(
      400,
      "peer_question_time_unresolvable",
      "The requested local day cannot be represented in this time zone."
    );
  }
  return resolved.instants[0];
}

const QUESTION_WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;

function calendarQuestionDateKey(
  question: string,
  local: { dateKey: string; weekday: number }
) {
  const normalized = question.toLocaleLowerCase("en-US");
  const explicitDate = /\b(\d{4}-\d{2}-\d{2})\b/u.exec(normalized)?.[1];
  if (explicitDate) {
    if (addDays(explicitDate, 0) !== explicitDate) {
      throw new HttpError(
        400,
        "peer_question_date_invalid",
        "The requested calendar date is not valid."
      );
    }
    return explicitDate;
  }
  if (/\btomorrow\b/u.test(normalized)) {
    return addDays(local.dateKey, 1);
  }
  if (/\btoday\b/u.test(normalized)) {
    return local.dateKey;
  }
  const weekdayMatch = new RegExp(
    `\\b(?:(next|this)\\s+)?(${QUESTION_WEEKDAYS.join("|")})\\b`,
    "u"
  ).exec(normalized);
  if (!weekdayMatch) {
    return local.dateKey;
  }
  const targetWeekday = QUESTION_WEEKDAYS.indexOf(
    weekdayMatch[2] as (typeof QUESTION_WEEKDAYS)[number]
  );
  let days = (targetWeekday - local.weekday + 7) % 7;
  if (weekdayMatch[1] === "next" && days === 0) {
    days = 7;
  }
  return addDays(local.dateKey, days);
}

function cyclingQuestionDateRange(
  question: string,
  local: { dateKey: string; weekday: number }
) {
  const normalized = question.toLocaleLowerCase("en-US");
  const monthStart = firstDayOfMonth(local.dateKey);
  if (/\blast month\b/u.test(normalized)) {
    return {
      startsAt: addMonths(monthStart, -1),
      endsAt: monthStart
    };
  }
  if (/\bthis month\b/u.test(normalized)) {
    return {
      startsAt: monthStart,
      endsAt: addDays(local.dateKey, 1)
    };
  }
  const weekStart = addDays(local.dateKey, -((local.weekday + 6) % 7));
  if (/\blast week\b/u.test(normalized)) {
    return { startsAt: addDays(weekStart, -7), endsAt: weekStart };
  }
  if (/\bthis week\b/u.test(normalized)) {
    return { startsAt: weekStart, endsAt: addDays(local.dateKey, 1) };
  }
  const rolling =
    /\b(?:past|last|previous)\s+(\d{1,3})\s+(day|days|week|weeks|month|months)\b/u.exec(
      normalized
    );
  if (rolling) {
    const count = Number(rolling[1]);
    const unit = rolling[2]!;
    const days = unit.startsWith("day")
      ? count
      : unit.startsWith("week")
        ? count * 7
        : count * 31;
    if (count < 1 || days > 366) {
      throw new HttpError(
        400,
        "peer_question_range_too_large",
        "The requested aggregate range must be between 1 and 366 days."
      );
    }
    if (unit.startsWith("month")) {
      return {
        startsAt: addMonths(monthStart, -count),
        endsAt: addDays(local.dateKey, 1)
      };
    }
    return {
      startsAt: addDays(local.dateKey, -(days - 1)),
      endsAt: addDays(local.dateKey, 1)
    };
  }
  return {
    startsAt: addDays(local.dateKey, -29),
    endsAt: addDays(local.dateKey, 1)
  };
}

function goalQuestionHorizonMonths(question: string) {
  const match = /\b(?:next|coming|over the next)\s+(\d{1,2})\s+months?\b/u.exec(
    question.toLocaleLowerCase("en-US")
  );
  const months = match ? Number(match[1]) : 3;
  if (months < 1 || months > 12) {
    throw new HttpError(
      400,
      "peer_question_horizon_too_large",
      "A goal-horizon question must request between 1 and 12 months."
    );
  }
  return months;
}

function addMonthsClamped(dateKey: string, months: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const first = new Date(Date.UTC(year!, month! - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return new Date(
    Date.UTC(
      first.getUTCFullYear(),
      first.getUTCMonth(),
      Math.min(day!, lastDay)
    )
  )
    .toISOString()
    .slice(0, 10);
}

function buildTypedQuestion(input: {
  question: string;
  timeZone: string;
  referenceTime: string;
}) {
  const interpretation = interpretPeopleQuestion(input.question);
  if (!interpretation.supported) {
    return { interpretation, typedQuery: null };
  }
  const definition = getPeerProjectionDefinition(interpretation.projectionId);
  const reference = new Date(input.referenceTime);
  const local = localDateParts(reference, input.timeZone);
  let parameters: Record<string, unknown> = {};
  let interval: {
    startsAt: string;
    endsAt: string;
    timeZone: string;
  } | null = null;
  if (interpretation.projectionId === "calendar.availability.v1") {
    const dateKey = calendarQuestionDateKey(input.question, local);
    interval = {
      startsAt: zonedMidnight(dateKey, input.timeZone),
      endsAt: zonedMidnight(addDays(dateKey, 1), input.timeZone),
      timeZone: input.timeZone
    };
  } else if (interpretation.projectionId === "health.cycling.aggregate.v1") {
    const range = cyclingQuestionDateRange(input.question, local);
    interval = {
      startsAt: zonedMidnight(range.startsAt, input.timeZone),
      endsAt: zonedMidnight(range.endsAt, input.timeZone),
      timeZone: input.timeZone
    };
    parameters = {
      granularity: "week",
      units: "metric"
    };
  } else {
    interval = {
      startsAt: zonedMidnight(local.dateKey, input.timeZone),
      endsAt: zonedMidnight(
        addMonthsClamped(
          local.dateKey,
          goalQuestionHorizonMonths(input.question)
        ),
        input.timeZone
      ),
      timeZone: input.timeZone
    };
  }
  const fields =
    interpretation.projectionId === "calendar.availability.v1" &&
    interpretation.requestedPrecision === "exact"
      ? ["start", "end", "busyState", "eventTitle", "eventLocation"]
      : [...definition.defaultFields];
  return {
    interpretation,
    typedQuery: peerTypedQuestionSchema.parse({
      projectionId: interpretation.projectionId,
      parameters,
      interval,
      entityIds: [],
      fields,
      precision: interpretation.requestedPrecision,
      maximumResultCount: 100
    })
  };
}

function listPersonRelationships(input: {
  ownerUserId: string;
  personId: string;
  limit: number;
  now: Date;
}) {
  return getDatabase()
    .prepare(
      `WITH query_clock(now_iso) AS (VALUES (?))
       SELECT relationships.id,
              relationships.owner_user_id AS ownerUserId,
              relationships.local_principal_id AS localPrincipalId,
              relationships.remote_principal_id AS remotePrincipalId,
              relationships.local_person_id AS localPersonId,
              relationships.status,
              relationships.negotiated_protocol_version AS negotiatedProtocolVersion,
              relationships.transport_privacy_mode AS transportPrivacyMode,
              relationships.highest_received_sequence AS highestReceivedSequence,
              relationships.highest_sent_sequence AS highestSentSequence,
              relationships.established_at AS establishedAt,
              relationships.last_connected_at AS lastConnectedAt,
              relationships.revoked_at AS revokedAt,
              relationships.created_at AS createdAt,
              relationships.updated_at AS updatedAt,
              remote.display_label AS remoteDisplayLabel,
              remote.trust_state AS remoteTrustState,
              (
                SELECT COUNT(*)
                FROM peer_pending_requests AS requests
                WHERE requests.owner_user_id = relationships.owner_user_id
                  AND requests.relationship_id = relationships.id
                  AND requests.status = 'pending'
                  AND julianday(requests.expires_at) >
                      julianday(query_clock.now_iso)
              ) AS pendingRequestCount,
              (
                SELECT COUNT(*)
                FROM peer_relationship_devices AS devices
                WHERE devices.owner_user_id = relationships.owner_user_id
                  AND devices.relationship_id = relationships.id
                  AND devices.status = 'approved'
              ) AS approvedDeviceCount,
              (
                SELECT COUNT(*)
                FROM peer_relationship_devices AS devices
                WHERE devices.owner_user_id = relationships.owner_user_id
                  AND devices.relationship_id = relationships.id
                  AND devices.status = 'pending'
              ) AS pendingDeviceCount
       FROM peer_relationships AS relationships
       JOIN forge_principals AS remote
         ON remote.id = relationships.remote_principal_id
        AND remote.owner_user_id = relationships.owner_user_id
       CROSS JOIN query_clock
       WHERE relationships.owner_user_id = ?
         AND relationships.local_person_id = ?
       ORDER BY CASE relationships.status
                  WHEN 'active' THEN 0
                  WHEN 'pending_verification' THEN 1
                  WHEN 'paused' THEN 2
                  WHEN 'recovery_required' THEN 3
                  ELSE 4
                END,
                relationships.updated_at DESC,
                relationships.id DESC
       LIMIT ?`
    )
    .all(
      input.now.toISOString(),
      input.ownerUserId,
      input.personId,
      input.limit
    ) as Array<Record<string, unknown> & { id: string; status: string }>;
}

function relationshipForPerson(
  ownerUserId: string,
  personId: string,
  now: Date
) {
  return (
    listPersonRelationships({ ownerUserId, personId, limit: 1, now }).find(
      (relationship) => relationship.status === "active"
    ) ?? null
  );
}

function listPersonSharedProjections(input: {
  ownerUserId: string;
  personId: string;
  limit: number;
  now: Date;
}) {
  const rows = getDatabase()
    .prepare(
      `WITH ranked AS (
         SELECT remote.id,
                remote.projection_id AS projectionId,
                remote.projection_version AS projectionVersion,
                remote.source_timestamp AS asOf,
                remote.received_at AS receivedAt,
                remote.valid_until AS validUntil,
                remote.completeness,
                remote.precision,
                CASE
                  WHEN remote.cache_state = 'current'
                    AND remote.valid_until IS NOT NULL
                    AND julianday(remote.valid_until) <= julianday(?)
                  THEN 'stale'
                  ELSE remote.cache_state
                END AS state,
                remote.relationship_id AS relationshipId,
                remote.query_metadata_json AS queryMetadataJson,
                remote.grant_id AS grantId,
                remote.grant_sequence AS grantSequence,
                ROW_NUMBER() OVER (
                  PARTITION BY remote.relationship_id, remote.projection_id
                  ORDER BY remote.received_at DESC,
                           remote.source_timestamp DESC,
                           remote.id DESC
                ) AS rowRank
         FROM peer_remote_records AS remote
         JOIN peer_relationships AS relationships
           ON relationships.id = remote.relationship_id
          AND relationships.owner_user_id = remote.owner_user_id
         WHERE remote.owner_user_id = ?
           AND relationships.local_person_id = ?
           AND relationships.status = 'active'
           AND remote.query_hash IS NOT NULL
       )
       SELECT id, projectionId, projectionVersion, asOf, receivedAt,
              validUntil, completeness, precision, state, relationshipId,
              queryMetadataJson, grantId, grantSequence
       FROM ranked
       WHERE rowRank = 1
       ORDER BY receivedAt DESC, id DESC
       LIMIT ?`
    )
    .all(
      input.now.toISOString(),
      input.ownerUserId,
      input.personId,
      input.limit
    ) as Array<
    Record<string, unknown> & {
      queryMetadataJson: string;
    }
  >;
  return rows.map(({ queryMetadataJson, ...row }) => {
    let source: z.infer<typeof peerQuerySourceSchema> | null = null;
    try {
      const metadata = peerCachedQueryMetadataSchema.safeParse(
        JSON.parse(queryMetadataJson)
      );
      source = metadata.success ? metadata.data.source : null;
    } catch {
      source = null;
    }
    return { ...row, source };
  });
}

function authorizePeerQueryResult(input: {
  ownerUserId: string;
  relationshipId: string;
  query: TypedPeerQuestion;
  metadata: unknown;
}): QueryAuthorization {
  const metadata = peerQueryEvidenceSchema.parse(input.metadata);
  const evidence = getVerifiedPeerQueryGrantEvidence({
    ownerUserId: input.ownerUserId,
    relationshipId: input.relationshipId,
    grantId: metadata.grantId,
    grantSequence: metadata.grantSequence,
    verificationId: metadata.grantVerificationId,
    verifiedGrantHash: metadata.verifiedGrantHash
  });
  if (!evidence) {
    throw new Error(
      "The peer answer has no exact persisted grant verification."
    );
  }
  const decision = evaluatePeerProjectionAccess(
    evidence.grant,
    {
      ownerUserId: input.ownerUserId,
      relationshipId: input.relationshipId,
      requestingDeviceId: evidence.requestingDeviceId,
      projectionId: input.query.projectionId,
      requestedFields: input.query.fields,
      requestedPrecision: input.query.precision,
      entityIds: input.query.entityIds,
      startsAt: input.query.interval?.startsAt ?? null,
      endsAt: input.query.interval?.endsAt ?? null,
      requestedResultCount: input.query.maximumResultCount,
      requestedPayloadBytes: 0
    },
    {
      verifiedGrantHash: evidence.verifiedGrantHash,
      verifiedSignerDeviceIds: evidence.verifiedSignerDeviceIds,
      approvedRelationshipDeviceIds: evidence.approvedRelationshipDeviceIds
    }
  );
  if (!decision.allowed) {
    throw new Error(`The peer grant denied this query: ${decision.reason}.`);
  }
  return {
    grantId: evidence.grant.id,
    grantSequence: evidence.grant.sequence,
    grantVerificationId: evidence.verificationId,
    verifiedGrantHash: evidence.verifiedGrantHash,
    effectiveFields: decision.effectiveFields,
    redactedFields: decision.redactedFields,
    maximumResultCount: decision.maximumResultCount,
    maximumPayloadBytes: decision.maximumPayloadBytes,
    precision: decision.precision,
    cachePolicy: evidence.grant.cachePolicy,
    grantExpiresAt: evidence.grant.expiresAt,
    evidence: {
      ruleId: decision.ruleId,
      effectiveFields: decision.effectiveFields,
      redactedFields: decision.redactedFields,
      maximumResultCount: decision.maximumResultCount,
      maximumPayloadBytes: decision.maximumPayloadBytes,
      precision: decision.precision,
      requestingDeviceId: evidence.requestingDeviceId,
      verifiedAt: evidence.verifiedAt
    }
  };
}

function earliestTimestamp(values: Array<string | null>) {
  const valid = values.filter(
    (value): value is string =>
      value !== null && Number.isFinite(Date.parse(value))
  );
  if (valid.length === 0) return null;
  return valid.reduce((earliest, value) =>
    Date.parse(value) < Date.parse(earliest) ? value : earliest
  );
}

function peerCacheValidUntil(input: {
  authorization: QueryAuthorization;
  metadataValidUntil: string | null;
  now: Date;
}) {
  const retentionUntil =
    input.authorization.cachePolicy.maximumRetentionSeconds > 0
      ? new Date(
          input.now.getTime() +
            input.authorization.cachePolicy.maximumRetentionSeconds * 1_000
        ).toISOString()
      : null;
  return earliestTimestamp([
    input.metadataValidUntil,
    input.authorization.grantExpiresAt,
    retentionUntil
  ]);
}

function deriveNextCalendarEventAt(input: {
  projectionId: PeerProjectionId;
  payload: {
    records: Array<{
      recordId: string | null;
      fields: Record<string, unknown>;
    }>;
  };
  now: Date;
}) {
  if (
    input.projectionId !== "calendar.availability.v1" &&
    input.projectionId !== "calendar.selected_events.v1"
  ) {
    return null;
  }
  const candidates: string[] = [];
  for (const record of input.payload.records) {
    if (!record.recordId) continue;
    const startsAt = record.fields.start;
    if (
      typeof startsAt !== "string" ||
      !Number.isFinite(Date.parse(startsAt))
    ) {
      continue;
    }
    if (
      input.projectionId === "calendar.availability.v1" &&
      record.fields.busyState !== "busy"
    ) {
      continue;
    }
    if (Date.parse(startsAt) >= input.now.getTime()) {
      candidates.push(startsAt);
    }
  }
  return earliestTimestamp(candidates);
}

function peerRemoteQueryRecordId(input: {
  ownerUserId: string;
  relationshipId: string;
  projectionId: PeerProjectionId;
  projectionVersion: number;
  queryHash: string;
}) {
  return `peer_remote_${hashPeerApiValue(input)}`;
}

async function persistAuthenticatedPeerQueryCache(input: {
  ownerUserId: string;
  relationshipId: string;
  query: TypedPeerQuestion;
  payload: {
    records: Array<{
      recordId: string | null;
      fields: Record<string, unknown>;
    }>;
  };
  metadata: PeerProjectionResponseMetadata;
  authorization: QueryAuthorization;
  secrets: SecretsManager;
  now: Date;
}) {
  if (input.authorization.cachePolicy.mode === "none") return;
  const queryHash = hashPeerQueryCacheIdentity(input.query);
  const validUntil = peerCacheValidUntil({
    authorization: input.authorization,
    metadataValidUntil: input.metadata.validUntil,
    now: input.now
  });
  if (validUntil !== null && Date.parse(validUntil) <= input.now.getTime()) {
    return;
  }
  const sourceRecordId = `query_${queryHash}`;
  const sourceVersion = input.metadata.asOf;
  const key = input.secrets.deriveKey("peer-remote-cache/v1");
  const keyId = peerCacheKeyId(key);
  let envelope: Awaited<ReturnType<typeof encryptPeerCachePayload>>;
  try {
    envelope = await encryptPeerCachePayload({
      key,
      keyId,
      context: {
        ownerUserId: input.ownerUserId,
        relationshipId: input.relationshipId,
        projectionId: input.query.projectionId,
        queryHash,
        sourceRecordId,
        sourceVersion
      },
      payload: input.payload
    });
  } finally {
    key.fill(0);
  }
  const payloadJson = JSON.stringify(input.payload);
  const queryMetadataJson = JSON.stringify({
    grantId: input.authorization.grantId,
    grantSequence: input.authorization.grantSequence,
    grantVerificationId: input.authorization.grantVerificationId,
    verifiedGrantHash: input.authorization.verifiedGrantHash,
    queryHash,
    source: input.metadata.source,
    redactedFields: input.metadata.redactedFields
  });
  const nextEventAt = deriveNextCalendarEventAt({
    projectionId: input.query.projectionId,
    payload: input.payload,
    now: input.now
  });
  const at = input.now.toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO peer_remote_records (
         id, owner_user_id, relationship_id, projection_id,
         projection_version, source_record_id, source_version,
         encrypted_payload, encryption_key_id, encryption_nonce, payload_hash,
         query_metadata_json, query_hash, next_event_at, source_timestamp,
         received_at, valid_until, completeness, precision, grant_id,
         grant_sequence, cache_state, tombstoned_at, revoked_at, created_at,
         updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              'current', NULL, NULL, ?, ?
       FROM peer_relationships
       WHERE id = ? AND owner_user_id = ? AND status = 'active'
       ON CONFLICT(owner_user_id, relationship_id, projection_id, source_record_id)
       DO UPDATE SET
         id = excluded.id,
         projection_version = excluded.projection_version,
         source_version = excluded.source_version,
         encrypted_payload = excluded.encrypted_payload,
         encryption_key_id = excluded.encryption_key_id,
         encryption_nonce = excluded.encryption_nonce,
         payload_hash = excluded.payload_hash,
         query_metadata_json = excluded.query_metadata_json,
         next_event_at = excluded.next_event_at,
         source_timestamp = excluded.source_timestamp,
         received_at = excluded.received_at,
         valid_until = excluded.valid_until,
         completeness = excluded.completeness,
         precision = excluded.precision,
         grant_id = excluded.grant_id,
         grant_sequence = excluded.grant_sequence,
         cache_state = 'current',
         tombstoned_at = NULL,
         revoked_at = NULL,
         updated_at = excluded.updated_at`
    )
    .run(
      peerRemoteQueryRecordId({
        ownerUserId: input.ownerUserId,
        relationshipId: input.relationshipId,
        projectionId: input.query.projectionId,
        projectionVersion: input.metadata.projectionVersion,
        queryHash
      }),
      input.ownerUserId,
      input.relationshipId,
      input.query.projectionId,
      input.metadata.projectionVersion,
      sourceRecordId,
      sourceVersion,
      Buffer.from(envelope.ciphertextBase64, "base64"),
      keyId,
      Buffer.from(envelope.nonceBase64, "base64"),
      createHash("sha256").update(payloadJson, "utf8").digest("hex"),
      queryMetadataJson,
      queryHash,
      nextEventAt,
      input.metadata.asOf,
      at,
      validUntil,
      input.metadata.completeness,
      input.metadata.precision,
      input.authorization.grantId,
      input.authorization.grantSequence,
      at,
      at,
      input.relationshipId,
      input.ownerUserId
    );
}

function assertAuthorizedPeerSource(input: {
  ownerUserId: string;
  relationshipId: string;
  source: z.infer<typeof peerQuerySourceSchema>;
}) {
  if (input.source.relationshipId !== input.relationshipId) {
    throw new Error(
      "Peer result source relationship does not match the request."
    );
  }
  const authorized = getDatabase()
    .prepare(
      `SELECT 1
       FROM peer_relationships
       JOIN peer_relationship_devices
         ON peer_relationship_devices.relationship_id = peer_relationships.id
        AND peer_relationship_devices.owner_user_id = peer_relationships.owner_user_id
       JOIN forge_devices
         ON forge_devices.id = peer_relationship_devices.device_id
        AND forge_devices.owner_user_id = peer_relationship_devices.owner_user_id
       WHERE peer_relationships.id = ?
         AND peer_relationships.owner_user_id = ?
         AND peer_relationships.status = 'active'
         AND peer_relationships.remote_principal_id = ?
         AND peer_relationship_devices.device_id = ?
         AND peer_relationship_devices.principal_role = 'remote'
         AND peer_relationship_devices.status = 'approved'
         AND forge_devices.principal_id = peer_relationships.remote_principal_id
         AND forge_devices.status = 'approved'
       LIMIT 1`
    )
    .get(
      input.relationshipId,
      input.ownerUserId,
      input.source.principalId,
      input.source.deviceId
    );
  if (!authorized) {
    throw new Error(
      "Peer result source is not an approved remote device for this relationship."
    );
  }
}

function validatePeerMetadataTiming(input: {
  asOf: string;
  validUntil: string | null;
  now: Date;
  state: "live" | "cached" | "stale";
}) {
  const nowMs = input.now.getTime();
  const asOfMs = Date.parse(input.asOf);
  if (asOfMs > nowMs + 5 * 60_000) {
    throw new Error("Peer result timestamp is implausibly far in the future.");
  }
  if (input.validUntil !== null && Date.parse(input.validUntil) < asOfMs) {
    throw new Error("Peer result validity ends before its source timestamp.");
  }
  if (
    input.state === "live" &&
    input.validUntil !== null &&
    Date.parse(input.validUntil) <= nowMs
  ) {
    throw new Error("Peer returned a live result that is already expired.");
  }
}

function normalizeLivePeerResultMetadata(input: {
  ownerUserId: string;
  relationshipId: string;
  query: TypedPeerQuestion;
  authorization: QueryAuthorization;
  metadata: unknown;
  now: Date;
}): PeerProjectionResponseMetadata {
  const metadata = peerAuthenticatedProjectionMetadataSchema.parse(
    input.metadata
  );
  if (
    metadata.state !== "live" ||
    metadata.projectionId !== input.query.projectionId ||
    metadata.projectionVersion !==
      getPeerProjectionDefinition(input.query.projectionId).version ||
    metadata.grantId !== input.authorization.grantId ||
    metadata.grantSequence !== input.authorization.grantSequence ||
    metadata.grantVerificationId !== input.authorization.grantVerificationId ||
    metadata.verifiedGrantHash !== input.authorization.verifiedGrantHash ||
    metadata.precision !== input.authorization.precision
  ) {
    throw new Error(
      "Peer result metadata does not match the authorized query."
    );
  }
  assertAuthorizedPeerSource({
    ownerUserId: input.ownerUserId,
    relationshipId: input.relationshipId,
    source: metadata.source
  });
  validatePeerMetadataTiming({
    asOf: metadata.asOf,
    validUntil: metadata.validUntil,
    now: input.now,
    state: "live"
  });
  return peerProjectionResponseMetadataSchema.parse({
    source: metadata.source,
    projectionId: metadata.projectionId,
    projectionVersion: metadata.projectionVersion,
    grantId: metadata.grantId,
    grantSequence: metadata.grantSequence,
    asOf: metadata.asOf,
    receivedAt: input.now.toISOString(),
    validUntil: metadata.validUntil,
    completeness: metadata.completeness,
    precision: metadata.precision,
    redactedFields: metadata.redactedFields,
    state: "live"
  });
}

function normalizeCachedPeerResultMetadata(input: {
  ownerUserId: string;
  relationshipId: string;
  query: TypedPeerQuestion;
  authorization: QueryAuthorization;
  queryMetadata: z.infer<typeof peerCachedQueryMetadataSchema>;
  row: {
    projectionId: string;
    projectionVersion: number;
    asOf: string;
    receivedAt: string;
    validUntil: string | null;
    completeness: number;
    precision: string;
    grantId: string | null;
    grantSequence: number | null;
    state: "current" | "stale";
  };
  now: Date;
}): PeerProjectionResponseMetadata {
  const expectedVersion = getPeerProjectionDefinition(
    input.query.projectionId
  ).version;
  if (
    input.row.projectionId !== input.query.projectionId ||
    input.row.projectionVersion !== expectedVersion ||
    input.row.grantId !== input.authorization.grantId ||
    input.row.grantSequence !== input.authorization.grantSequence ||
    input.row.precision !== input.authorization.precision ||
    input.queryMetadata.grantId !== input.authorization.grantId ||
    input.queryMetadata.grantSequence !== input.authorization.grantSequence ||
    input.queryMetadata.grantVerificationId !==
      input.authorization.grantVerificationId ||
    input.queryMetadata.verifiedGrantHash !==
      input.authorization.verifiedGrantHash
  ) {
    throw new Error(
      "Cached peer result metadata does not match the authorized query."
    );
  }
  assertAuthorizedPeerSource({
    ownerUserId: input.ownerUserId,
    relationshipId: input.relationshipId,
    source: input.queryMetadata.source
  });
  const expired =
    input.row.validUntil !== null &&
    Date.parse(input.row.validUntil) <= input.now.getTime();
  const state = input.row.state === "stale" || expired ? "stale" : "cached";
  validatePeerMetadataTiming({
    asOf: input.row.asOf,
    validUntil: input.row.validUntil,
    now: input.now,
    state
  });
  return peerProjectionResponseMetadataSchema.parse({
    source: input.queryMetadata.source,
    projectionId: input.query.projectionId,
    projectionVersion: expectedVersion,
    grantId: input.authorization.grantId,
    grantSequence: input.authorization.grantSequence,
    asOf: input.row.asOf,
    receivedAt: input.row.receivedAt,
    validUntil: input.row.validUntil,
    completeness: input.row.completeness,
    precision: input.authorization.precision,
    redactedFields: input.queryMetadata.redactedFields,
    state
  });
}

export async function registerPeopleRoutes(
  app: FastifyInstance,
  dependencies: PeopleRouteDependencies
) {
  app.addHook("preSerialization", async (request, reply, payload) => {
    const routePath = request.routeOptions.url;
    if (!routePath) return payload;
    const contract = getPeerRouteContract(
      request.method as PeerRouteMethod,
      routePath
    );
    if (
      contract?.tag !== "People" ||
      reply.statusCode < 200 ||
      reply.statusCode >= 300
    ) {
      return payload;
    }
    return parsePeerApiSuccess(
      contract.operationId as PeerApiOperationId,
      payload
    );
  });
  const cursorKey = dependencies.secrets.deriveKey("peer-api-cursors/v1");
  const limiter = dependencies.rateLimiter ?? new PeerOperationRateLimiter();

  app.get("/api/v1/people", async (request, reply) => {
    const query = PEER_API_SCHEMAS.listPeopleReadModel.query.parse(
      request.query ?? {}
    ) as z.infer<(typeof PEER_API_SCHEMAS)["listPeopleReadModel"]["query"]>;
    const actor = authenticatePeopleRoute(
      dependencies,
      request.headers as Record<string, unknown>,
      "listPeopleReadModel",
      query.userId
    );
    const requestNow = actor.auth.now ?? new Date();
    const listCursorKind = cursorKind("people", {
      ownerUserId: actor.ownerUserId,
      query: query.query ?? "",
      relationshipStatus: query.relationshipStatus ?? null,
      source: query.source,
      hasUpcomingSharedContext: query.hasUpcomingSharedContext ?? null,
      sort: query.sort,
      direction: query.direction
    });
    let cursor: z.infer<typeof peopleCursorSchema> | null;
    if (!query.cursor) {
      consumePeopleRateLimit({
        limiter,
        reply,
        actor,
        operationId: "listPeopleReadModel",
        bucketId: "listPeopleReadModel:initial",
        limit: PEOPLE_LIST_INITIAL_REQUESTS_PER_MINUTE
      });
      cursor = null;
    } else {
      try {
        cursor = decodePeerCursor(query.cursor, {
          kind: listCursorKind,
          key: cursorKey,
          payloadSchema: peopleCursorSchema,
          now: requestNow
        });
      } catch (error) {
        consumePeopleRateLimit({
          limiter,
          reply,
          actor,
          operationId: "listPeopleReadModel",
          bucketId: "listPeopleReadModel:invalid_cursor",
          limit: PEOPLE_LIST_INVALID_CURSOR_REQUESTS_PER_MINUTE
        });
        throw error;
      }
      consumePeopleRateLimit({
        limiter,
        reply,
        actor,
        operationId: "listPeopleReadModel",
        bucketId: "listPeopleReadModel:continuation",
        limit: PEOPLE_LIST_CONTINUATION_REQUESTS_PER_MINUTE
      });
    }
    const snapshotAt = cursor?.snapshotAt ?? requestNow.toISOString();
    if (Date.parse(snapshotAt) > requestNow.getTime() + 5 * 60_000) {
      throw new HttpError(
        400,
        "people_cursor_snapshot_invalid",
        "The People cursor snapshot is invalid."
      );
    }
    const snapshotNow = new Date(snapshotAt);
    const stablePage = listPeopleRowsAtStableRevision({
      ownerUserId: actor.ownerUserId,
      query: query.query,
      relationshipStatus: query.relationshipStatus,
      source: query.source,
      hasUpcomingSharedContext: query.hasUpcomingSharedContext,
      sort: query.sort,
      direction: query.direction,
      cursor,
      limit: query.limit,
      now: snapshotNow
    });
    const rows = stablePage.rows;
    const page = rows.slice(0, query.limit);
    const people = getPeopleByIdsForUser(
      page.map((row) => row.id),
      actor.ownerUserId
    ).map((person) =>
      redactPersonForAuth(person, actor.auth, { includePrivate: false })
    );
    const last = page.at(-1);
    return {
      people,
      page: {
        limit: query.limit,
        hasMore: rows.length > query.limit,
        nextCursor:
          rows.length > query.limit && last
            ? encodePeerCursor({
                kind: listCursorKind,
                payload: {
                  sortValue: last.sort_value,
                  id: last.id,
                  snapshotAt,
                  readModelRevision: stablePage.readModelRevision
                },
                key: cursorKey,
                now: requestNow
              })
            : null
      }
    };
  });

  app.get("/api/v1/people/:personId/context", async (request) => {
    const params = PEER_API_SCHEMAS.getPersonContext.params.parse(
      request.params ?? {}
    ) as { personId: string };
    const query = PEER_API_SCHEMAS.getPersonContext.query.parse(
      request.query ?? {}
    ) as {
      includePrivate: boolean;
      includeShared: boolean;
      linkLimit: number;
      projectionLimit: number;
    };
    const actor = authenticatePeopleRoute(
      dependencies,
      request.headers as Record<string, unknown>,
      "getPersonContext",
      undefined,
      params.personId
    );
    if (query.includePrivate && !hasScope(actor.auth, "people:read:private")) {
      throw new HttpError(
        403,
        "people_private_scope_required",
        "Private Person context requires people:read:private."
      );
    }
    const context = getPersonContextReadModel(
      {
        userId: actor.ownerUserId,
        personId: params.personId,
        linkLimit: query.linkLimit
      },
      peopleServiceDependencies(actor.ownerUserId)
    );
    if (!context) {
      throw new HttpError(404, "person_not_found", "Person not found.");
    }
    const now = actor.auth.now ?? new Date();
    const relationships = query.includeShared
      ? listPersonRelationships({
          ownerUserId: actor.ownerUserId,
          personId: params.personId,
          limit: 100,
          now
        })
      : [];
    const projections = query.includeShared
      ? listPersonSharedProjections({
          ownerUserId: actor.ownerUserId,
          personId: params.personId,
          limit: query.projectionLimit,
          now
        })
      : [];
    return {
      context: {
        person: redactPersonForAuth(context.person, actor.auth, {
          includePrivate: query.includePrivate
        }),
        links: context.links,
        profilePageLinks: context.profilePageLinks,
        relationships,
        sharedProjections: projections,
        sources: {
          local: true,
          wiki: context.profilePageLinks.length > 0,
          shared: relationships.length > 0,
          sharedProjectionCount: projections.length
        }
      }
    };
  });

  app.post("/api/v1/people/wiki-candidates/scan", async (request, reply) => {
    const body = PEER_API_SCHEMAS.scanPeopleWikiCandidates.body!.parse(
      request.body ?? {}
    ) as {
      userId?: string;
      peopleRootPageId: string;
      query?: string;
      cursor?: string;
      limit: number;
    };
    const actor = authenticatePeopleRoute(
      dependencies,
      request.headers as Record<string, unknown>,
      "scanPeopleWikiCandidates",
      body.userId
    );
    consumePeopleRateLimit({
      limiter,
      reply,
      actor,
      operationId: "scanPeopleWikiCandidates",
      limit: 30
    });
    const root = readWikiRoot(actor.ownerUserId, body.peopleRootPageId);
    const scan = collectWikiPeopleCandidates(
      {
        userId: actor.ownerUserId,
        spaceId: root.spaceId,
        rootSlug: root.slug,
        includeAssociated: true,
        maximumRows: 20_000
      },
      peopleServiceDependencies(actor.ownerUserId)
    );
    const normalizedQuery = normalizePersonSearchText(body.query ?? "");
    const candidates = normalizedQuery
      ? scan.candidates.filter((candidate) =>
          [candidate.title, candidate.slug, ...candidate.aliases].some(
            (value) =>
              normalizePersonSearchText(value).includes(normalizedQuery)
          )
        )
      : scan.candidates;
    const wikiCursorKind = cursorKind("wiki-people", {
      ownerUserId: actor.ownerUserId,
      rootPageId: root.id,
      query: normalizedQuery
    });
    const snapshotHash = hashPeerApiValue({
      root: { id: root.id, updatedAt: root.updatedAt },
      candidates: candidates.map((candidate) => ({
        noteId: candidate.noteId,
        updatedAt: candidate.updatedAt,
        status: candidate.status,
        associatedPersonIds: candidate.associatedPersonIds,
        matchingPersonIds: candidate.matchingPersonIds,
        duplicateCandidateNoteIds: candidate.duplicateCandidateNoteIds
      }))
    });
    const cursor = decodePeerCursor(body.cursor, {
      kind: wikiCursorKind,
      key: cursorKey,
      payloadSchema: scanCursorSchema,
      now: actor.auth.now ?? new Date()
    });
    if (cursor && cursor.snapshotHash !== snapshotHash) {
      throw new HttpError(
        409,
        "wiki_people_scan_changed",
        "Wiki People candidates changed while this result was being paged. Start the scan again."
      );
    }
    const offset = cursor?.offset ?? 0;
    const page = candidates.slice(offset, offset + body.limit);
    const nextOffset = offset + page.length;
    return {
      candidates: page,
      root,
      page: {
        limit: body.limit,
        hasMore: nextOffset < candidates.length,
        nextCursor:
          nextOffset < candidates.length
            ? encodePeerCursor({
                kind: wikiCursorKind,
                payload: { offset: nextOffset, snapshotHash },
                key: cursorKey,
                now: actor.auth.now ?? new Date()
              })
            : null
      },
      scan: {
        rootCount: scan.rootCount,
        scannedCount: scan.scannedCount,
        truncated: scan.truncated
      }
    };
  });

  app.post("/api/v1/people/wiki-candidates/enrich", async (request, reply) => {
    const body = PEER_API_SCHEMAS.enrichPeopleWikiCandidates.body!.parse(
      request.body ?? {}
    ) as {
      userId?: string;
      peopleRootPageId: string;
      candidateIds: string[];
      llmProfileId?: string;
    };
    const actor = authenticatePeopleRoute(
      dependencies,
      request.headers as Record<string, unknown>,
      "enrichPeopleWikiCandidates",
      body.userId
    );
    consumePeopleRateLimit({
      limiter,
      reply,
      actor,
      operationId: "enrichPeopleWikiCandidates",
      bucketId: "enrichPeopleWikiCandidates",
      limit: 10
    });
    const root = readWikiRoot(actor.ownerUserId, body.peopleRootPageId);
    const pages = listWikiPeopleCandidatePagesByIds({
      userId: actor.ownerUserId,
      rootSlug: root.slug,
      spaceId: root.spaceId,
      candidateIds: body.candidateIds
    }).filter((page) => page.rootNoteId === root.id);
    if (pages.length !== new Set(body.candidateIds).size) {
      throw new HttpError(
        404,
        "wiki_people_candidate_not_found",
        "One or more selected Wiki People pages were not found."
      );
    }

    const enabledProfiles = listWikiLlmProfiles().filter(
      (profile) => profile.enabled
    );
    const profile = body.llmProfileId
      ? enabledProfiles.find((candidate) => candidate.id === body.llmProfileId)
      : enabledProfiles[0];
    const fallback = pages.map((page) => ({
      pageId: page.id,
      displayName: page.title,
      preferredName: "",
      relationshipCategory: "other" as const,
      relationshipLabel: "",
      shortDescription: page.summary,
      aliases: page.aliasesJson ? parseWikiPersonAliases(page.aliasesJson) : []
    }));
    if (!profile) {
      return {
        llmAvailable: false,
        enriched: false,
        profile: null,
        suggestions: fallback
      };
    }

    const sources = pages.map((page) => {
      const detail = getWikiPageDetail(page.id);
      return {
        pageId: page.id,
        title: page.title,
        summary: page.summary,
        aliases: fallback.find((item) => item.pageId === page.id)?.aliases ?? [],
        content: detail?.page.contentMarkdown.slice(0, 6_000) ?? ""
      };
    });
    let outputText: string;
    try {
      const response = await dependencies.llm.runTextPrompt(profile, {
        systemPrompt:
          "Extract conservative Person record suggestions from reviewed Forge Wiki pages. Return JSON only. Never invent contact details, birthdays, sensitive facts, or relationships not supported by the page.",
        prompt: `${JSON.stringify(sources)}\n\nReturn exactly {"people":[{"pageId":"...","displayName":"...","preferredName":"","relationshipCategory":"family|friend|partner|colleague|community|professional|other","relationshipLabel":"","shortDescription":"","aliases":[]}]} using one item per supplied pageId.`
      });
      outputText = response.outputText;
    } catch (error) {
      throw new HttpError(
        502,
        "people_wiki_llm_failed",
        error instanceof Error
          ? `The configured LLM could not prepare Person suggestions: ${error.message}`
          : "The configured LLM could not prepare Person suggestions."
      );
    }
    const parsed = parseWikiPeopleLlmResponse(outputText);
    const suppliedIds = new Set(body.candidateIds);
    const suggestionsById = new Map(
      parsed.people
        .filter((suggestion) => suppliedIds.has(suggestion.pageId))
        .map((suggestion) => [suggestion.pageId, suggestion] as const)
    );
    return {
      llmAvailable: true,
      enriched: true,
      profile: { id: profile.id, label: profile.label, model: profile.model },
      suggestions: fallback.map(
        (suggestion) => suggestionsById.get(suggestion.pageId) ?? suggestion
      )
    };
  });

  app.post("/api/v1/people/wiki-associations/preview", async (request) => {
    const body = PEER_API_SCHEMAS.previewPeopleWikiAssociations.body!.parse(
      request.body ?? {}
    ) as {
      userId?: string;
      peopleRootPageId: string;
      decisions: ApiWikiDecision[];
    };
    const actor = authenticatePeopleRoute(
      dependencies,
      request.headers as Record<string, unknown>,
      "previewPeopleWikiAssociations",
      body.userId
    );
    const reviewed = readWikiDecisionVersions(
      actor.ownerUserId,
      body.peopleRootPageId,
      body.decisions
    );
    const preview = previewWikiPersonAssociationDecisions(
      {
        userId: actor.ownerUserId,
        rootSlug: reviewed.root.slug,
        decisions: toServiceWikiDecisions(body.decisions),
        actor: actor.auth.actor
      },
      peopleServiceDependencies(actor.ownerUserId)
    );
    return {
      preview: {
        id: preview.previewId,
        hash: preview.previewHash,
        expiresAt: preview.expiresAt,
        effects: body.decisions.map((decision) => ({
          wikiPageId: decision.wikiPageId,
          action: decision.action,
          personId: decision.personId ?? null,
          displayName: decision.displayName ?? null
        })),
        mutationCount: body.decisions.filter(
          (decision) => decision.action !== "skip"
        ).length
      }
    };
  });

  app.post("/api/v1/people/wiki-associations/apply", async (request) => {
    const body = PEER_API_SCHEMAS.applyPeopleWikiAssociations.body!.parse(
      request.body ?? {}
    ) as {
      userId?: string;
      peopleRootPageId: string;
      previewId: string;
      previewHash: string;
      idempotencyKey: string;
      decisions: ApiWikiDecision[];
    };
    const actor = authenticatePeopleRoute(
      dependencies,
      request.headers as Record<string, unknown>,
      "applyPeopleWikiAssociations",
      body.userId
    );
    readWikiRoot(actor.ownerUserId, body.peopleRootPageId);
    return applyWikiPersonAssociationPreview(
      {
        userId: actor.ownerUserId,
        previewId: body.previewId,
        previewHash: body.previewHash,
        idempotencyKey: body.idempotencyKey,
        decisions: toServiceWikiDecisions(body.decisions),
        actor: actor.auth.actor
      },
      peopleServiceDependencies(actor.ownerUserId)
    );
  });

  app.post(
    "/api/v1/people/:personId/questions/interpret",
    async (request, reply) => {
      const params = PEER_API_SCHEMAS.interpretPersonQuestion.params.parse(
        request.params ?? {}
      ) as { personId: string };
      const body = PEER_API_SCHEMAS.interpretPersonQuestion.body!.parse(
        request.body ?? {}
      ) as { question: string; timeZone: string; referenceTime?: string };
      const actor = authenticatePeopleRoute(
        dependencies,
        request.headers as Record<string, unknown>,
        "interpretPersonQuestion",
        undefined,
        params.personId
      );
      if (!getPersonById(params.personId, actor.ownerUserId)) {
        throw new HttpError(404, "person_not_found", "Person not found.");
      }
      consumePeopleRateLimit({
        limiter,
        reply,
        actor,
        operationId: "interpretPersonQuestion",
        limit: 60
      });
      const interpreted = buildTypedQuestion({
        question: body.question,
        timeZone: body.timeZone,
        referenceTime:
          body.referenceTime ?? (actor.auth.now ?? new Date()).toISOString()
      });
      if (!interpreted.interpretation.supported || !interpreted.typedQuery) {
        return { interpretation: interpreted.interpretation };
      }
      const stored = createPeerQuestionInterpretation({
        ownerUserId: actor.ownerUserId,
        personId: params.personId,
        question: body.question,
        typedQuery: interpreted.typedQuery
      });
      return {
        interpretation: {
          ...interpreted.interpretation,
          id: stored.id,
          hash: stored.interpretationHash,
          expiresAt: stored.expiresAt,
          query: stored.typedQuery
        }
      };
    }
  );

  app.post(
    "/api/v1/people/:personId/questions/execute",
    async (request, reply) => {
      const startedAt = performance.now();
      const params = PEER_API_SCHEMAS.executePersonQuestion.params.parse(
        request.params ?? {}
      ) as { personId: string };
      const body = PEER_API_SCHEMAS.executePersonQuestion.body!.parse(
        request.body ?? {}
      ) as {
        interpretationId: string;
        interpretationHash: string;
        query: TypedPeerQuestion;
        sourcePreference: "live_then_cache" | "live_only" | "cache_only";
      };
      const actor = authenticatePeopleRoute(
        dependencies,
        request.headers as Record<string, unknown>,
        "executePersonQuestion",
        undefined,
        params.personId
      );
      consumePeopleRateLimit({
        limiter,
        reply,
        actor,
        operationId: "executePersonQuestion",
        limit: 30
      });
      const relationship = relationshipForPerson(
        actor.ownerUserId,
        params.personId,
        actor.auth.now ?? new Date()
      );
      if (!relationship) {
        throw new HttpError(
          409,
          "person_peer_relationship_unavailable",
          "This Person has no active Forge sharing relationship."
        );
      }
      const result = await consumePeerQuestionInterpretation({
        ownerUserId: actor.ownerUserId,
        personId: params.personId,
        interpretationId: body.interpretationId,
        interpretationHash: body.interpretationHash,
        typedQuery: body.query,
        execute: () => ({ relationship })
      });
      let response: Awaited<
        ReturnType<PeerCoreGateway["executeQuery"]>
      > | null = null;
      let authorization: QueryAuthorization | null = null;
      let validatedResultCount = 0;
      let failure: unknown = null;
      if (body.sourcePreference !== "cache_only") {
        try {
          const liveResponse = await dependencies.peerCore.executeQuery({
            ownerUserId: actor.ownerUserId,
            relationshipId: result.relationship.id,
            personId: params.personId,
            query: body.query,
            timeoutMs: 12_000
          });
          if (liveResponse.state !== "live") {
            throw new Error(
              "The peer did not return a live authenticated result."
            );
          }
          authorization = authorizePeerQueryResult({
            ownerUserId: actor.ownerUserId,
            relationshipId: result.relationship.id,
            query: body.query,
            metadata: liveResponse.metadata
          });
          const resultMetadata = normalizeLivePeerResultMetadata({
            ownerUserId: actor.ownerUserId,
            relationshipId: result.relationship.id,
            query: body.query,
            authorization,
            metadata: liveResponse.metadata,
            now: actor.auth.now ?? new Date()
          });
          const validated = validatePeerProjectionOutput({
            projectionId: body.query.projectionId,
            payload: liveResponse.payload,
            effectiveFields: authorization.effectiveFields,
            maximumResultCount: Math.min(
              body.query.maximumResultCount,
              authorization.maximumResultCount
            ),
            maximumPayloadBytes: authorization.maximumPayloadBytes
          });
          validatedResultCount = validated.resultCount;
          await persistAuthenticatedPeerQueryCache({
            ownerUserId: actor.ownerUserId,
            relationshipId: result.relationship.id,
            query: body.query,
            payload: validated.payload,
            metadata: resultMetadata,
            authorization,
            secrets: dependencies.secrets,
            now: actor.auth.now ?? new Date()
          });
          response = {
            ...liveResponse,
            payload: validated.payload,
            metadata: {
              ...resultMetadata,
              redactedFields: [
                ...new Set([
                  ...resultMetadata.redactedFields,
                  ...authorization.redactedFields,
                  ...validated.redactedFields
                ])
              ].sort()
            }
          };
        } catch (error) {
          failure = error;
        }
      }
      if (!response && body.sourcePreference !== "live_only") {
        const queryHash = hashPeerQueryCacheIdentity(body.query);
        const cached = getDatabase()
          .prepare(
            `SELECT id, projection_id AS projectionId,
                  projection_version AS projectionVersion,
                  source_timestamp AS asOf,
                  received_at AS receivedAt, valid_until AS validUntil,
                  completeness, precision, cache_state AS state,
                  source_record_id AS sourceRecordId,
                  source_version AS sourceVersion,
                  encrypted_payload AS encryptedPayload,
                  encryption_key_id AS encryptionKeyId,
                  encryption_nonce AS encryptionNonce,
                  query_hash AS queryHash,
                  query_metadata_json AS queryMetadataJson,
                  grant_id AS grantId, grant_sequence AS grantSequence
           FROM peer_remote_records
           WHERE owner_user_id = ? AND relationship_id = ?
             AND projection_id = ? AND query_hash = ?
             AND cache_state IN ('current', 'stale')
           ORDER BY received_at DESC, id DESC LIMIT 1`
          )
          .get(
            actor.ownerUserId,
            relationship.id,
            body.query.projectionId,
            queryHash
          ) as
          | (Record<string, unknown> & {
              sourceRecordId: string;
              id: string;
              sourceVersion: string;
              projectionId: string;
              projectionVersion: number;
              asOf: string;
              receivedAt: string;
              validUntil: string | null;
              completeness: number;
              precision: string;
              encryptedPayload: Buffer;
              encryptionKeyId: string;
              encryptionNonce: Buffer;
              queryHash: string;
              queryMetadataJson: string;
              grantId: string | null;
              grantSequence: number | null;
              state: "current" | "stale";
            })
          | undefined;
        if (cached) {
          try {
            const encryptedPayload = Buffer.from(cached.encryptedPayload);
            const encryptionNonce = Buffer.from(cached.encryptionNonce);
            const queryMetadata = peerCachedQueryMetadataSchema.parse(
              JSON.parse(cached.queryMetadataJson)
            );
            if (
              cached.queryHash !== queryHash ||
              queryMetadata.queryHash !== queryHash
            ) {
              throw new Error(
                "The cached peer result is bound to another query."
              );
            }
            authorization = authorizePeerQueryResult({
              ownerUserId: actor.ownerUserId,
              relationshipId: relationship.id,
              query: body.query,
              metadata: queryMetadata
            });
            const resultMetadata = normalizeCachedPeerResultMetadata({
              ownerUserId: actor.ownerUserId,
              relationshipId: relationship.id,
              query: body.query,
              authorization,
              queryMetadata,
              row: cached,
              now: actor.auth.now ?? new Date()
            });
            if (encryptedPayload.byteLength <= PEER_CACHE_TAG_BYTES) {
              throw new Error("The encrypted peer cache payload is truncated.");
            }
            const key = dependencies.secrets.deriveKey("peer-remote-cache/v1");
            let payload: unknown;
            try {
              if (cached.encryptionKeyId !== peerCacheKeyId(key)) {
                getDatabase()
                  .prepare(
                    `UPDATE peer_remote_records
                   SET cache_state = 'key_unavailable', updated_at = ?
                   WHERE id = ? AND owner_user_id = ?
                     AND cache_state IN ('current', 'stale')`
                  )
                  .run(new Date().toISOString(), cached.id, actor.ownerUserId);
                throw new Error(
                  "The local key for this managed peer cache is unavailable; request a resync."
                );
              }
              payload = await decryptPeerCachePayload({
                key,
                expectedKeyId: cached.encryptionKeyId,
                context: {
                  ownerUserId: actor.ownerUserId,
                  relationshipId: relationship.id,
                  projectionId: body.query.projectionId,
                  queryHash,
                  sourceRecordId: cached.sourceRecordId,
                  sourceVersion: cached.sourceVersion
                },
                envelope: {
                  version: PEER_CACHE_ENVELOPE_VERSION,
                  algorithm: PEER_CACHE_ENCRYPTION_ALGORITHM,
                  keyId: cached.encryptionKeyId,
                  nonceBase64: encryptionNonce.toString("base64"),
                  ciphertextBase64: encryptedPayload.toString("base64"),
                  plaintextBytes:
                    encryptedPayload.byteLength - PEER_CACHE_TAG_BYTES
                }
              });
            } finally {
              key.fill(0);
            }
            const validated = validatePeerProjectionOutput({
              projectionId: body.query.projectionId,
              payload,
              effectiveFields: authorization.effectiveFields,
              maximumResultCount: Math.min(
                body.query.maximumResultCount,
                authorization.maximumResultCount
              ),
              maximumPayloadBytes: authorization.maximumPayloadBytes
            });
            validatedResultCount = validated.resultCount;
            response = {
              state: resultMetadata.state === "cached" ? "cached" : "stale",
              payload: validated.payload,
              metadata: {
                ...resultMetadata,
                redactedFields: [
                  ...new Set([
                    ...resultMetadata.redactedFields,
                    ...authorization.redactedFields,
                    ...validated.redactedFields
                  ])
                ].sort()
              }
            };
          } catch (error) {
            authorization = null;
            failure = failure ?? error;
          }
        }
      }
      const decision =
        response && authorization ? "allowed" : failure ? "error" : "denied";
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
      getDatabase()
        .prepare(
          `INSERT INTO peer_query_audit (
           id, owner_user_id, person_id, relationship_id, projection_id,
           requester_class, requester_id, parameters_hash, decision,
           decision_reason, grant_id, grant_sequence, grant_verification_id,
           verified_grant_hash, authorization_evidence_json, result_count,
           duration_ms, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `pqa_${randomUUID().replaceAll("-", "")}`,
          actor.ownerUserId,
          params.personId,
          relationship.id,
          body.query.projectionId,
          actor.principalClass,
          actor.principalId,
          hashPeerApiValue(body.query),
          decision,
          response
            ? ""
            : failure instanceof Error
              ? failure.message.slice(0, 1000)
              : "No live or cached result.",
          authorization?.grantId ?? null,
          authorization?.grantSequence ?? null,
          authorization?.grantVerificationId ?? null,
          authorization?.verifiedGrantHash ?? null,
          JSON.stringify(authorization?.evidence ?? {}),
          response ? validatedResultCount : 0,
          durationMs,
          (actor.auth.now ?? new Date()).toISOString()
        );
      if (!response || !authorization) {
        throw new HttpError(
          503,
          "peer_query_unavailable",
          "The peer is unavailable and no usable cached result exists."
        );
      }
      return { result: response, durationMs };
    }
  );

  app.get("/api/v1/people/:personId/questions", async (request) => {
    const params = PEER_API_SCHEMAS.listPersonQuestionHistory.params.parse(
      request.params ?? {}
    ) as { personId: string };
    const query = PEER_API_SCHEMAS.listPersonQuestionHistory.query.parse(
      request.query ?? {}
    ) as { cursor?: string; limit: number };
    const actor = authenticatePeopleRoute(
      dependencies,
      request.headers as Record<string, unknown>,
      "listPersonQuestionHistory",
      undefined,
      params.personId
    );
    if (!getPersonById(params.personId, actor.ownerUserId)) {
      throw new HttpError(404, "person_not_found", "Person not found.");
    }
    const now = actor.auth.now ?? new Date();
    const historyCursorKind = cursorKind("person-questions", {
      ownerUserId: actor.ownerUserId,
      personId: params.personId
    });
    const cursor = decodePeerCursor(query.cursor, {
      kind: historyCursorKind,
      key: cursorKey,
      payloadSchema: historyCursorSchema,
      now
    });
    const rows = listPersonPeerQuestionHistory({
      ownerUserId: actor.ownerUserId,
      personId: params.personId,
      limit: query.limit,
      before: cursor
    });
    const page = rows.slice(0, query.limit) as Array<{
      id: string;
      createdAt: string;
    }>;
    const last = page.at(-1);
    return {
      questions: page,
      page: {
        limit: query.limit,
        hasMore: rows.length > query.limit,
        nextCursor:
          rows.length > query.limit && last
            ? encodePeerCursor({
                kind: historyCursorKind,
                payload: { createdAt: last.createdAt, id: last.id },
                key: cursorKey,
                now
              })
            : null
      }
    };
  });
}
