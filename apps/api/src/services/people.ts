import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { runInTransaction } from "../db.js";
import {
  normalizePersonSearchText,
  personAliasInputSchema,
  wikiPeopleCandidateScanResultSchema,
  wikiPeopleCandidateScanSchema,
  wikiPersonAssociationBatchSchema,
  wikiPersonAssociationApplyResultSchema,
  wikiPersonAssociationApplySchema,
  wikiPersonAssociationDecisionSchema,
  wikiPersonAssociationPreviewRequestSchema,
  wikiPersonAssociationPreviewSchema,
  wikiPersonAssociationResultSchema,
  type Person,
  type PersonEntityAuthorizationCallback,
  type PersonLink,
  type WikiPeopleCandidateScan,
  type WikiPeopleCandidateScanResult,
  type WikiPersonCandidate,
  type WikiPersonAssociationBatch,
  type WikiPersonAssociationApply,
  type WikiPersonAssociationApplyResult,
  type WikiPersonAssociationDecision,
  type WikiPersonAssociationPreview,
  type WikiPersonAssociationPreviewRequest,
  type WikiPersonAssociationResult
} from "../people-types.js";
import {
  PeopleAuthorizationError,
  PersonConflictError,
  PersonNotFoundError,
  consumeWikiPersonAssociationPreviewRecord,
  createPeopleIdempotencyRecord,
  createPerson,
  createWikiPersonAssociationPreviewRecord,
  getPeopleIdempotencyRecord,
  getPersonById,
  getWikiPersonAssociationPreviewRecord,
  listAuthorizedPersonLinks,
  listPersonIdentityRecords,
  listWikiPeopleCandidatePages,
  listWikiPeopleCandidatePagesByIds,
  listWikiProfileAssociations,
  upsertAuthorizedPersonLink,
  type WikiPeopleCandidatePageRow
} from "../repositories/people.js";

const WIKI_ASSOCIATION_PREVIEW_TTL_MS = 10 * 60 * 1000;
const WIKI_ASSOCIATION_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const WIKI_ASSOCIATION_OPERATION_ID = "people.wiki-associations.apply";

const wikiAssociationSourceVersionsSchema = z
  .object({
    rootSlug: z.string().trim().min(1).max(240),
    actor: z.string().max(240).nullable(),
    candidates: z
      .array(
        z
          .object({
            noteId: z.string().trim().min(1).max(240),
            rootNoteId: z.string().trim().min(1).max(240),
            spaceId: z.string().trim().min(1).max(240),
            updatedAt: z.string().datetime({ offset: true }),
            associatedPersonIds: z
              .array(z.string().trim().min(1).max(240))
              .max(500)
          })
          .strict()
      )
      .max(500),
    people: z
      .array(
        z
          .object({
            personId: z.string().trim().min(1).max(240),
            updatedAt: z.string().datetime({ offset: true })
          })
          .strict()
      )
      .max(500)
  })
  .strict();

type WikiAssociationSourceVersions = z.infer<
  typeof wikiAssociationSourceVersionsSchema
>;

export type PeopleServiceDependencies = {
  authorizeEntity: PersonEntityAuthorizationCallback;
  now?: () => Date;
};

export type PersonContextReadModel = {
  person: Person;
  links: PersonLink[];
  profilePageLinks: PersonLink[];
};

export class WikiPeopleCandidateNotFoundError extends Error {
  constructor() {
    super(
      "Wiki page is not an active descendant of an authorized People root."
    );
    this.name = "WikiPeopleCandidateNotFoundError";
  }
}

export type WikiPeopleCandidateCollection = {
  candidates: WikiPersonCandidate[];
  rootCount: number;
  scannedCount: number;
  truncated: boolean;
};

function operationNow(dependencies: PeopleServiceDependencies): Date {
  const value = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(value.getTime())) {
    throw new PersonConflictError(
      "People service clock returned an invalid date."
    );
  }
  return new Date(value.getTime());
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseStoredJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new PersonConflictError(
      "Stored Wiki association state is malformed."
    );
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseWikiAliases(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) {
      return [];
    }
    return Array.from(
      new Set(
        value
          .filter((alias): alias is string => typeof alias === "string")
          .map((alias) => alias.normalize("NFC").trim().replace(/\s+/gu, " "))
          .filter((alias) => alias.length > 0 && alias.length <= 240)
      )
    );
  } catch {
    return [];
  }
}

function candidateIdentityKeys(page: WikiPeopleCandidatePageRow): string[] {
  return Array.from(
    new Set(
      [page.title, ...parseWikiAliases(page.aliasesJson)]
        .map(normalizePersonSearchText)
        .filter(Boolean)
    )
  );
}

function assertAuthorized(
  dependencies: PeopleServiceDependencies,
  input: {
    userId: string;
    entityType: string;
    entityId: string;
    operation: "read" | "link" | "unlink";
  }
): void {
  if (!dependencies.authorizeEntity(input)) {
    throw new PeopleAuthorizationError();
  }
}

function loadCandidateForDecision(
  userId: string,
  candidateNoteId: string,
  rootSlug: string,
  dependencies: PeopleServiceDependencies,
  operation: "read" | "link"
): WikiPeopleCandidatePageRow {
  const decision = {
    action: operation === "read" ? ("skip" as const) : ("create" as const),
    candidateNoteId,
    ...(operation === "link" ? { person: {} } : {})
  } as WikiPersonAssociationDecision;
  return loadCandidatesForDecisions(
    userId,
    rootSlug,
    [decision],
    dependencies
  ).get(candidateNoteId)!;
}

function loadCandidatesForDecisions(
  userId: string,
  rootSlug: string,
  decisions: readonly WikiPersonAssociationDecision[],
  dependencies: PeopleServiceDependencies
): Map<string, WikiPeopleCandidatePageRow> {
  const pages = listWikiPeopleCandidatePagesByIds({
    userId,
    rootSlug,
    candidateIds: decisions.map((decision) => decision.candidateNoteId),
    now: dependencies.now?.()
  });
  const pagesById = new Map(pages.map((page) => [page.id, page] as const));
  const authorizedRoots = new Set<string>();
  const result = new Map<string, WikiPeopleCandidatePageRow>();
  for (const decision of decisions) {
    const page = pagesById.get(decision.candidateNoteId);
    if (!page) {
      throw new WikiPeopleCandidateNotFoundError();
    }
    const operation = decision.action === "skip" ? "read" : "link";
    const rootAuthorizationKey = `${operation}\u0000${page.rootNoteId}`;
    if (!authorizedRoots.has(rootAuthorizationKey)) {
      assertAuthorized(dependencies, {
        userId,
        entityType: "note",
        entityId: page.rootNoteId,
        operation
      });
      authorizedRoots.add(rootAuthorizationKey);
    }
    assertAuthorized(dependencies, {
      userId,
      entityType: "note",
      entityId: page.id,
      operation
    });
    result.set(page.id, page);
  }
  return result;
}

export function collectWikiPeopleCandidates(
  input: {
    userId: string;
    spaceId?: string;
    rootSlug: string;
    includeAssociated: boolean;
    maximumRows?: number;
  },
  dependencies: PeopleServiceDependencies
): WikiPeopleCandidateCollection {
  const maximumRows = Math.min(
    Math.max(input.maximumRows ?? 20_000, 1),
    20_000
  );
  const window = listWikiPeopleCandidatePages({
    userId: input.userId,
    rootSlug: input.rootSlug,
    spaceId: input.spaceId,
    maximumRows,
    now: dependencies.now?.()
  });
  const authorizedRootIds = new Set(
    window.roots
      .filter((root) =>
        dependencies.authorizeEntity({
          userId: input.userId,
          entityType: "note",
          entityId: root.id,
          operation: "read"
        })
      )
      .map((root) => root.id)
  );
  const authorizedPages = window.pages.filter(
    (page) =>
      authorizedRootIds.has(page.rootNoteId) &&
      dependencies.authorizeEntity({
        userId: input.userId,
        entityType: "note",
        entityId: page.id,
        operation: "read"
      })
  );
  const identities = listPersonIdentityRecords(input.userId);
  const peopleByIdentity = new Map<string, Set<string>>();
  for (const identity of identities) {
    for (const name of identity.names) {
      const key = normalizePersonSearchText(name);
      const people = peopleByIdentity.get(key) ?? new Set<string>();
      people.add(identity.personId);
      peopleByIdentity.set(key, people);
    }
  }
  const candidatesByIdentity = new Map<string, Set<string>>();
  for (const page of authorizedPages) {
    for (const key of candidateIdentityKeys(page)) {
      const pages = candidatesByIdentity.get(key) ?? new Set<string>();
      pages.add(page.id);
      candidatesByIdentity.set(key, pages);
    }
  }
  const associations = listWikiProfileAssociations(
    input.userId,
    authorizedPages.map((page) => page.id)
  );
  const candidates = authorizedPages.map((page) => {
    const keys = candidateIdentityKeys(page);
    const matchingPersonIds = Array.from(
      new Set(
        keys.flatMap((key) => Array.from(peopleByIdentity.get(key) ?? []))
      )
    ).sort();
    const associatedPersonIds = [...(associations.get(page.id) ?? [])].sort();
    const duplicateCandidateNoteIds = Array.from(
      new Set(
        keys.flatMap((key) => Array.from(candidatesByIdentity.get(key) ?? []))
      )
    )
      .filter((noteId) => noteId !== page.id)
      .sort();
    const ambiguous =
      matchingPersonIds.length > 1 ||
      associatedPersonIds.length > 1 ||
      duplicateCandidateNoteIds.length > 0;
    const status =
      associatedPersonIds.length > 1
        ? "ambiguous"
        : associatedPersonIds.length === 1
          ? "associated"
          : ambiguous
            ? "ambiguous"
            : matchingPersonIds.length === 1
              ? "single_match"
              : "unmatched";
    return {
      noteId: page.id,
      rootNoteId: page.rootNoteId,
      spaceId: page.spaceId,
      title: page.title,
      slug: page.slug,
      parentSlug: page.parentSlug,
      aliases: parseWikiAliases(page.aliasesJson),
      summary: page.summary,
      updatedAt: page.updatedAt,
      matchingPersonIds,
      associatedPersonIds,
      duplicateCandidateNoteIds,
      status
    } as const;
  });
  const visibleCandidates = input.includeAssociated
    ? candidates
    : candidates.filter(
        (candidate) => candidate.associatedPersonIds.length === 0
      );
  return {
    candidates: visibleCandidates,
    rootCount: authorizedRootIds.size,
    scannedCount: authorizedPages.length,
    truncated: window.truncated
  };
}

export function scanWikiPeopleCandidates(
  input: WikiPeopleCandidateScan,
  dependencies: PeopleServiceDependencies
): WikiPeopleCandidateScanResult {
  const query = wikiPeopleCandidateScanSchema.parse(input);
  const collection = collectWikiPeopleCandidates(
    {
      userId: query.userId,
      rootSlug: query.rootSlug,
      spaceId: query.spaceId,
      includeAssociated: query.includeAssociated,
      maximumRows: 5_000
    },
    dependencies
  );
  return wikiPeopleCandidateScanResultSchema.parse({
    ...collection,
    candidates: collection.candidates.slice(0, query.limit),
    truncated:
      collection.truncated || collection.candidates.length > query.limit
  });
}

function mergeCandidateAliases(
  page: WikiPeopleCandidatePageRow,
  supplied: unknown
) {
  const merged = [
    ...parseWikiAliases(page.aliasesJson).map((alias) => ({
      alias,
      kind: "name" as const
    })),
    ...(Array.isArray(supplied) ? supplied : [])
  ].map((alias) => personAliasInputSchema.parse(alias));
  const byNormalizedAlias = new Map(
    merged.map(
      (alias) => [normalizePersonSearchText(alias.alias), alias] as const
    )
  );
  return Array.from(byNormalizedAlias.values());
}

function assertWikiCandidateVersion(
  decision: ReturnType<typeof wikiPersonAssociationDecisionSchema.parse>,
  page: WikiPeopleCandidatePageRow
): void {
  if (
    decision.expectedWikiVersion !== undefined &&
    decision.expectedWikiVersion !== page.updatedAt
  ) {
    throw new PersonConflictError(
      "Wiki candidate changed after it was reviewed. Scan and preview it again."
    );
  }
}

function assertPersonVersion(
  expectedVersion: string | undefined,
  person: Person
): void {
  if (expectedVersion !== undefined && expectedVersion !== person.updatedAt) {
    throw new PersonConflictError(
      "Person changed after it was reviewed. Preview the association again."
    );
  }
}

function applyDecision(
  input: {
    userId: string;
    rootSlug: string;
    decision: WikiPersonAssociationDecision;
    actor: string | null;
  },
  dependencies: PeopleServiceDependencies,
  loaded?: {
    page: WikiPeopleCandidatePageRow;
    associatedPersonIds: string[];
  }
): WikiPersonAssociationResult {
  const decision = wikiPersonAssociationDecisionSchema.parse(input.decision);
  const operation = decision.action === "skip" ? "read" : "link";
  const page =
    loaded?.page ??
    loadCandidateForDecision(
      input.userId,
      decision.candidateNoteId,
      input.rootSlug,
      dependencies,
      operation
    );
  if (page.id !== decision.candidateNoteId) {
    throw new PersonConflictError(
      "Loaded Wiki candidate does not match the decision."
    );
  }
  assertWikiCandidateVersion(decision, page);
  if (decision.action === "skip") {
    return wikiPersonAssociationResultSchema.parse({
      candidateNoteId: page.id,
      action: "skip",
      status: "skipped",
      personId: null,
      linkCreated: false
    });
  }

  const associatedPersonIds =
    loaded?.associatedPersonIds ??
    listWikiProfileAssociations(input.userId, [page.id]).get(page.id) ??
    [];
  if (associatedPersonIds.length > 1) {
    throw new PersonConflictError(
      "Wiki candidate already has ambiguous Person profile associations."
    );
  }

  if (decision.action === "associate") {
    const person = getPersonById(decision.personId, input.userId);
    if (!person) {
      throw new PersonNotFoundError();
    }
    assertPersonVersion(decision.expectedPersonVersion, person);
    if (
      associatedPersonIds.length === 1 &&
      associatedPersonIds[0] !== decision.personId
    ) {
      throw new PersonConflictError(
        "Wiki candidate is already associated with a different Person."
      );
    }
    const link = upsertAuthorizedPersonLink(
      {
        userId: input.userId,
        personId: person.id,
        link: {
          targetEntityType: "note",
          targetEntityId: page.id,
          relationship: "profile_page"
        },
        actor: input.actor
      },
      dependencies.authorizeEntity,
      { now: dependencies.now?.() }
    );
    return wikiPersonAssociationResultSchema.parse({
      candidateNoteId: page.id,
      action: "associate",
      status: link.created ? "associated" : "already_associated",
      personId: person.id,
      linkCreated: link.created
    });
  }

  if (associatedPersonIds.length === 1) {
    const existingPersonId = associatedPersonIds[0]!;
    const existingPerson = getPersonById(existingPersonId, input.userId);
    if (!existingPerson) {
      throw new PersonConflictError(
        "Wiki association points to an unavailable Person."
      );
    }
    upsertAuthorizedPersonLink(
      {
        userId: input.userId,
        personId: existingPerson.id,
        link: {
          targetEntityType: "note",
          targetEntityId: page.id,
          relationship: "profile_page"
        },
        actor: input.actor
      },
      dependencies.authorizeEntity,
      { now: dependencies.now?.() }
    );
    return wikiPersonAssociationResultSchema.parse({
      candidateNoteId: page.id,
      action: "create",
      status: "already_associated",
      personId: existingPerson.id,
      linkCreated: false
    });
  }

  const created = createPerson(
    {
      userId: input.userId,
      displayName: decision.person.displayName ?? page.title,
      preferredName: decision.person.preferredName ?? "",
      relationshipCategory: decision.person.relationshipCategory ?? "",
      relationshipLabel: decision.person.relationshipLabel ?? "",
      shortDescription: decision.person.shortDescription ?? page.summary,
      aliases: mergeCandidateAliases(page, decision.person.aliases)
    },
    { now: dependencies.now?.() }
  );
  const link = upsertAuthorizedPersonLink(
    {
      userId: input.userId,
      personId: created.id,
      link: {
        targetEntityType: "note",
        targetEntityId: page.id,
        relationship: "profile_page"
      },
      actor: input.actor
    },
    dependencies.authorizeEntity,
    { now: dependencies.now?.() }
  );
  return wikiPersonAssociationResultSchema.parse({
    candidateNoteId: page.id,
    action: "create",
    status: "created",
    personId: created.id,
    linkCreated: link.created
  });
}

export function applyWikiPersonAssociationDecision(
  input: {
    userId: string;
    rootSlug?: string;
    decision: WikiPersonAssociationDecision;
    actor?: string | null;
  },
  dependencies: PeopleServiceDependencies
): WikiPersonAssociationResult {
  return runInTransaction(() =>
    applyDecision(
      {
        userId: input.userId,
        rootSlug: input.rootSlug ?? "people",
        decision: input.decision,
        actor: input.actor ?? null
      },
      dependencies
    )
  );
}

export function applyWikiPersonAssociationDecisions(
  input: WikiPersonAssociationBatch,
  dependencies: PeopleServiceDependencies
): WikiPersonAssociationResult[] {
  const batch = wikiPersonAssociationBatchSchema.parse(input);
  return runInTransaction(() => {
    const pages = loadCandidatesForDecisions(
      batch.userId,
      batch.rootSlug,
      batch.decisions,
      dependencies
    );
    const associations = listWikiProfileAssociations(
      batch.userId,
      batch.decisions.map((decision) => decision.candidateNoteId)
    );
    return batch.decisions.map((decision) =>
      applyDecision(
        {
          userId: batch.userId,
          rootSlug: batch.rootSlug,
          decision,
          actor: batch.actor
        },
        dependencies,
        {
          page: pages.get(decision.candidateNoteId)!,
          associatedPersonIds: associations.get(decision.candidateNoteId) ?? []
        }
      )
    );
  });
}

function validateDecisionForPreview(
  input: {
    userId: string;
    decision: ReturnType<typeof wikiPersonAssociationDecisionSchema.parse>;
    page: WikiPeopleCandidatePageRow;
    associatedPersonIds: string[];
  },
  dependencies: PeopleServiceDependencies
): Person | undefined {
  assertWikiCandidateVersion(input.decision, input.page);
  if (input.associatedPersonIds.length > 1) {
    throw new PersonConflictError(
      "Wiki candidate already has ambiguous Person profile associations."
    );
  }
  if (input.decision.action === "skip") {
    return undefined;
  }
  if (input.decision.action === "associate") {
    const person = getPersonById(input.decision.personId, input.userId);
    if (!person) {
      throw new PersonNotFoundError();
    }
    assertPersonVersion(input.decision.expectedPersonVersion, person);
    if (
      input.associatedPersonIds.length === 1 &&
      input.associatedPersonIds[0] !== person.id
    ) {
      throw new PersonConflictError(
        "Wiki candidate is already associated with a different Person."
      );
    }
    assertAuthorized(dependencies, {
      userId: input.userId,
      entityType: "person",
      entityId: person.id,
      operation: "link"
    });
    return person;
  }
  if (input.associatedPersonIds.length === 0) {
    return undefined;
  }
  const person = getPersonById(input.associatedPersonIds[0]!, input.userId);
  if (!person) {
    throw new PersonConflictError(
      "Wiki association points to an unavailable Person."
    );
  }
  assertAuthorized(dependencies, {
    userId: input.userId,
    entityType: "person",
    entityId: person.id,
    operation: "link"
  });
  return person;
}

function previewBindingHash(input: {
  previewId: string;
  userId: string;
  decisions: ReturnType<typeof wikiPersonAssociationDecisionSchema.parse>[];
  sourceVersions: WikiAssociationSourceVersions;
  createdAt: string;
  expiresAt: string;
}): string {
  return sha256({
    previewId: input.previewId,
    userId: input.userId,
    decisions: input.decisions,
    sourceVersions: input.sourceVersions,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt
  });
}

export function previewWikiPersonAssociationDecisions(
  input: WikiPersonAssociationPreviewRequest,
  dependencies: PeopleServiceDependencies
): WikiPersonAssociationPreview {
  const request = wikiPersonAssociationPreviewRequestSchema.parse(input);
  return runInTransaction(() => {
    const now = operationNow(dependencies);
    const fixedDependencies: PeopleServiceDependencies = {
      ...dependencies,
      now: () => new Date(now.getTime())
    };
    const pages = loadCandidatesForDecisions(
      request.userId,
      request.rootSlug,
      request.decisions,
      fixedDependencies
    );
    const associations = listWikiProfileAssociations(
      request.userId,
      request.decisions.map((decision) => decision.candidateNoteId)
    );
    const peopleById = new Map<string, Person>();
    const candidateVersions = request.decisions.map((decision) => {
      const page = pages.get(decision.candidateNoteId)!;
      const associatedPersonIds = [
        ...(associations.get(decision.candidateNoteId) ?? [])
      ].sort();
      const person = validateDecisionForPreview(
        {
          userId: request.userId,
          decision,
          page,
          associatedPersonIds
        },
        fixedDependencies
      );
      if (person) {
        peopleById.set(person.id, person);
      }
      return {
        noteId: page.id,
        rootNoteId: page.rootNoteId,
        spaceId: page.spaceId,
        updatedAt: page.updatedAt,
        associatedPersonIds
      };
    });
    const sourceVersions = wikiAssociationSourceVersionsSchema.parse({
      rootSlug: request.rootSlug,
      actor: request.actor,
      candidates: candidateVersions.sort((left, right) =>
        left.noteId.localeCompare(right.noteId)
      ),
      people: Array.from(peopleById.values())
        .map((person) => ({
          personId: person.id,
          updatedAt: person.updatedAt
        }))
        .sort((left, right) => left.personId.localeCompare(right.personId))
    });
    const previewId = `peoplewikipreview_${randomUUID().replaceAll("-", "")}`;
    const createdAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + WIKI_ASSOCIATION_PREVIEW_TTL_MS
    ).toISOString();
    const previewHash = previewBindingHash({
      previewId,
      userId: request.userId,
      decisions: request.decisions,
      sourceVersions,
      createdAt,
      expiresAt
    });
    const record = createWikiPersonAssociationPreviewRecord(
      {
        ownerUserId: request.userId,
        previewHash,
        decisionsJson: canonicalJson(request.decisions),
        sourceVersionsJson: canonicalJson(sourceVersions),
        expiresAt
      },
      { id: previewId, now }
    );
    return wikiPersonAssociationPreviewSchema.parse({
      previewId: record.id,
      previewHash: record.previewHash,
      decisions: request.decisions,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt
    });
  });
}

export function applyWikiPersonAssociationPreview(
  input: WikiPersonAssociationApply,
  dependencies: PeopleServiceDependencies
): WikiPersonAssociationApplyResult {
  const request = wikiPersonAssociationApplySchema.parse(input);
  const requestHash = sha256(request);
  return runInTransaction(() => {
    const now = operationNow(dependencies);
    const idempotency = getPeopleIdempotencyRecord(
      request.userId,
      WIKI_ASSOCIATION_OPERATION_ID,
      request.idempotencyKey,
      { now }
    );
    if (idempotency) {
      if (idempotency.requestHash !== requestHash) {
        throw new PersonConflictError(
          "Idempotency key was already used for a different Wiki association apply request."
        );
      }
      if (idempotency.responseStatus !== 200) {
        throw new PersonConflictError(
          "Stored Wiki association idempotency response is not successful."
        );
      }
      const replay = wikiPersonAssociationApplyResultSchema.parse(
        parseStoredJson(idempotency.responseJson)
      );
      return { ...replay, replayed: true };
    }

    const record = getWikiPersonAssociationPreviewRecord(
      request.previewId,
      request.userId
    );
    if (!record) {
      throw new PersonConflictError(
        "Wiki association preview was not found for this owner."
      );
    }
    if (record.previewHash !== request.previewHash) {
      throw new PersonConflictError(
        "Wiki association preview hash does not match the reviewed preview."
      );
    }
    if (record.status !== "active") {
      throw new PersonConflictError(
        "Wiki association preview has already reached a terminal state."
      );
    }
    if (Date.parse(record.expiresAt) <= now.getTime()) {
      throw new PersonConflictError(
        "Wiki association preview expired before it could be applied."
      );
    }

    const storedPreview = wikiPersonAssociationPreviewSchema.parse({
      previewId: record.id,
      previewHash: record.previewHash,
      decisions: parseStoredJson(record.decisionsJson),
      createdAt: record.createdAt,
      expiresAt: record.expiresAt
    });
    const sourceVersions = wikiAssociationSourceVersionsSchema.parse(
      parseStoredJson(record.sourceVersionsJson)
    );
    if (sourceVersions.actor !== request.actor) {
      throw new PersonConflictError(
        "Wiki association actor does not match the reviewed preview."
      );
    }
    if (
      canonicalJson(storedPreview.decisions) !==
      canonicalJson(request.decisions)
    ) {
      throw new PersonConflictError(
        "Wiki association decisions were changed after preview."
      );
    }
    const expectedPreviewHash = previewBindingHash({
      previewId: record.id,
      userId: request.userId,
      decisions: storedPreview.decisions,
      sourceVersions,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt
    });
    if (expectedPreviewHash !== record.previewHash) {
      throw new PersonConflictError(
        "Stored Wiki association preview binding failed integrity validation."
      );
    }

    const fixedDependencies: PeopleServiceDependencies = {
      ...dependencies,
      now: () => new Date(now.getTime())
    };
    const pages = loadCandidatesForDecisions(
      request.userId,
      sourceVersions.rootSlug,
      storedPreview.decisions,
      fixedDependencies
    );
    const associations = listWikiProfileAssociations(
      request.userId,
      storedPreview.decisions.map((decision) => decision.candidateNoteId)
    );
    const sourceCandidates = new Map(
      sourceVersions.candidates.map((candidate) => [
        candidate.noteId,
        candidate
      ])
    );
    if (sourceCandidates.size !== storedPreview.decisions.length) {
      throw new PersonConflictError(
        "Wiki association preview has incomplete candidate versions."
      );
    }
    for (const decision of storedPreview.decisions) {
      const page = pages.get(decision.candidateNoteId)!;
      const source = sourceCandidates.get(decision.candidateNoteId);
      const currentAssociations = [
        ...(associations.get(decision.candidateNoteId) ?? [])
      ].sort();
      if (
        !source ||
        source.rootNoteId !== page.rootNoteId ||
        source.spaceId !== page.spaceId ||
        source.updatedAt !== page.updatedAt ||
        canonicalJson(source.associatedPersonIds) !==
          canonicalJson(currentAssociations)
      ) {
        throw new PersonConflictError(
          "Wiki candidate or its Person association changed after preview."
        );
      }
    }
    for (const sourcePerson of sourceVersions.people) {
      const person = getPersonById(sourcePerson.personId, request.userId);
      if (!person || person.updatedAt !== sourcePerson.updatedAt) {
        throw new PersonConflictError(
          "Person changed or became unavailable after Wiki association preview."
        );
      }
    }

    const results = storedPreview.decisions.map((decision) =>
      applyDecision(
        {
          userId: request.userId,
          rootSlug: sourceVersions.rootSlug,
          decision,
          actor: request.actor
        },
        fixedDependencies,
        {
          page: pages.get(decision.candidateNoteId)!,
          associatedPersonIds: associations.get(decision.candidateNoteId) ?? []
        }
      )
    );
    const consumedAt = now.toISOString();
    if (
      !consumeWikiPersonAssociationPreviewRecord(
        record.id,
        request.userId,
        consumedAt
      )
    ) {
      throw new PersonConflictError(
        "Wiki association preview changed while it was being consumed."
      );
    }
    const response = wikiPersonAssociationApplyResultSchema.parse({
      previewId: record.id,
      replayed: false,
      results
    });
    createPeopleIdempotencyRecord({
      ownerUserId: request.userId,
      operationId: WIKI_ASSOCIATION_OPERATION_ID,
      idempotencyKey: request.idempotencyKey,
      requestHash,
      responseStatus: 200,
      responseJson: canonicalJson(response),
      createdAt: consumedAt,
      expiresAt: new Date(
        now.getTime() + WIKI_ASSOCIATION_IDEMPOTENCY_TTL_MS
      ).toISOString()
    });
    return response;
  });
}

export function getPersonContextReadModel(
  input: { userId: string; personId: string; linkLimit?: number },
  dependencies: PeopleServiceDependencies
): PersonContextReadModel | undefined {
  const person = getPersonById(input.personId, input.userId);
  if (!person) {
    return undefined;
  }
  const links = listAuthorizedPersonLinks(
    {
      userId: input.userId,
      personId: input.personId,
      direction: "both",
      limit: input.linkLimit
    },
    dependencies.authorizeEntity
  );
  const profilePageLinks = listAuthorizedPersonLinks(
    {
      userId: input.userId,
      personId: input.personId,
      direction: "outgoing",
      targetEntityType: "note",
      relationship: "profile_page",
      limit: 200
    },
    dependencies.authorizeEntity
  );
  return {
    person,
    links,
    profilePageLinks
  };
}

export function createPeopleService(dependencies: PeopleServiceDependencies) {
  return {
    scanWikiCandidates: (input: WikiPeopleCandidateScan) =>
      scanWikiPeopleCandidates(input, dependencies),
    previewWikiAssociationDecisions: (
      input: WikiPersonAssociationPreviewRequest
    ) => previewWikiPersonAssociationDecisions(input, dependencies),
    applyWikiAssociationPreview: (input: WikiPersonAssociationApply) =>
      applyWikiPersonAssociationPreview(input, dependencies),
    applyWikiAssociationDecision: (input: {
      userId: string;
      rootSlug?: string;
      decision: WikiPersonAssociationDecision;
      actor?: string | null;
    }) => applyWikiPersonAssociationDecision(input, dependencies),
    applyWikiAssociationDecisions: (input: WikiPersonAssociationBatch) =>
      applyWikiPersonAssociationDecisions(input, dependencies),
    getPersonContext: (input: {
      userId: string;
      personId: string;
      linkLimit?: number;
    }) => getPersonContextReadModel(input, dependencies)
  };
}
